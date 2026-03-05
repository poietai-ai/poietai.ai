mod agent;
mod context;
mod git;
mod github;
mod mcp;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use std::io::Write;

use log::{error, info};

use agent::state::{
    all_agents, get_agent, new_store, set_chatting, set_status, upsert_agent, AgentState,
    AgentStatus, StateStore,
};
/// Global app state — injected into Tauri commands via State<AppState>.
pub struct AppState {
    pub agents: StateStore,
    pub mcp: mcp::McpState,
}

// ── Agent management commands ─────────────────────────────────────────────────

/// Create a new agent and add it to the roster.
/// Called from React when the user creates a new agent.
#[tauri::command]
fn create_agent(
    state: State<'_, AppState>,
    id: String,
    name: String,
    role: String,
    personality: String,
    chat_session_id: Option<String>,
) -> Result<(), String> {
    let agent = AgentState {
        id: id.clone(),
        name,
        role,
        personality,
        status: AgentStatus::Idle,
        current_ticket_id: None,
        session_id: None,
        worktree_path: None,
        pr_number: None,
        chat_session_id,
        chatting: false,
    };
    upsert_agent(&state.agents, agent);
    Ok(())
}

/// Get all agents for the roster panel.
#[tauri::command]
fn get_all_agents(state: State<'_, AppState>) -> Vec<AgentState> {
    all_agents(&state.agents)
}

/// Scan a folder and return git repo information.
/// Returns SingleRepo, MultiRepo (one level deep), or NoRepo.
#[tauri::command]
fn scan_folder(path: String) -> Result<git::scan::FolderScanResult, String> {
    Ok(git::scan::scan_folder(std::path::Path::new(&path)))
}

// ── Agent execution commands ──────────────────────────────────────────────────

/// Payload from React to start an agent on a ticket.
/// Matches the shape React sends via invoke("start_agent", { payload: { ... } }).
#[derive(Deserialize)]
pub struct StartAgentPayload {
    pub agent_id: String,
    pub ticket_id: String,
    pub ticket_slug: String,
    pub prompt: String,
    pub system_prompt: String,
    pub repo_root: String,
    pub gh_token: String,
    pub resume_session_id: Option<String>,
    /// The current ticket phase (e.g. "brief", "design", "plan", "build", etc.).
    /// Defaults to Build if absent or unrecognised.
    pub phase: Option<String>,
    /// When set, skip worktree creation and run in this directory instead.
    /// Used by VALIDATE phase to reuse the BUILD agent's worktree.
    pub worktree_path_override: Option<String>,
    /// Optional JSON plan artifact from the Plan phase — used by the orchestrator
    /// to determine whether to fan-out the Build phase across parallel task groups.
    pub plan_artifact: Option<String>,
}

/// Assign a ticket to an agent and start the Claude process.
///
/// Returns immediately — the agent runs in a background tokio task.
/// Events arrive at React via "agent-event" and "agent-result" Tauri events.
#[tauri::command]
async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: StartAgentPayload,
) -> Result<(), String> {
    let agents_store = state.agents.clone();

    info!("[start_agent] agent={} ticket={} repo={}", payload.agent_id, payload.ticket_id, payload.repo_root);

    // Mark agent as working
    set_status(&agents_store, &payload.agent_id, AgentStatus::Working);
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.current_ticket_id = Some(payload.ticket_id.clone());
        upsert_agent(&agents_store, a);
    }

    // Build the OrchestratorInput from the payload — the orchestrator handles
    // worktree creation, phase prompt appending, and tool set selection internally.
    let phase_str = payload.phase
        .as_deref()
        .unwrap_or("build")
        .to_string();

    let mcp_port = state.mcp.port;

    let orchestrator_input = agent::orchestrator::OrchestratorInput {
        agent_id: payload.agent_id.clone(),
        ticket_id: payload.ticket_id.clone(),
        ticket_slug: payload.ticket_slug.clone(),
        prompt: payload.prompt.clone(),
        system_prompt: payload.system_prompt.clone(),
        repo_root: payload.repo_root.clone(),
        gh_token: payload.gh_token.clone(),
        phase: phase_str,
        worktree_path_override: payload.worktree_path_override,
        plan_artifact: payload.plan_artifact,
        group_id: None,
    };

    let app_clone = app.clone();
    let agents_store_clone = agents_store.clone();
    let agent_id = payload.agent_id.clone();

    info!("[start_agent] dispatching to orchestrator for agent={}", payload.agent_id);

    // Spawn the orchestrator run as a background task — this command returns immediately
    tokio::spawn(async move {
        match agent::orchestrator::run_ticket(orchestrator_input, app_clone, mcp_port).await {
            Ok(()) => {
                info!("[start_agent] agent={} orchestrator completed", agent_id);
                set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
            }
            Err(e) => {
                error!("[start_agent] orchestrator failed: {}", e);
                set_status(&agents_store_clone, &agent_id, AgentStatus::Blocked);
            }
        }
    });

    Ok(())
}

