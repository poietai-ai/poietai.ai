mod agent;
mod context;
mod git;
mod github;
mod mcp;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{Manager, State};

use log::{error, info, warn};

use agent::state::{
    all_agents, get_agent, new_store, set_status, upsert_agent, AgentState, AgentStatus, StateStore,
};
use context::builder::TicketPhase;

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
    /// The current ticket phase (e.g. "brief", "design", "plan", "build", etc.).
    /// Defaults to Build if absent or unrecognised.
    pub phase: Option<String>,
    /// When set, skip worktree creation and run in this directory instead.
    /// Used by VALIDATE phase to reuse the BUILD agent's worktree.
    pub worktree_path_override: Option<String>,
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

    // Resolve the ticket phase — deserialise from the lowercase string sent by React.
    // serde_json::from_str expects a JSON string value, so we wrap in quotes.
    let phase: TicketPhase = payload.phase
        .as_deref()
        .and_then(|p| serde_json::from_str(&format!("\"{}\"", p)).ok())
        .unwrap_or_default(); // defaults to TicketPhase::Build

    // Mark agent as working
    set_status(&agents_store, &payload.agent_id, AgentStatus::Working);
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.current_ticket_id = Some(payload.ticket_id.clone());
        upsert_agent(&agents_store, a);
    }

    // Look up agent for name/role (needed for worktree config)
    let agent = get_agent(&agents_store, &payload.agent_id)
        .ok_or_else(|| format!("agent '{}' not found", payload.agent_id))?;

    // Create the git worktree, or reuse an override path (e.g. for VALIDATE phase).
    let (working_dir, env) = if let Some(ref override_path) = payload.worktree_path_override {
        info!("[start_agent] using worktree override at {}", override_path);
        (PathBuf::from(override_path), vec![])
    } else {
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
        (worktree.path, env)
    };

    // Append a phase-specific instruction section to whatever system prompt React provided.
    let system_prompt_text = {
        let phase_section = {
            // We only need phase_prompt_section here; build a minimal ContextInput just to
            // call it, since the base system_prompt text already came from React.
            use context::builder::ContextInput;
            let dummy = ContextInput {
                role: "",
                personality: "",
                project_name: "",
                project_stack: "",
                project_context: "",
                ticket_number: 0,
                ticket_title: "",
                ticket_description: "",
                ticket_acceptance_criteria: &[],
                agent_id: "",
            };
            dummy.phase_prompt_section(&phase)
        };
        if phase_section.is_empty() {
            payload.system_prompt.clone()
        } else {
            format!("{}\n\n{}", payload.system_prompt, phase_section)
        }
    };

    let run_config = agent::process::AgentRunConfig {
        agent_id: payload.agent_id.clone(),
        ticket_id: payload.ticket_id.clone(),
        prompt: payload.prompt.clone(),
        system_prompt: system_prompt_text,
        allowed_tools: match phase {
            TicketPhase::Validate | TicketPhase::Qa | TicketPhase::Security => vec![
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Bash(git:*)".to_string(),
            ],
            _ => vec![
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
        },
        working_dir: working_dir.clone(),
        env,
        resume_session_id: payload.resume_session_id,
        mcp_port: state.mcp.port,
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

    String::from_utf8(fallback.stdout).map_err(|e| e.to_string())
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

            // Spawn the axum server — it takes a clone of the pending_questions Arc.
            let pending = mcp.pending_questions.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(mcp::serve(listener, pending, app_handle));

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
            start_pr_poll,
            answer_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
