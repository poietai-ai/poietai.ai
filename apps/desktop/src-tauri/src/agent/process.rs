use anyhow::{Context, Result};
use log::{error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::events::{parse_event, AgentEvent};

/// Payload sent to the React frontend for each canvas node.
#[derive(Debug, Clone, Serialize)]
pub struct CanvasNodePayload {
    pub node_id: String,
    pub agent_id: String,
    pub ticket_id: String,
    pub event: AgentEvent,
}

/// Payload emitted when the agent run completes.
#[derive(Debug, Clone, Serialize)]
pub struct AgentResultPayload {
    pub agent_id: String,
    pub ticket_id: String,
    pub session_id: Option<String>,
}

/// Configuration for running an agent against a ticket.
pub struct AgentRunConfig {
    pub agent_id: String,
    pub ticket_id: String,
    /// The full prompt: ticket description + acceptance criteria.
    pub prompt: String,
    /// System prompt suffix: role + personality + project context + ticket context.
    pub system_prompt: String,
    /// Tools the agent is allowed to use (e.g. ["Read", "Edit", "Bash(git:*)"]).
    pub allowed_tools: Vec<String>,
    /// The working directory (the git worktree path).
    pub working_dir: PathBuf,
    /// Environment variables (git identity, GH_TOKEN, etc.).
    pub env: Vec<(String, String)>,
    /// If resuming a paused session, provide the session ID here.
    pub resume_session_id: Option<String>,
}

/// Wrap a string in POSIX single quotes for safe embedding in a shell script.
/// Single quotes prevent ALL shell interpretation (globs, parameter expansion, etc.).
/// A single quote inside is handled by: end quote → escaped apostrophe → reopen quote.
#[cfg(target_os = "windows")]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// On Windows, convert a UNC WSL path like
/// `\\wsl.localhost\Ubuntu\home\user\repo` to a Linux path `/home/user/repo`.
/// Falls back to the original string if it doesn't match the expected format.
#[cfg(target_os = "windows")]
fn wsl_to_linux_path(path: &PathBuf) -> String {
    let s = path.to_string_lossy();
    // Matches \\wsl.localhost\<distro>\rest  or  \\wsl$\<distro>\rest
    if s.starts_with("\\\\wsl") {
        let mut parts = s.splitn(5, '\\');
        parts.next(); // ""
        parts.next(); // ""
        parts.next(); // "wsl.localhost" or "wsl$"
        parts.next(); // distro name, e.g. "Ubuntu"
        if let Some(rest) = parts.next() {
            return format!("/{}", rest.replace('\\', "/"));
        }
    }
    s.into_owned()
}

/// On Windows, extract `\\wsl.localhost\Ubuntu` (or `\\wsl$\Ubuntu`) from a
/// full UNC WSL path. Used to build paths into the WSL filesystem from Windows.
#[cfg(target_os = "windows")]
fn wsl_distro_root(path: &PathBuf) -> Option<String> {
    let s = path.to_string_lossy();
    if s.starts_with("\\\\wsl") {
        let mut parts = s.splitn(5, '\\');
        parts.next(); // ""
        parts.next(); // ""
        let server = parts.next()?; // "wsl.localhost" or "wsl$"
        let distro = parts.next()?; // e.g. "Ubuntu"
        return Some(format!("\\\\{}\\{}", server, distro));
    }
    None
}

/// Run the agent and stream events to the React frontend.
///
/// This function is async. Call it from a tokio::spawn block.
/// It returns when the claude process exits (success or error).
///
/// Emits two event types to React:
/// - "agent-event": one per parsed JSONL line, with the canvas node payload
/// - "agent-result": once at the end, with the session ID (for pause/resume)
pub async fn run(config: AgentRunConfig, app: AppHandle) -> Result<Option<String>> {
    info!(
        "[process::run] agent={} ticket={} working_dir={:?}",
        config.agent_id, config.ticket_id, config.working_dir
    );

    // On Windows, claude lives inside WSL2.
    //
    // We write a small bash script directly to the WSL filesystem via its UNC
    // path (e.g. \\wsl.localhost\Ubuntu\tmp\poietai-<uuid>.sh), then execute
    // it with `wsl --exec /bin/bash -l <script>`.
    //
    // This sidesteps every argument-passing problem we hit with -c "...":
    //  - Windows CreateProcessW quoting of multi-line / double-quote-containing strings
    //  - WSL consuming `--` before bash sees it
    //  - WSLENV not forwarding env vars through --exec
    //
    // The script file lives on the Linux filesystem so bash reads it directly.
    // POSIX single-quoting inside the script handles any special chars in the
    // system prompt, prompt, or tool names.
    // -l loads the login profile so nvm / claude are on PATH.
    #[cfg(target_os = "windows")]
    let (mut cmd, temp_script) = {
        let linux_dir = wsl_to_linux_path(&config.working_dir);

        let distro_root = wsl_distro_root(&config.working_dir).ok_or_else(|| {
            anyhow::anyhow!(
                "cannot determine WSL distro root from path: {:?}",
                config.working_dir
            )
        })?;

        let resume_part = config
            .resume_session_id
            .as_deref()
            .map(|sid| format!("--resume {}", sh_quote(sid)))
            .unwrap_or_default();

        let script_content = format!(
            "#!/bin/bash\n\
             exec claude --print --output-format stream-json \\\n  \
             --append-system-prompt {} \\\n  \
             --allowedTools {} \\\n  \
             {} {}\n",
            sh_quote(&config.system_prompt),
            sh_quote(&config.allowed_tools.join(",")),
            resume_part,
            sh_quote(&config.prompt),
        );

        // Write the script to WSL's /tmp/ via the UNC path.
        let script_name = format!("poietai-{}.sh", uuid::Uuid::new_v4());
        let script_win_path =
            PathBuf::from(format!("{}\\tmp\\{}", distro_root, script_name));
        let script_linux_path = format!("/tmp/{}", script_name);

        std::fs::write(&script_win_path, script_content.as_bytes())
            .with_context(|| format!("failed to write agent script to {:?}", script_win_path))?;

        info!(
            "[process::run] wrote script to {:?} (linux: {})",
            script_win_path, script_linux_path
        );

        let mut c = Command::new("wsl");
        c.arg("--cd")
            .arg(&linux_dir)
            .arg("--exec")
            .arg("/bin/bash")
            .arg("-l")
            .arg(&script_linux_path);

        (c, Some(script_win_path))
    };

    // On Linux/macOS, run claude directly with separate args — no shell involved.
    #[cfg(not(target_os = "windows"))]
    let (mut cmd, temp_script) = {
        let mut c = Command::new("claude");
        c.arg("--print")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--append-system-prompt")
            .arg(&config.system_prompt)
            .arg("--allowedTools")
            .arg(config.allowed_tools.join(","));
        if let Some(ref session_id) = config.resume_session_id {
            c.arg("--resume").arg(session_id);
        }
        c.arg(&config.prompt);
        (c, None::<PathBuf>)
    };

    // On Linux/macOS, set the working directory directly on the process.
    // On Windows, --cd above handles it.
    #[cfg(not(target_os = "windows"))]
    cmd.current_dir(&config.working_dir);

    // Inject git identity and GitHub token
    for (key, value) in &config.env {
        cmd.env(key, value);
    }

    // Pipe stdout for line-by-line JSONL reading.
    // Inherit stderr so claude errors appear in the Tauri dev console
    // and avoid a pipe-buffer deadlock if claude emits large error output.
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());

    let mut child = cmd.spawn().context("failed to spawn claude process")?;
    info!("[process::run] claude spawned pid={:?}", child.id());

    let stdout = child.stdout.take().expect("stdout was not piped");
    let mut lines = BufReader::new(stdout).lines();

    let mut node_sequence: u32 = 0;
    let mut last_session_id: Option<String> = None;

    // Read JSONL lines as they arrive — loops until claude exits
    while let Some(line) = lines
        .next_line()
        .await
        .context("error reading claude output")?
    {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        info!("[process::run] line: {}", &line[..line.len().min(200)]);

        if let Some(event) = parse_event(&line) {
            // Capture session_id from Result events for pause/resume
            if let AgentEvent::Result { ref session_id, .. } = event {
                last_session_id = session_id.clone();
            }

            node_sequence += 1;
            let node_id = format!("{}-{}-{}", config.agent_id, config.ticket_id, node_sequence);

            let payload = CanvasNodePayload {
                node_id,
                agent_id: config.agent_id.clone(),
                ticket_id: config.ticket_id.clone(),
                event,
            };

            let _ = app.emit("agent-event", &payload);
        }
    }

    // Wait for the process to exit cleanly
    let status = child
        .wait()
        .await
        .context("failed to wait for claude process")?;

    info!(
        "[process::run] claude exited status={} agent={} ticket={}",
        status, config.agent_id, config.ticket_id
    );

    // Clean up the temp script file (Windows only; None on other platforms)
    if let Some(ref path) = temp_script {
        let _ = std::fs::remove_file(path);
    }

    // Emit the completion event regardless of exit status
    // React uses this to show the ask-user overlay if needed
    let _ = app.emit(
        "agent-result",
        &AgentResultPayload {
            agent_id: config.agent_id.clone(),
            ticket_id: config.ticket_id.clone(),
            session_id: last_session_id.clone(),
        },
    );

    if !status.success() {
        anyhow::bail!("claude process exited with status: {}", status);
    }

    Ok(last_session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_tools_join_format() {
        let tools = vec![
            "Read".to_string(),
            "Edit".to_string(),
            "Write".to_string(),
            "Bash(git:*)".to_string(),
        ];
        let joined = tools.join(",");
        assert_eq!(joined, "Read,Edit,Write,Bash(git:*)");
    }

    #[test]
    fn node_id_format() {
        let node_id = format!("{}-{}-{}", "agent-1", "ticket-42", 3);
        assert_eq!(node_id, "agent-1-ticket-42-3");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sh_quote_basic() {
        assert_eq!(super::sh_quote("hello world"), "'hello world'");
        assert_eq!(super::sh_quote("Bash(git:*)"), "'Bash(git:*)'");
        assert_eq!(super::sh_quote("it's fine"), r"'it'\''s fine'");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sh_quote_double_quotes() {
        // system prompt contains: gh pr create --title "..." --body "..."
        let s = r#"gh pr create --title "fix" --body "details""#;
        let quoted = super::sh_quote(s);
        assert!(quoted.starts_with('\''));
        assert!(quoted.ends_with('\''));
        assert!(quoted.contains("--title"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn wsl_distro_root_localhost() {
        let path = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\keenan\repo");
        assert_eq!(
            super::wsl_distro_root(&path),
            Some(r"\\wsl.localhost\Ubuntu".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn wsl_path_conversion_wsl_localhost() {
        let path = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\keenan\github\repo");
        assert_eq!(wsl_to_linux_path(&path), "/home/keenan/github/repo");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn wsl_path_conversion_wsl_dollar() {
        let path = PathBuf::from(r"\\wsl$\Ubuntu\home\keenan\github\repo");
        assert_eq!(wsl_to_linux_path(&path), "/home/keenan/github/repo");
    }
}
