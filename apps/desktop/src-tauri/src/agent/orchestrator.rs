use anyhow::{Context, Result};
use log::info;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

use crate::agent::process::{self, AgentRunConfig};
use crate::context::builder::{ContextInput, TicketPhase};
use crate::git;
use crate::AppState;

// ── Orchestrator event payloads (emitted to frontend) ──

#[derive(Debug, Clone, Serialize)]
pub struct PhaseStartedPayload {
    pub ticket_id: String,
    pub phase: String,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhaseCompletedPayload {
    pub ticket_id: String,
    pub phase: String,
    pub artifact_content: Option<String>,
    pub result_summary: Option<serde_json::Value>,
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FanOutPayload {
    pub ticket_id: String,
    pub groups: Vec<FanOutGroup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FanOutGroup {
    pub group_id: String,
    pub agent_role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FanInPayload {
    pub ticket_id: String,
    pub merge_status: String,
    pub conflict_details: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorBlockedPayload {
    pub ticket_id: String,
    pub reason: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorQuestionPayload {
    pub ticket_id: String,
    pub agent_id: String,
    pub content: String,
    pub session_id: String,
}

// ── Internal state ──

#[derive(Debug, Clone, PartialEq)]
pub enum TaskGroupStatus {
    Pending,
    Running,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct TaskGroupRun {
    pub group_id: String,
    pub agent_role: String,
    pub worktree_branch: String,
    pub worktree_path: PathBuf,
    pub session_id: Option<String>,
    pub status: TaskGroupStatus,
    pub artifact_content: Option<String>,
}

/// Configuration passed from the frontend/Tauri command when starting a ticket run.
#[derive(Debug, Clone, Deserialize)]
pub struct OrchestratorInput {
    pub agent_id: String,
    pub ticket_id: String,
    pub ticket_slug: String,
    pub prompt: String,
    pub system_prompt: String,
    pub repo_root: String,
    pub gh_token: String,
    pub phase: String,
    pub worktree_path_override: Option<String>,
    pub plan_artifact: Option<String>,
}

// ── Phase orchestration ─────────────────────────────────────────────────────

/// Return the allowed tool set for a given phase.
///
/// Read-only phases (Validate, Qa, Security) get a minimal set;
/// all other phases get the full builder tool set.
pub fn phase_tools(phase: &TicketPhase) -> Vec<String> {
    match phase {
        TicketPhase::Validate | TicketPhase::Qa | TicketPhase::Security => vec![
            "Read".to_string(),
            "Grep".to_string(),
            "Glob".to_string(),
            "Bash(git:*)".to_string(),
        ],
        TicketPhase::Brief
        | TicketPhase::Design
        | TicketPhase::Plan
        | TicketPhase::Build
        | TicketPhase::Review
        | TicketPhase::Ship => vec![
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
    }
}

/// Get the git diff in a worktree directory.
///
/// Tries `git diff HEAD~1` first. If that fails (e.g. only one commit on
/// the branch), falls back to `git diff --cached` to catch staged changes.
pub async fn get_worktree_diff(worktree_path: &str) -> Result<String> {
    let output = tokio::process::Command::new("git")
        .args(["diff", "HEAD~1"])
        .current_dir(worktree_path)
        .output()
        .await
        .context("failed to run git diff HEAD~1")?;

    if output.status.success() && !output.stdout.is_empty() {
        return String::from_utf8(output.stdout).context("git diff output was not valid UTF-8");
    }

    // Fallback: diff cached changes against HEAD
    let fallback = tokio::process::Command::new("git")
        .args(["diff", "--cached"])
        .current_dir(worktree_path)
        .output()
        .await
        .context("failed to run git diff --cached")?;

    String::from_utf8(fallback.stdout).context("git diff fallback output was not valid UTF-8")
}

/// Run a single phase to completion.
///
/// 1. Emits `orchestrator-phase-started`
/// 2. Creates a worktree (or uses the override path)
/// 3. Builds the system prompt with the phase-specific section appended
/// 4. Calls `process::run` and waits for it to finish
/// 5. Emits `orchestrator-phase-completed`
/// 6. Returns the completed payload and optional session_id
pub async fn run_phase(
    input: &OrchestratorInput,
    app: &AppHandle,
    mcp_port: u16,
) -> Result<(PhaseCompletedPayload, Option<String>)> {
    // Parse the phase string into the enum
    let phase: TicketPhase = serde_json::from_str(&format!("\"{}\"", input.phase))
        .unwrap_or_default();

    info!(
        "[orchestrator::run_phase] ticket={} phase={} agent={}",
        input.ticket_id, input.phase, input.agent_id
    );

    // Emit phase-started event
    let _ = app.emit(
        "orchestrator-phase-started",
        &PhaseStartedPayload {
            ticket_id: input.ticket_id.clone(),
            phase: input.phase.clone(),
            group_id: None,
        },
    );

    // Resolve agent state for worktree config
    let app_state = app.state::<AppState>();
    let agent = crate::agent::state::get_agent(&app_state.agents, &input.agent_id);
    let agent_name = agent.as_ref().map(|a| a.name.clone()).unwrap_or_else(|| "Agent".to_string());
    let agent_role = agent.as_ref().map(|a| a.role.clone()).unwrap_or_else(|| "engineer".to_string());

    // Create worktree or use override
    let (working_dir, env) = if let Some(ref override_path) = input.worktree_path_override {
        info!("[orchestrator::run_phase] using worktree override at {}", override_path);
        (PathBuf::from(override_path), vec![])
    } else {
        let repo_root = PathBuf::from(&input.repo_root);
        let wt_config = git::worktree::WorktreeConfig {
            repo_root: repo_root.clone(),
            ticket_id: input.ticket_id.clone(),
            ticket_slug: input.ticket_slug.clone(),
            agent_name: agent_name.clone(),
            agent_email: format!("{}@poietai.ai", agent_role),
        };
        let worktree = git::worktree::create(&wt_config)
            .context("failed to create worktree for phase")?;
        let env = git::worktree::agent_env(&wt_config, &input.gh_token);

        // Save worktree path to agent state
        if let Some(mut a) = crate::agent::state::get_agent(&app_state.agents, &input.agent_id) {
            a.worktree_path = Some(worktree.path.to_string_lossy().to_string());
            crate::agent::state::upsert_agent(&app_state.agents, a);
        }

        (worktree.path, env)
    };

    // Append phase-specific instruction section to the system prompt
    let system_prompt_text = {
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
        let phase_section = dummy.phase_prompt_section(&phase);
        if phase_section.is_empty() {
            input.system_prompt.clone()
        } else {
            format!("{}\n\n{}", input.system_prompt, phase_section)
        }
    };

    let run_config = AgentRunConfig {
        agent_id: input.agent_id.clone(),
        ticket_id: input.ticket_id.clone(),
        prompt: input.prompt.clone(),
        system_prompt: system_prompt_text,
        allowed_tools: phase_tools(&phase),
        working_dir: working_dir.clone(),
        env,
        resume_session_id: None,
        mcp_port,
    };

    // Run the agent process and wait for completion
    let session_id = process::run(run_config, app.clone())
        .await
        .context("agent process failed during phase")?;

    let completed = PhaseCompletedPayload {
        ticket_id: input.ticket_id.clone(),
        phase: input.phase.clone(),
        artifact_content: None,
        result_summary: None,
        blocked: false,
    };

    let _ = app.emit("orchestrator-phase-completed", &completed);

    info!(
        "[orchestrator::run_phase] phase={} completed for ticket={}",
        input.phase, input.ticket_id
    );

    Ok((completed, session_id))
}

/// Main entry point: run the requested phase, then auto-chain review phases
/// if the initial phase was Build.
///
/// After a successful Build:
///   1. Get the worktree diff
///   2. Run Validate → Qa → Security in order
///   3. If any review phase reports blocked, emit `orchestrator-blocked` and stop
pub async fn run_ticket(input: OrchestratorInput, app: AppHandle, mcp_port: u16) -> Result<()> {
    info!(
        "[orchestrator::run_ticket] starting ticket={} phase={}",
        input.ticket_id, input.phase
    );

    // Run the initial phase
    let (completed, _session_id) = run_phase(&input, &app, mcp_port).await?;

    // If it was a Build phase and not blocked, auto-chain through review phases
    if input.phase == "build" && !completed.blocked {
        // Determine the worktree path — either from override or computed
        let worktree_path = input
            .worktree_path_override
            .clone()
            .unwrap_or_else(|| {
                let repo_root = PathBuf::from(&input.repo_root);
                git::worktree::Worktree::path_for(&repo_root, &input.ticket_id)
                    .to_string_lossy()
                    .to_string()
            });

        let review_phases = ["validate", "qa", "security"];

        for review_phase in &review_phases {
            // Get the current diff for the review agent to inspect
            let diff = get_worktree_diff(&worktree_path).await.unwrap_or_else(|e| {
                info!(
                    "[orchestrator::run_ticket] failed to get diff for {}: {}",
                    review_phase, e
                );
                String::new()
            });

            // Build a review prompt that includes the plan artifact and the diff
            let review_prompt = {
                let plan_section = input
                    .plan_artifact
                    .as_deref()
                    .map(|plan| format!("## Approved Plan\n\n{}\n\n", plan))
                    .unwrap_or_default();

                format!(
                    "{}## Code Changes (git diff)\n\n```diff\n{}\n```",
                    plan_section, diff
                )
            };

            let review_input = OrchestratorInput {
                agent_id: input.agent_id.clone(),
                ticket_id: input.ticket_id.clone(),
                ticket_slug: input.ticket_slug.clone(),
                prompt: review_prompt,
                system_prompt: input.system_prompt.clone(),
                repo_root: input.repo_root.clone(),
                gh_token: input.gh_token.clone(),
                phase: review_phase.to_string(),
                worktree_path_override: Some(worktree_path.clone()),
                plan_artifact: input.plan_artifact.clone(),
            };

            let (review_completed, _) = run_phase(&review_input, &app, mcp_port).await?;

            if review_completed.blocked {
                let _ = app.emit(
                    "orchestrator-blocked",
                    &OrchestratorBlockedPayload {
                        ticket_id: input.ticket_id.clone(),
                        reason: format!("{} phase reported issues", review_phase),
                        details: review_completed.artifact_content,
                    },
                );
                info!(
                    "[orchestrator::run_ticket] blocked at {} for ticket={}",
                    review_phase, input.ticket_id
                );
                break;
            }
        }
    }

    info!(
        "[orchestrator::run_ticket] ticket={} lifecycle complete",
        input.ticket_id
    );

    Ok(())
}
