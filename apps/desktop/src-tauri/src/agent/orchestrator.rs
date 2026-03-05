use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
