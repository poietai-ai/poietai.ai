mod agent;
mod context;
mod git;
mod github;
mod mcp;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::State;

use log::{error, info, warn};

use agent::state::{
    all_agents, get_agent, new_store, set_status, upsert_agent, AgentState, AgentStatus, StateStore,
};

/// Global app state — injected into Tauri commands via State<AppState>.
pub struct AppState {
    pub agents: StateStore,
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
    let repo_root = PathBuf::from(&payload.repo_root);
    let agents_store = state.agents.clone();

    info!("[start_agent] agent={} ticket={} repo={}", payload.agent_id, payload.ticket_id, payload.repo_root);

    // Mark agent as working
    set_status(&agents_store, &payload.agent_id, AgentStatus::Working);
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.current_ticket_id = Some(payload.ticket_id.clone());
        upsert_agent(&agents_store, a);
    }

    // Look up agent for name/role (needed for worktree config)
    let agent = get_agent(&agents_store, &payload.agent_id)
        .ok_or_else(|| format!("agent '{}' not found", payload.agent_id))?;

    // Create the git worktree
    let wt_config = git::worktree::WorktreeConfig {
        repo_root: repo_root.clone(),
        ticket_id: payload.ticket_id.clone(),
        ticket_slug: payload.ticket_slug.clone(),
        agent_name: agent.name.clone(),
        agent_email: format!("{}@poietai.ai", agent.role),
    };

    info!("[start_agent] creating worktree for ticket={}", payload.ticket_id);
    let worktree = git::worktree::create(&wt_config)
        .map_err(|e| {
            error!("[start_agent] worktree creation failed: {}", e);
            format!("failed to create worktree: {}", e)
        })?;
    info!("[start_agent] worktree created at {:?}", worktree.path);

    // Save worktree path to agent state
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.worktree_path = Some(worktree.path.to_string_lossy().to_string());
        upsert_agent(&agents_store, a);
    }

    let env = git::worktree::agent_env(&wt_config, &payload.gh_token);

    let run_config = agent::process::AgentRunConfig {
        agent_id: payload.agent_id.clone(),
        ticket_id: payload.ticket_id.clone(),
        prompt: payload.prompt.clone(),
        system_prompt: payload.system_prompt.clone(),
        allowed_tools: vec![
            "Read".to_string(),
            "Edit".to_string(),
            "Write".to_string(),
            "Bash(git:*)".to_string(),
            "Bash(gh:*)".to_string(),
            "Bash(cargo:*)".to_string(),
            "Bash(pnpm:*)".to_string(),
        ],
        working_dir: worktree.path.clone(),
        env,
        resume_session_id: payload.resume_session_id,
    };

    let app_clone = app.clone();
    let agents_store_clone = agents_store.clone();
    let agent_id = payload.agent_id.clone();

    info!("[start_agent] spawning claude process for agent={}", payload.agent_id);

    // Spawn the agent run as a background task — this command returns immediately
    tokio::spawn(async move {
        match agent::process::run(run_config, app_clone).await {
            Ok(session_id) => {
                info!("[start_agent] agent={} completed, session={:?}", agent_id, session_id);
                if let Some(sid) = session_id {
                    agent::state::save_session_id(&agents_store_clone, &agent_id, &sid);
                }
                set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
            }
            Err(e) => {
                error!("[start_agent] agent={} run failed: {}", agent_id, e);
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
            "Bash(git:*)".to_string(),
            "Bash(gh:*)".to_string(),
            "Bash(cargo:*)".to_string(),
            "Bash(pnpm:*)".to_string(),
        ],
        working_dir,
        // No new git identity: the existing worktree retains the identity set at start_agent time.
        env: vec![],
        resume_session_id: Some(session_id),
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
        .manage(AppState {
            agents: new_store(),
        })
        .invoke_handler(tauri::generate_handler![
            create_agent,
            scan_folder,
            get_all_agents,
            start_agent,
            resume_agent,
            start_pr_poll,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