/// Resume a paused agent session with a user reply.
///
/// Does NOT create a new worktree — uses the agent's existing worktree_path.
/// The agent must have a worktree_path set (i.e. start_agent was called previously).
#[tauri::command]
async fn resume_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let agents_store = state.agents.clone();

    let agent = get_agent(&agents_store, &agent_id)
        .ok_or_else(|| format!("agent '{}' not found", agent_id))?;

    let worktree_path = agent
        .worktree_path
        .as_ref()
        .ok_or_else(|| format!("agent '{}' has no worktree — cannot resume", agent_id))?;

    let working_dir = PathBuf::from(worktree_path);

    let run_config = agent::process::AgentRunConfig {
        agent_id: agent_id.clone(),
        ticket_id: agent.current_ticket_id.clone().unwrap_or_default(),
        prompt,
        // No system prompt: --resume replays the original session context from Claude's side.
        system_prompt: String::new(),
        allowed_tools: vec![
            "Read".to_string(),
            "Edit".to_string(),
            "Write".to_string(),
            "Glob".to_string(),
            "Grep".to_string(),
            "Bash(git:*)".to_string(),
            "Bash(gh:*)".to_string(),
            "Bash(cargo:*)".to_string(),
            "Bash(npm:*)".to_string(),
            "Bash(npx:*)".to_string(),
            "Bash(node:*)".to_string(),
            "Bash(pnpm:*)".to_string(),
            "Bash(yarn:*)".to_string(),
            "Bash(ls:*)".to_string(),
            "Bash(mkdir:*)".to_string(),
            "Bash(cp:*)".to_string(),
            "Bash(mv:*)".to_string(),
            "Bash(cat:*)".to_string(),
            "Bash(echo:*)".to_string(),
        ],
        working_dir,
        // No new git identity: the existing worktree retains the identity set at start_agent time.
        env: vec![],
        resume_session_id: Some(session_id),
        mcp_port: state.mcp.port,
        group_id: None,
    };

    set_status(&agents_store, &agent_id, AgentStatus::Working);

    let app_clone = app.clone();
    let agents_store_clone = agents_store.clone();

    tokio::spawn(async move {
        match agent::process::run(run_config, app_clone).await {
            Ok(new_session_id) => {
                if let Some(sid) = new_session_id {
                    agent::state::save_session_id(&agents_store_clone, &agent_id, &sid);
                }
                set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
            }
            Err(e) => {
                eprintln!("agent '{}' resume failed: {}", agent_id, e);
                set_status(&agents_store_clone, &agent_id, AgentStatus::Blocked);
            }
        }
    });

    Ok(())
}

// ── Chat agent command ────────────────────────────────────────────────────────

/// Payload from React to start a chat session with an agent.
#[derive(Deserialize)]
pub struct ChatAgentPayload {
    pub agent_id: String,
    pub message: String,
    /// Full system prompt — only used on cold start (no existing chat_session_id).
    pub system_prompt: String,
    /// State deltas injected via --append-system-prompt on resume.
    pub context_update: String,
}

