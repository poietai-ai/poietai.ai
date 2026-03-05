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
    /// Optional group ID — set during fan-out builds so agent events carry the
    /// group identifier through to the frontend.
    pub group_id: Option<String>,
}

// ── Plan artifact types (deserialized from input.plan_artifact JSON) ────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanArtifact {
    pub ticket_id: String,
    pub task_groups: Vec<PlanTaskGroup>,
    pub file_conflict_check: FileConflictCheck,
    pub parallel_safe: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTaskGroup {
    pub group_id: String,
    pub agent_role: String,
    pub description: String,
    pub files_touched: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileConflictCheck {
    pub conflicts: Vec<String>,
    pub status: String,
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

/// Run the build phase using parallel fan-out across task groups.
///
/// Each task group gets its own child worktree branched from the parent ticket
/// branch.  All groups are spawned concurrently via a `JoinSet`; once every
/// group succeeds the child branches are merged back into the parent branch
/// sequentially.  If any group fails or a merge conflict occurs, the function
/// emits `orchestrator-blocked` and returns `blocked = true`.
pub async fn run_fan_out_build(
    input: &OrchestratorInput,
    plan: PlanArtifact,
    app: &AppHandle,
    mcp_port: u16,
) -> Result<bool> {
    let repo_root = PathBuf::from(&input.repo_root);

    // Resolve parent worktree path and branch
    let parent_wt_path = input
        .worktree_path_override
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| git::worktree::Worktree::path_for(&repo_root, &input.ticket_id));

    let parent_branch = git::worktree::Worktree::branch_for(&input.ticket_slug);

    // The directory that contains the parent worktree — child worktrees will
    // be siblings of the parent.
    let worktrees_dir = parent_wt_path
        .parent()
        .unwrap_or(&repo_root)
        .to_path_buf();

    info!(
        "[orchestrator::run_fan_out_build] ticket={} groups={} parent_branch={}",
        input.ticket_id,
        plan.task_groups.len(),
        parent_branch
    );

    // Emit fan-out event to the frontend
    let _ = app.emit(
        "orchestrator-fan-out",
        &FanOutPayload {
            ticket_id: input.ticket_id.clone(),
            groups: plan
                .task_groups
                .iter()
                .map(|g| FanOutGroup {
                    group_id: g.group_id.clone(),
                    agent_role: g.agent_role.clone(),
                })
                .collect(),
        },
    );

    // ── Spawn child worktrees and build each group concurrently ──

    let mut join_set = tokio::task::JoinSet::new();

    for group in &plan.task_groups {
        let child_branch = format!("{}-{}", parent_branch, group.group_id);
        let child_path = worktrees_dir.join(format!("{}-{}", input.ticket_id, group.group_id));

        // Clean up any stale worktree at this path
        if child_path.exists() {
            let _ = tokio::process::Command::new("git")
                .args(["worktree", "remove", "--force"])
                .arg(&child_path)
                .current_dir(&repo_root)
                .output()
                .await;
            let _ = tokio::fs::remove_dir_all(&child_path).await;
        }

        // Create child worktree branching from parent branch
        let add_output = tokio::process::Command::new("git")
            .args(["worktree", "add", "-B"])
            .arg(&child_branch)
            .arg(&child_path)
            .arg(&parent_branch)
            .current_dir(&repo_root)
            .output()
            .await
            .context("failed to run git worktree add for child")?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            anyhow::bail!(
                "git worktree add failed for group {}: {}",
                group.group_id,
                stderr
            );
        }

        // Build a group-scoped prompt
        let group_prompt = format!(
            "{}\n\n## Task Group: {}\n\nRole: {}\nDescription: {}\nFiles to modify: {}\n\nFocus ONLY on the files listed above. Do not modify other files.",
            input.prompt,
            group.group_id,
            group.agent_role,
            group.description,
            group.files_touched.join(", ")
        );

        // Build scoped input with worktree override pointing to child path
        let group_input = OrchestratorInput {
            agent_id: input.agent_id.clone(),
            ticket_id: input.ticket_id.clone(),
            ticket_slug: input.ticket_slug.clone(),
            prompt: group_prompt,
            system_prompt: input.system_prompt.clone(),
            repo_root: input.repo_root.clone(),
            gh_token: input.gh_token.clone(),
            phase: "build".to_string(),
            worktree_path_override: Some(child_path.to_string_lossy().to_string()),
            plan_artifact: input.plan_artifact.clone(),
            group_id: Some(group.group_id.clone()),
        };

        let group_id = group.group_id.clone();
        let app_clone = app.clone();

        join_set.spawn(async move {
            // Emit phase-started with group_id
            let _ = app_clone.emit(
                "orchestrator-phase-started",
                &PhaseStartedPayload {
                    ticket_id: group_input.ticket_id.clone(),
                    phase: "build".to_string(),
                    group_id: Some(group_id.clone()),
                },
            );

            let result = run_phase(&group_input, &app_clone, mcp_port).await;
            (group_id, result)
        });
    }

    // ── Collect results ──

    let mut all_succeeded = true;
    let mut failure_details = Vec::new();

    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((group_id, Ok((completed, _session_id)))) => {
                if completed.blocked {
                    all_succeeded = false;
                    failure_details.push(format!("Group {} was blocked", group_id));
                } else {
                    info!(
                        "[orchestrator::run_fan_out_build] group {} completed successfully",
                        group_id
                    );
                }
            }
            Ok((group_id, Err(e))) => {
                all_succeeded = false;
                failure_details.push(format!("Group {} failed: {}", group_id, e));
            }
            Err(e) => {
                all_succeeded = false;
                failure_details.push(format!("Task join error: {}", e));
            }
        }
    }

    if !all_succeeded {
        let details = failure_details.join("; ");
        let _ = app.emit(
            "orchestrator-blocked",
            &OrchestratorBlockedPayload {
                ticket_id: input.ticket_id.clone(),
                reason: "One or more fan-out groups failed".to_string(),
                details: Some(details.clone()),
            },
        );
        info!(
            "[orchestrator::run_fan_out_build] blocked: {}",
            details
        );
        return Ok(true);
    }

    // ── Merge child branches back into parent ──

    for group in &plan.task_groups {
        let child_branch = format!("{}-{}", parent_branch, group.group_id);
        let child_path = worktrees_dir.join(format!("{}-{}", input.ticket_id, group.group_id));

        let merge_output = tokio::process::Command::new("git")
            .args(["merge", "--no-ff", &child_branch])
            .current_dir(&parent_wt_path)
            .output()
            .await
            .context("failed to run git merge")?;

        if !merge_output.status.success() {
            // Merge conflict — abort and report
            let _ = tokio::process::Command::new("git")
                .args(["merge", "--abort"])
                .current_dir(&parent_wt_path)
                .output()
                .await;

            let stderr = String::from_utf8_lossy(&merge_output.stderr).to_string();

            let _ = app.emit(
                "orchestrator-blocked",
                &OrchestratorBlockedPayload {
                    ticket_id: input.ticket_id.clone(),
                    reason: format!("Merge conflict merging group {}", group.group_id),
                    details: Some(stderr.clone()),
                },
            );

            let _ = app.emit(
                "orchestrator-fan-in",
                &FanInPayload {
                    ticket_id: input.ticket_id.clone(),
                    merge_status: "conflict".to_string(),
                    conflict_details: Some(stderr),
                },
            );

            info!(
                "[orchestrator::run_fan_out_build] merge conflict for group {}",
                group.group_id
            );

            return Ok(true);
        }

        // Clean merge — remove child worktree
        let _ = tokio::process::Command::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&child_path)
            .current_dir(&repo_root)
            .output()
            .await;
    }

    // All merges succeeded
    let _ = app.emit(
        "orchestrator-fan-in",
        &FanInPayload {
            ticket_id: input.ticket_id.clone(),
            merge_status: "clean".to_string(),
            conflict_details: None,
        },
    );

    info!(
        "[orchestrator::run_fan_out_build] all groups merged successfully for ticket={}",
        input.ticket_id
    );

    Ok(false)
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
        group_id: input.group_id.clone(),
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

    // Check for a plan artifact with parallel-safe task groups
    let use_fan_out = input
        .plan_artifact
        .as_ref()
        .and_then(|json| serde_json::from_str::<PlanArtifact>(json).ok())
        .filter(|plan| plan.parallel_safe && plan.task_groups.len() > 1);

    if input.phase == "build" {
        // Either fan-out across parallel task groups or run a single build phase
        let blocked = if let Some(plan) = use_fan_out {
            run_fan_out_build(&input, plan, &app, mcp_port).await?
        } else {
            let (result, _) = run_phase(&input, &app, mcp_port).await?;
            result.blocked
        };

        if !blocked {
            // Auto-chain through review phases after a successful build
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
                    group_id: None,
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
    } else {
        // Non-build phase: run as-is
        run_phase(&input, &app, mcp_port).await?;
    }

    info!(
        "[orchestrator::run_ticket] ticket={} lifecycle complete",
        input.ticket_id
    );

    Ok(())
}
