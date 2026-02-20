mod agent;
mod context;
mod git;
mod github;

use std::path::PathBuf;
use tauri::State;
use serde::Deserialize;

use agent::state::{
    AgentState, AgentStatus, StateStore,
    new_store, upsert_agent, all_agents, get_agent, set_status,
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

    let worktree = git::worktree::create(&wt_config)
        .map_err(|e| format!("failed to create worktree: {}", e))?;

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

    // Spawn the agent run as a background task — this command returns immediately
    tokio::spawn(async move {
        match agent::process::run(run_config, app_clone).await {
            Ok(()) => {
                set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
            }
            Err(e) => {
                eprintln!("agent '{}' run failed: {}", agent_id, e);
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
        app,
        repo,
        pr_number,
        agent_id,
        ticket_id,
        30, // poll every 30 seconds
    ));
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            agents: new_store(),
        })
        .invoke_handler(tauri::generate_handler![
            create_agent,
            get_all_agents,
            start_agent,
            start_pr_poll,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