/// Start or resume a persistent chat session with an agent.
///
/// Lightweight variant of start_agent: no worktree, no ticket, minimal tools.
/// Uses a stable working directory at $HOME/.poietai/chat/<agent_id>/.
#[tauri::command]
async fn chat_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: ChatAgentPayload,
) -> Result<(), String> {
    let agents_store = state.agents.clone();

    // Check if already processing a chat message
    let agent = get_agent(&agents_store, &payload.agent_id)
        .ok_or_else(|| format!("agent '{}' not found", payload.agent_id))?;
    if agent.chatting {
        return Err("agent is already processing a chat message".to_string());
    }

    set_chatting(&agents_store, &payload.agent_id, true);

    // Determine cold start vs resume
    let is_cold_start = agent.chat_session_id.is_none();

    // Stable working directory: $HOME/.poietai/chat/<agent_id>/
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let working_dir = PathBuf::from(&home)
        .join(".poietai")
        .join("chat")
        .join(&payload.agent_id);

    // Ensure directory exists
    std::fs::create_dir_all(&working_dir)
        .map_err(|e| format!("failed to create chat dir: {}", e))?;

    let (system_prompt, resume_session_id) = if is_cold_start {
        (payload.system_prompt.clone(), None)
    } else {
        // On resume, inject context updates (or empty string if none)
        (payload.context_update.clone(), agent.chat_session_id.clone())
    };

    // Wrap messages starting with "/" so the CLI doesn't intercept them as slash commands
    let prompt = if payload.message.starts_with('/') {
        format!("User message: {}", payload.message)
    } else {
        payload.message.clone()
    };

    let run_config = agent::process::AgentRunConfig {
        agent_id: payload.agent_id.clone(),
        ticket_id: "chat".to_string(),
        prompt,
        system_prompt,
        allowed_tools: vec![
            "Read".to_string(),
            "Glob".to_string(),
            "Grep".to_string(),
            "mcp__poietai__list_tickets".to_string(),
            "mcp__poietai__get_ticket_details".to_string(),
            "mcp__poietai__ask_human".to_string(),
            "mcp__poietai__status_update".to_string(),
        ],
        working_dir,
        env: vec![],
        resume_session_id,
        mcp_port: state.mcp.port,
        group_id: None,
    };

    let app_clone = app.clone();
    let agents_store_clone = agents_store.clone();
    let agent_id = payload.agent_id.clone();

    info!("[chat_agent] agent={} cold_start={}", agent_id, is_cold_start);

    let app_for_error = app.clone();
    let agent_id_for_error = payload.agent_id.clone();

    tokio::spawn(async move {
        match agent::process::run(run_config, app_clone).await {
            Ok(session_id) => {
                info!("[chat_agent] agent={} completed, session={:?}", agent_id, session_id);
                if let Some(ref sid) = session_id {
                    agent::state::save_chat_session_id(&agents_store_clone, &agent_id, sid);
                }
                // No session_id means claude produced no output — likely a startup failure
                if session_id.is_none() {
                    let _ = app_for_error.emit("agent-chat-error", serde_json::json!({
                        "agent_id": agent_id_for_error,
                        "error": "Agent produced no response. Check MCP server connection.",
                    }));
                }
                set_chatting(&agents_store_clone, &agent_id, false);
            }
            Err(e) => {
                error!("[chat_agent] agent={} chat failed: {}", agent_id, e);
                let _ = app_for_error.emit("agent-chat-error", serde_json::json!({
                    "agent_id": agent_id_for_error,
                    "error": format!("{}", e),
                }));
                set_chatting(&agents_store_clone, &agent_id, false);
            }
        }
    });

    Ok(())
}

// ── GitHub polling command ────────────────────────────────────────────────────

/// Start polling a PR for CI reviews.
/// Call this after the agent opens a PR (detected from agent-event stream).
#[tauri::command]
async fn start_pr_poll(
    app: tauri::AppHandle,
    agent_id: String,
    ticket_id: String,
    repo: String,
    pr_number: u32,
) {
    tokio::spawn(github::poller::poll_pr(
        app, repo, pr_number, agent_id, ticket_id, 30, // poll every 30 seconds
    ));
}

