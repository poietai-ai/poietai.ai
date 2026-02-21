use anyhow::{Context, Result};
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

/// Run the agent and stream events to the React frontend.
///
/// This function is async. Call it from a tokio::spawn block.
/// It returns when the claude process exits (success or error).
///
/// Emits two event types to React:
/// - "agent-event": one per parsed JSONL line, with the canvas node payload
/// - "agent-result": once at the end, with the session ID (for pause/resume)
pub async fn run(config: AgentRunConfig, app: AppHandle) -> Result<Option<String>> {
    // On Windows, claude lives inside WSL2 — invoke it via wsl.exe.
    // --cd sets the working directory inside WSL using the Linux path.
    // On Linux/macOS, run claude directly.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let linux_dir = wsl_to_linux_path(&config.working_dir);
        let mut c = Command::new("wsl");
        c.arg("--cd").arg(linux_dir).arg("claude");
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new("claude");

    cmd.arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--append-system-prompt")
        .arg(&config.system_prompt)
        .arg("--allowedTools")
        .arg(config.allowed_tools.join(","));

    // If resuming a paused session, add --resume <session-id>
    if let Some(ref session_id) = config.resume_session_id {
        cmd.arg("--resume").arg(session_id);
    }

    // The prompt is the last argument
    cmd.arg(&config.prompt);

    // On Windows, --cd above handles the working directory.
    // On Linux/macOS, set it directly on the process.
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