/// Deliver a human reply to a waiting ask_human MCP call.
/// Called from React when the user submits a reply in the AgentQuestionCard.
#[tauri::command]
async fn answer_agent(
    state: State<'_, AppState>,
    agent_id: String,
    reply: String,
) -> Result<(), String> {
    state.mcp.answer(&agent_id, reply).await
}

/// Deliver ticket data to a waiting list_tickets MCP call.
/// Called from React's AppShell when the agent-list-tickets event fires.
#[tauri::command]
async fn answer_tickets(
    state: State<'_, AppState>,
    request_id: String,
    data: String,
) -> Result<(), String> {
    state.mcp.answer_tickets(&request_id, data).await
}

/// Get the git diff for an agent's worktree relative to the base branch.
/// Returns the diff string for the VALIDATE phase to inspect.
#[tauri::command]
fn get_worktree_diff(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<String, String> {
    let agent = get_agent(&state.agents, &agent_id)
        .ok_or_else(|| format!("agent '{}' not found", agent_id))?;
    let worktree_path = agent
        .worktree_path
        .ok_or_else(|| format!("agent '{}' has no worktree", agent_id))?;

    // Try "git diff main...HEAD" first (works when branched off main)
    let output = std::process::Command::new("git")
        .args(["diff", "main...HEAD"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    if output.status.success() && !output.stdout.is_empty() {
        return String::from_utf8(output.stdout).map_err(|e| e.to_string());
    }

    // Fallback: diff against the immediate parent commit
    let fallback = std::process::Command::new("git")
        .args(["diff", "HEAD~1..HEAD"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("git diff fallback failed: {}", e))?;

    if !fallback.status.success() {
        let stderr = String::from_utf8_lossy(&fallback.stderr);
        return Err(format!("git diff fallback failed: {}", stderr));
    }

    String::from_utf8(fallback.stdout).map_err(|e| e.to_string())
}

// ── Project-scoped file store commands ─────────────────────────────────────────

/// Read a JSON file from `<project_root>/.poietai/<filename>`.
/// Returns `None` if the file doesn't exist.
#[tauri::command]
fn read_project_store(project_root: String, filename: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&project_root).join(".poietai").join(&filename);
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to read {}: {}", path.display(), e)),
    }
}

/// Write a JSON file to `<project_root>/.poietai/<filename>` atomically.
/// Creates the `.poietai/` directory if it doesn't exist.
/// Uses write-to-tmp + rename to prevent corruption on crash.
#[tauri::command]
fn write_project_store(project_root: String, filename: String, data: String) -> Result<(), String> {
    let dir = PathBuf::from(&project_root).join(".poietai");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create .poietai dir: {}", e))?;

    let target = dir.join(&filename);
    let tmp = dir.join(format!("{}.tmp", filename));

    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("failed to create tmp file: {}", e))?;
    file.write_all(data.as_bytes())
        .map_err(|e| format!("failed to write tmp file: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("failed to sync tmp file: {}", e))?;
    drop(file);

    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("failed to rename tmp → target: {}", e))?;

    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Derive a 32-byte vault key from the installation key + a fixed app salt.
                // sha2 is lighter than argon2 and adequate for a machine-specific key.
                let mut hasher = Sha256::new();
                hasher.update(password.as_bytes());
                hasher.update(b"poietai-vault-2026");
                hasher.finalize().to_vec()
            })
            .build(),
        )
        .setup(|app| {
            // Bind synchronously to grab the port before async runtime takes over.
            let listener = mcp::bind();
            let port = mcp::bound_port(&listener);
            let mcp = mcp::McpState::new(port);

            // Spawn the axum server — it takes clones of the pending Arcs.
            let pending = mcp.pending_questions.clone();
            let pending_tickets = mcp.pending_ticket_queries.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(mcp::serve(listener, pending, pending_tickets, app_handle));

            app.manage(AppState {
                agents: new_store(),
                mcp,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_agent,
            scan_folder,
            get_all_agents,
            get_worktree_diff,
            start_agent,
            resume_agent,
            chat_agent,
            start_pr_poll,
            answer_agent,
            answer_tickets,
            read_project_store,
            write_project_store,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
