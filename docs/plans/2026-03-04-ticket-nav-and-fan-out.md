# Ticket Navigation & Parallel Fan-out Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ticket chips (#N) navigate to the canvas, and move phase orchestration to Rust with parallel task group fan-out support.

**Architecture:** Phase lifecycle moves from TicketCanvas.tsx's `agent-result` useEffect (~300 lines) to a new `orchestrator.rs` Rust module. The orchestrator drives phase transitions, artifact parsing, auto-triggering, and parallel fan-out. The canvas becomes a pure display layer that renders events. Ticket navigation is wired through `navigationStore`.

**Tech Stack:** Rust (Tauri 2, tokio, serde), React 19, Zustand, ReactFlow

---

## Part A: Ticket Chip → Canvas Navigation

### Task 1: Add selectedTicketId to navigationStore

**Files:**
- Modify: `apps/desktop/src/store/navigationStore.ts`

**Step 1: Update the store**

Replace the full file:

```ts
import { create } from 'zustand';

interface NavigationStore {
  activeView: string;
  selectedTicketId: string | null;
  setActiveView: (view: string) => void;
  setSelectedTicketId: (ticketId: string) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  activeView: 'dashboard',
  selectedTicketId: null,
  setActiveView: (view) => set({ activeView: view }),
  setSelectedTicketId: (ticketId) => set({ activeView: 'graph', selectedTicketId: ticketId }),
}));
```

**Step 2: Commit**

```bash
git add apps/desktop/src/store/navigationStore.ts
git commit -m "feat: add selectedTicketId to navigationStore"
```

---

### Task 2: Wire TokenChip ticket click to canvas navigation

**Files:**
- Modify: `apps/desktop/src/components/messages/TokenChip.tsx`

**Step 1: Update the ticket click handler**

Find the `handleClick` inside `TicketChipWithTooltip` that currently does:
```ts
useNavigationStore.getState().setActiveView('dashboard');
useTicketStore.getState().selectTicket(ticket.id);
```

Replace with:
```ts
useNavigationStore.getState().setSelectedTicketId(ticket.id);
```

Remove the `useTicketStore` import if it becomes unused.

**Step 2: Verify** — build compiles, no TS errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/messages/TokenChip.tsx
git commit -m "feat: ticket chip click navigates to canvas"
```

---

### Task 3: Wire MainArea to read selectedTicketId

**Files:**
- Modify: `apps/desktop/src/components/layout/MainArea.tsx`

**Step 1: Update MainArea**

Replace the `graph` branch from:
```tsx
if (activeView === 'graph') {
  return (
    <main className="flex-1 overflow-hidden">
      <ErrorBoundary fallbackLabel="TicketCanvas">
        <TicketCanvas ticketId="ticket-1" />
      </ErrorBoundary>
    </main>
  );
}
```

To:
```tsx
if (activeView === 'graph') {
  return (
    <main className="flex-1 overflow-hidden">
      <ErrorBoundary fallbackLabel="TicketCanvas">
        {selectedTicketId ? (
          <TicketCanvas ticketId={selectedTicketId} />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="text-zinc-500 text-sm">Select a ticket to view its canvas</p>
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
```

Add the store import at the top and read `selectedTicketId` inside the component:
```ts
import { useNavigationStore } from '../../store/navigationStore';
// inside MainArea:
const selectedTicketId = useNavigationStore((s) => s.selectedTicketId);
```

**Step 2: Verify** — build compiles.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/MainArea.tsx
git commit -m "feat: MainArea reads selectedTicketId instead of hardcoded ticket-1"
```

---

### Task 4: Wire TicketBoard card click to set selectedTicketId

**Files:**
- Modify: `apps/desktop/src/components/board/TicketBoard.tsx`

**Step 1: Update the canvas navigation**

The board currently uses local state `canvasTicketId` to render `TicketCanvas` inline. Change the `onOpenCanvas` callback to navigate via the store instead:

```ts
import { useNavigationStore } from '../../store/navigationStore';

// Replace: const [canvasTicketId, setCanvasTicketId] = useState<string | null>(null);
// Replace: onOpenCanvas={setCanvasTicketId}
// With:
const setSelectedTicketId = useNavigationStore((s) => s.setSelectedTicketId);
// Pass: onOpenCanvas={setSelectedTicketId}
```

Remove the inline `<TicketCanvas>` rendering and the "← Board" back button since the canvas now lives in MainArea's `graph` view.

Remove the `canvasTicketId` state and the conditional rendering that uses it.

**Step 2: Verify** — build compiles.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/board/TicketBoard.tsx
git commit -m "feat: board card click navigates to canvas via navigationStore"
```

---

## Part B: Rust-Side Phase Orchestrator

### Task 5: Create result parsers in Rust

**Files:**
- Create: `apps/desktop/src-tauri/src/agent/parsers.rs`
- Modify: `apps/desktop/src-tauri/src/agent/mod.rs`

**Step 1: Write the parsers**

Port the three TS parsers to Rust. All follow the same pipe-delimited line format.

```rust
use serde::Serialize;

// ── Validate ──

#[derive(Debug, Clone, Serialize)]
pub struct ValidateResult {
    pub verified: usize,
    pub critical: usize,
    pub advisory: usize,
}

pub fn parse_validate_result(text: &str) -> ValidateResult {
    let mut verified = 0;
    let mut critical = 0;
    let mut advisory = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("VERIFIED |") {
            verified += 1;
        } else if trimmed.starts_with("MISMATCH |") {
            let parts: Vec<&str> = trimmed.split('|').map(|p| p.trim()).collect();
            if parts.len() >= 3 && parts.last().map(|p| p.to_uppercase()) == Some("CRITICAL".into()) {
                critical += 1;
            } else {
                advisory += 1;
            }
        }
    }

    ValidateResult { verified, critical, advisory }
}

// ── QA ──

#[derive(Debug, Clone, Serialize)]
pub struct QaResult {
    pub critical: usize,
    pub warnings: usize,
    pub advisory: usize,
}

pub fn parse_qa_result(text: &str) -> QaResult {
    let mut critical = 0;
    let mut warnings = 0;
    let mut advisory = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("CRITICAL |") {
            critical += 1;
        } else if trimmed.starts_with("WARNING |") {
            warnings += 1;
        } else if trimmed.starts_with("ADVISORY |") {
            advisory += 1;
        }
    }

    QaResult { critical, warnings, advisory }
}

// ── Security ──

#[derive(Debug, Clone, Serialize)]
pub struct SecurityResult {
    pub critical: usize,
    pub warnings: usize,
}

pub fn parse_security_result(text: &str) -> SecurityResult {
    let mut critical = 0;
    let mut warnings = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("CRITICAL |") {
            critical += 1;
        } else if trimmed.starts_with("WARNING |") {
            warnings += 1;
        }
    }

    SecurityResult { critical, warnings }
}
```

**Step 2: Add module export**

In `apps/desktop/src-tauri/src/agent/mod.rs`, add:
```rust
pub mod parsers;
```

**Step 3: Write tests**

Add `#[cfg(test)]` module at the bottom of `parsers.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_counts_verified_and_critical() {
        let text = "VERIFIED | widget renders | src/widget.tsx:10\nMISMATCH | missing null check | src/api.rs | CRITICAL\nMISMATCH | style differs | ADVISORY";
        let r = parse_validate_result(text);
        assert_eq!(r.verified, 1);
        assert_eq!(r.critical, 1);
        assert_eq!(r.advisory, 1);
    }

    #[test]
    fn qa_counts_all_severities() {
        let text = "CRITICAL | unused import | src/lib.rs:5\nWARNING | long function | src/main.rs\nADVISORY | consider renaming";
        let r = parse_qa_result(text);
        assert_eq!(r.critical, 1);
        assert_eq!(r.warnings, 1);
        assert_eq!(r.advisory, 1);
    }

    #[test]
    fn security_counts_critical_and_warnings() {
        let text = "CRITICAL | SQL Injection | raw query | src/db.rs:42\nWARNING | missing rate limit | src/api.rs";
        let r = parse_security_result(text);
        assert_eq!(r.critical, 1);
        assert_eq!(r.warnings, 1);
    }

    #[test]
    fn empty_input_returns_zeros() {
        assert_eq!(parse_validate_result("").verified, 0);
        assert_eq!(parse_qa_result("").critical, 0);
        assert_eq!(parse_security_result("").critical, 0);
    }
}
```

**Step 4: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test parsers -- --nocapture
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/parsers.rs apps/desktop/src-tauri/src/agent/mod.rs
git commit -m "feat: Rust result parsers for validate/qa/security phases"
```

---

### Task 6: Define orchestrator event payloads

**Files:**
- Create: `apps/desktop/src-tauri/src/agent/orchestrator.rs`

**Step 1: Define the event payload types and core structs**

This is the foundation — just types, no logic yet.

```rust
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
    pub merge_status: String, // "clean" | "conflict"
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

/// Configuration passed from the frontend when starting a ticket run.
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
    pub plan_artifact: Option<String>, // JSON string of PlanArtifact
}
```

**Step 2: Add module export**

In `apps/desktop/src-tauri/src/agent/mod.rs`:
```rust
pub mod orchestrator;
```

**Step 3: Verify** — `cargo check` passes.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/orchestrator.rs apps/desktop/src-tauri/src/agent/mod.rs
git commit -m "feat: orchestrator event payloads and core types"
```

---

### Task 7: Implement single-phase orchestration

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/orchestrator.rs`

This task implements the core `run_phase` function that handles a single (non-fan-out) phase. It replaces the logic currently in `TicketCanvas.tsx`'s `agent-result` handler.

**Step 1: Add the run_phase function**

```rust
use tauri::{AppHandle, Emitter};
use crate::agent::process::{self, AgentRunConfig, AgentResultPayload};
use crate::agent::parsers::{parse_validate_result, parse_qa_result, parse_security_result};
use crate::context::builder::TicketPhase;
use std::str::FromStr;
use anyhow::Result;

/// Run a single phase to completion.
/// Spawns the agent process, waits for it to finish, parses results,
/// and emits orchestrator events.
pub async fn run_phase(
    input: OrchestratorInput,
    app: AppHandle,
) -> Result<PhaseCompletedPayload> {
    let phase_str = input.phase.clone();

    // Emit phase-started
    let _ = app.emit("orchestrator-phase-started", PhaseStartedPayload {
        ticket_id: input.ticket_id.clone(),
        phase: phase_str.clone(),
        group_id: None,
    });

    // Build AgentRunConfig from OrchestratorInput
    let phase = TicketPhase::from_str(&input.phase).unwrap_or(TicketPhase::Build);
    let mcp_port = crate::mcp::get_port(&app);

    let working_dir = if let Some(ref wt) = input.worktree_path_override {
        PathBuf::from(wt)
    } else {
        // Create worktree for build phases, reuse for review phases
        let config = crate::git::worktree::WorktreeConfig {
            repo_root: PathBuf::from(&input.repo_root),
            ticket_id: input.ticket_id.clone(),
            ticket_slug: input.ticket_slug.clone(),
            agent_name: input.agent_id.clone(),
            agent_email: format!("{}@poietai.ai", input.agent_id),
        };
        let wt = crate::git::worktree::create(&config)?;
        wt.path
    };

    let env = crate::git::worktree::agent_env(
        &crate::git::worktree::WorktreeConfig {
            repo_root: PathBuf::from(&input.repo_root),
            ticket_id: input.ticket_id.clone(),
            ticket_slug: input.ticket_slug.clone(),
            agent_name: input.agent_id.clone(),
            agent_email: format!("{}@poietai.ai", input.agent_id),
        },
        &input.gh_token,
    );

    // Phase-gated tool set (read-only for review phases)
    let allowed_tools = phase_tools(&phase);

    let run_config = AgentRunConfig {
        agent_id: input.agent_id.clone(),
        ticket_id: input.ticket_id.clone(),
        prompt: input.prompt.clone(),
        system_prompt: input.system_prompt.clone(),
        allowed_tools,
        working_dir: working_dir.clone(),
        env,
        resume_session_id: None,
        mcp_port,
    };

    // Run the agent — this blocks until the Claude process exits
    let session_id = process::run(run_config, app.clone()).await?;

    // Parse the artifact from the last agent_message (emitted via agent-event)
    // The orchestrator doesn't read canvas nodes — it captures the session_id
    // and emits a completion event. The frontend handles artifact storage.
    let completed = PhaseCompletedPayload {
        ticket_id: input.ticket_id.clone(),
        phase: phase_str.clone(),
        artifact_content: None, // Frontend captures from agent-event stream
        result_summary: None,
        blocked: false,
    };

    // Emit phase-completed
    let _ = app.emit("orchestrator-phase-completed", completed.clone());

    // Emit question if session ended with a question
    if let Some(ref sid) = session_id {
        let _ = app.emit("orchestrator-question", OrchestratorQuestionPayload {
            ticket_id: input.ticket_id.clone(),
            agent_id: input.agent_id.clone(),
            content: String::new(), // Frontend reads from last agent_message node
            session_id: sid.clone(),
        });
    }

    Ok(completed)
}

/// Return the allowed tool set for a given phase.
fn phase_tools(phase: &TicketPhase) -> Vec<String> {
    match phase {
        TicketPhase::Validate | TicketPhase::Qa | TicketPhase::Security => {
            vec![
                "Read".into(), "Grep".into(), "Glob".into(),
                "Bash(git:*)".into(),
            ]
        }
        _ => {
            vec![
                "Read".into(), "Edit".into(), "Write".into(),
                "Glob".into(), "Grep".into(),
                "Bash(git:*)".into(), "Bash(gh:*)".into(),
                "Bash(cargo:*)".into(), "Bash(npm:*)".into(),
                "Bash(npx:*)".into(), "Bash(node:*)".into(),
                "Bash(pnpm:*)".into(), "Bash(yarn:*)".into(),
                "Bash(ls:*)".into(), "Bash(mkdir:*)".into(),
                "Bash(cp:*)".into(), "Bash(mv:*)".into(),
                "Bash(cat:*)".into(), "Bash(echo:*)".into(),
            ]
        }
    }
}
```

**Step 2: Add helper to get MCP port from AppHandle**

In `apps/desktop/src-tauri/src/mcp/server.rs` (or wherever `McpState` lives), add a public helper:

```rust
pub fn get_port(app: &AppHandle) -> u16 {
    app.state::<crate::AppState>().mcp.port
}
```

Check how the port is currently accessed in `lib.rs` and match that pattern.

**Step 3: Verify** — `cargo check` passes.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/orchestrator.rs apps/desktop/src-tauri/src/mcp/server.rs
git commit -m "feat: single-phase orchestration with run_phase"
```

---

### Task 8: Implement the full phase lifecycle chain

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/orchestrator.rs`

This adds `run_ticket` — the top-level function that chains phases together (build → validate → qa → security), replacing the auto-trigger logic in TicketCanvas.tsx.

**Step 1: Add run_ticket**

```rust
/// Run a full ticket lifecycle: execute the given phase, then auto-chain
/// through validate → qa → security if applicable.
///
/// This is the main entry point called from the `start_agent` Tauri command.
pub async fn run_ticket(
    input: OrchestratorInput,
    app: AppHandle,
) -> Result<()> {
    let phase = TicketPhase::from_str(&input.phase).unwrap_or(TicketPhase::Build);

    // Run the initial phase
    let result = run_phase(input.clone(), app.clone()).await?;

    // If this was a build phase, auto-chain through review phases
    if phase == TicketPhase::Build && !result.blocked {
        // Store the worktree path for review phases
        let worktree_path = input.worktree_path_override.clone()
            .unwrap_or_else(|| {
                let wt_path = crate::git::worktree::Worktree::path_for(
                    &PathBuf::from(&input.repo_root),
                    &input.ticket_id,
                );
                wt_path.to_string_lossy().to_string()
            });

        let review_phases = [
            ("validate", "Validate the following plan against the code changes."),
            ("qa", "Review the following code changes for quality issues."),
            ("security", "Review the following code changes for security vulnerabilities."),
        ];

        for (phase_name, prompt_prefix) in review_phases {
            // Get diff for the review prompt
            let diff = get_worktree_diff(&worktree_path).await.unwrap_or_default();

            let review_input = OrchestratorInput {
                phase: phase_name.to_string(),
                prompt: format!("{}\n\n## Git Diff\n{}", prompt_prefix, diff),
                worktree_path_override: Some(worktree_path.clone()),
                ..input.clone()
            };

            let phase_result = run_phase(review_input, app.clone()).await?;
            if phase_result.blocked {
                let _ = app.emit("orchestrator-blocked", OrchestratorBlockedPayload {
                    ticket_id: input.ticket_id.clone(),
                    reason: format!("Blocked by {} phase", phase_name),
                    details: None,
                });
                break;
            }
        }
    }

    Ok(())
}

/// Get the git diff from a worktree path.
async fn get_worktree_diff(worktree_path: &str) -> Result<String> {
    let output = tokio::process::Command::new("git")
        .args(["diff", "HEAD~1"])
        .current_dir(worktree_path)
        .output()
        .await?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
```

**Step 2: Verify** — `cargo check` passes.

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/orchestrator.rs
git commit -m "feat: full phase lifecycle chain in orchestrator"
```

---

### Task 9: Implement parallel fan-out

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/orchestrator.rs`

**Step 1: Add plan artifact parsing**

```rust
use serde::Deserialize;

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
```

**Step 2: Add fan-out build logic**

```rust
/// Run the build phase with parallel fan-out.
/// Creates a child worktree per task group, spawns concurrent agent sessions,
/// waits for all to complete, then merges branches back.
pub async fn run_fan_out_build(
    input: OrchestratorInput,
    plan: PlanArtifact,
    app: AppHandle,
) -> Result<bool> {
    let parent_worktree = input.worktree_path_override.clone()
        .unwrap_or_else(|| {
            crate::git::worktree::Worktree::path_for(
                &PathBuf::from(&input.repo_root),
                &input.ticket_id,
            ).to_string_lossy().to_string()
        });

    let parent_branch = crate::git::worktree::Worktree::branch_for(&input.ticket_slug);

    // Emit fan-out event
    let groups: Vec<FanOutGroup> = plan.task_groups.iter().map(|g| FanOutGroup {
        group_id: g.group_id.clone(),
        agent_role: g.agent_role.clone(),
    }).collect();

    let _ = app.emit("orchestrator-fan-out", FanOutPayload {
        ticket_id: input.ticket_id.clone(),
        groups,
    });

    // Create child worktrees and spawn concurrent sessions
    let mut join_set = tokio::task::JoinSet::new();

    for group in &plan.task_groups {
        let child_branch = format!("{}-{}", parent_branch, group.group_id);
        let child_path = PathBuf::from(&parent_worktree)
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join(format!("{}-{}", input.ticket_id, group.group_id));

        // Create child worktree branched from parent
        let output = tokio::process::Command::new("git")
            .args(["worktree", "add", "-B", &child_branch])
            .arg(&child_path)
            .arg(&parent_branch)
            .current_dir(&input.repo_root)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git worktree add failed for group {}: {}", group.group_id, stderr);
        }

        // Build group-scoped prompt
        let group_prompt = format!(
            "{}\n\nYou are working on task group '{}' ({}).\nOnly modify these files: {}",
            input.prompt,
            group.group_id,
            group.description,
            group.files_touched.join(", "),
        );

        let group_input = OrchestratorInput {
            prompt: group_prompt,
            worktree_path_override: Some(child_path.to_string_lossy().to_string()),
            ..input.clone()
        };

        let app_clone = app.clone();
        let group_id = group.group_id.clone();
        let ticket_id = input.ticket_id.clone();

        join_set.spawn(async move {
            let _ = app_clone.emit("orchestrator-phase-started", PhaseStartedPayload {
                ticket_id: ticket_id.clone(),
                phase: "build".to_string(),
                group_id: Some(group_id.clone()),
            });

            let result = run_phase(group_input, app_clone.clone()).await;
            (group_id, result)
        });
    }

    // Wait for all groups to complete
    let mut all_ok = true;
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((group_id, Ok(_))) => {
                log::info!("Group {} completed successfully", group_id);
            }
            Ok((group_id, Err(e))) => {
                log::error!("Group {} failed: {}", group_id, e);
                all_ok = false;
            }
            Err(e) => {
                log::error!("Join error: {}", e);
                all_ok = false;
            }
        }
    }

    if !all_ok {
        let _ = app.emit("orchestrator-blocked", OrchestratorBlockedPayload {
            ticket_id: input.ticket_id.clone(),
            reason: "One or more task groups failed".to_string(),
            details: None,
        });
        return Ok(true); // blocked
    }

    // Merge child branches back into parent
    let blocked = merge_fan_out_branches(
        &input.repo_root,
        &parent_worktree,
        &parent_branch,
        &plan.task_groups,
        &input.ticket_id,
        &app,
    ).await?;

    // Emit fan-in
    let _ = app.emit("orchestrator-fan-in", FanInPayload {
        ticket_id: input.ticket_id.clone(),
        merge_status: if blocked { "conflict" } else { "clean" }.to_string(),
        conflict_details: None,
    });

    Ok(blocked)
}

/// Merge child worktree branches back into the parent branch.
/// Returns true if blocked (merge conflict).
async fn merge_fan_out_branches(
    repo_root: &str,
    parent_worktree: &str,
    parent_branch: &str,
    task_groups: &[PlanTaskGroup],
    ticket_id: &str,
    app: &AppHandle,
) -> Result<bool> {
    for group in task_groups {
        let child_branch = format!("{}-{}", parent_branch, group.group_id);

        let output = tokio::process::Command::new("git")
            .args(["merge", "--no-ff", &child_branch])
            .current_dir(parent_worktree)
            .output()
            .await?;

        if !output.status.success() {
            // Abort the failed merge
            let _ = tokio::process::Command::new("git")
                .args(["merge", "--abort"])
                .current_dir(parent_worktree)
                .output()
                .await;

            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = app.emit("orchestrator-blocked", OrchestratorBlockedPayload {
                ticket_id: ticket_id.to_string(),
                reason: format!("Merge conflict merging group {}", group.group_id),
                details: Some(stderr.to_string()),
            });
            return Ok(true); // blocked
        }

        // Clean up child worktree
        let child_path = PathBuf::from(parent_worktree)
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join(format!("{}-{}", ticket_id, group.group_id));

        let _ = tokio::process::Command::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&child_path)
            .current_dir(repo_root)
            .output()
            .await;
    }

    Ok(false) // no conflicts
}
```

**Step 3: Update run_ticket to use fan-out when applicable**

In `run_ticket`, after running the build phase, check if a plan artifact exists and `parallelSafe == true`:

```rust
// In run_ticket, replace the simple run_phase call for Build:
if phase == TicketPhase::Build {
    // Check for plan artifact with parallel task groups
    let use_fan_out = input.plan_artifact.as_ref().and_then(|json| {
        serde_json::from_str::<PlanArtifact>(json).ok()
    }).filter(|plan| plan.parallel_safe && plan.task_groups.len() > 1);

    let blocked = if let Some(plan) = use_fan_out {
        run_fan_out_build(input.clone(), plan, app.clone()).await?
    } else {
        let result = run_phase(input.clone(), app.clone()).await?;
        result.blocked
    };

    if blocked {
        return Ok(());
    }

    // Continue with review phases...
}
```

**Step 4: Verify** — `cargo check` passes.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/orchestrator.rs
git commit -m "feat: parallel fan-out build with worktree branching and merge"
```

---

### Task 10: Add group_id to agent events

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/process.rs`

**Step 1: Add group_id to AgentRunConfig and CanvasNodePayload**

In `AgentRunConfig`, add:
```rust
pub group_id: Option<String>,
```

In `CanvasNodePayload`, add:
```rust
pub group_id: Option<String>,
```

**Step 2: Propagate group_id in event emission**

In the `run()` function where `CanvasNodePayload` is constructed and emitted, pass `config.group_id.clone()` to the `group_id` field.

**Step 3: Update all call sites** that construct `AgentRunConfig` to include `group_id: None` (in `lib.rs` for `start_agent`, `resume_agent`, `chat_agent`).

**Step 4: Verify** — `cargo check` passes.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/process.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add group_id to agent event payloads for swim lane routing"
```

---

### Task 11: Wire start_agent to orchestrator

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Replace the process::run spawn with orchestrator::run_ticket**

In the `start_agent` Tauri command, the current pattern is:

```rust
tokio::spawn(async move {
    match agent::process::run(run_config, app_clone).await {
        Ok(session_id) => { /* save session, set idle */ }
        Err(e) => { /* set blocked */ }
    }
});
```

Replace with:

```rust
tokio::spawn(async move {
    match agent::orchestrator::run_ticket(orchestrator_input, app_clone).await {
        Ok(()) => { /* set idle */ }
        Err(e) => { /* set blocked, log error */ }
    }
});
```

Build `OrchestratorInput` from the existing payload fields. The `plan_artifact` field should be read from the ticket's `plan` artifact if available (passed from the frontend payload or looked up).

**Step 2: Keep resume_agent and chat_agent unchanged** — they still call `process::run` directly since they don't go through the phase lifecycle.

**Step 3: Verify** — `cargo check` passes.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: start_agent delegates to orchestrator instead of raw process::run"
```

---

## Part C: Frontend Updates

### Task 12: Remove phase logic from TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Delete the agent-result useEffect**

Delete the entire `useEffect` block at lines 55-371 (the one that listens for `agent-result` and handles phase transitions, auto-triggering, and question routing).

**Step 2: Remove unused imports**

Remove imports that were only used by the deleted code:
- `invoke` from `@tauri-apps/api/core`
- `parseValidateResult`, `parseQaResult`, `parseSecurityResult`
- `buildPrompt`
- `useProjectStore`, `useSecretsStore`, `useMessageStore`
- `AgentResultPayload` interface

**Step 3: Verify** — `pnpm tsc --noEmit` passes (no TS errors).

**Step 4: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "refactor: remove phase orchestration from TicketCanvas (moved to Rust)"
```

---

### Task 13: Add orchestrator event listeners to AppShell

**Files:**
- Modify: `apps/desktop/src/components/layout/AppShell.tsx`

**Step 1: Add event listeners for orchestrator events**

In the `useEffect` that sets up Tauri event listeners, add:

```ts
// Orchestrator: phase completed — advance ticket phase + store artifact
const unlistenPhaseCompleted = listen<{
  ticket_id: string;
  phase: string;
  artifact_content?: string;
  blocked: boolean;
}>('orchestrator-phase-completed', (event) => {
  const { ticket_id, phase, artifact_content, blocked } = event.payload;

  if (artifact_content) {
    useTicketStore.getState().setPhaseArtifact(ticket_id, {
      phase: phase as any,
      content: artifact_content,
      createdAt: new Date().toISOString(),
      agentId: '',
    });
  }

  if (blocked) {
    useTicketStore.getState().blockTicket(ticket_id);
  } else {
    useTicketStore.getState().advanceTicketPhase(ticket_id);
  }
});

// Orchestrator: blocked
const unlistenBlocked = listen<{
  ticket_id: string;
  reason: string;
  details?: string;
}>('orchestrator-blocked', (event) => {
  const { ticket_id, reason } = event.payload;
  useTicketStore.getState().blockTicket(ticket_id);
  addToast({ type: 'error', message: `Ticket blocked: ${reason}` });
});

// Orchestrator: question — route to DM
const unlistenOrcQuestion = listen<{
  ticket_id: string;
  agent_id: string;
  content: string;
  session_id: string;
}>('orchestrator-question', (event) => {
  const { ticket_id, agent_id, content, session_id } = event.payload;
  if (!content) return;
  const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
  useMessageStore.getState().addMessage({
    id: `dm-resume-${agent_id}-${Date.now()}`,
    threadId: agent_id,
    threadType: 'dm',
    from: 'agent',
    agentId: agent_id,
    agentName: agent?.name ?? agent_id,
    content,
    type: 'question',
    ticketId: ticket_id,
    timestamp: Date.now(),
    resolved: false,
    sessionId: session_id,
  });
});
```

**Step 2: Add cleanup** — add the unlistens to the cleanup function.

**Step 3: Verify** — build compiles.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/layout/AppShell.tsx
git commit -m "feat: AppShell listens for orchestrator events and syncs ticket store"
```

---

### Task 14: Add swim lane support to canvasStore

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`

**Step 1: Add lane-aware positioning**

Add constants:
```ts
const LANE_HEIGHT = 260;
```

In `addNodeFromEvent`, update the y-position calculation. When `payload.group_id` is present:

```ts
// After determining the node type and before calculating position:
const groupId = (payload as any).group_id as string | undefined;

// Track lane assignments
const laneIndex = groupId
  ? (get().laneAssignments[groupId] ?? 0)
  : 0;

const nonGhostNodesInLane = groupId
  ? nodes.filter((n) => !n.data.isGhost && n.data.groupId === groupId).length
  : nodes.filter((n) => !n.data.isGhost).length;

const x = nonGhostNodesInLane * NODE_HORIZONTAL_SPACING;
const y = 80 + laneIndex * LANE_HEIGHT;
```

Add `laneAssignments: Record<string, number>` to the store state and `groupId` to `CanvasNodeData`.

**Step 2: Add fan-out and fan-in node actions**

```ts
addFanOutNode: (ticketId: string, groups: { group_id: string; agent_role: string }[]) => {
  set((state) => {
    const laneAssignments: Record<string, number> = {};
    groups.forEach((g, i) => { laneAssignments[g.group_id] = i; });

    const lastNonGhost = [...state.nodes].reverse().find((n) => !n.data.isGhost);
    const x = lastNonGhost ? lastNonGhost.position.x + NODE_HORIZONTAL_SPACING : 0;

    const node: Node<CanvasNodeData> = {
      id: `fan-out-${ticketId}-${Date.now()}`,
      type: 'fan_out',
      position: { x, y: 80 },
      data: {
        nodeType: 'fan_out',
        content: `Building in parallel (${groups.length} groups)`,
        groups,
        isGhost: false,
        activated: false,
      },
    };

    return { nodes: [...state.nodes, node], laneAssignments };
  });
},

addFanInNode: (ticketId: string, mergeStatus: string) => {
  set((state) => {
    // Position after the rightmost node across all lanes
    const maxX = Math.max(...state.nodes.filter((n) => !n.data.isGhost).map((n) => n.position.x), 0);
    const x = maxX + NODE_HORIZONTAL_SPACING;

    const node: Node<CanvasNodeData> = {
      id: `fan-in-${ticketId}-${Date.now()}`,
      type: 'fan_in',
      position: { x, y: 80 },
      data: {
        nodeType: 'fan_in',
        content: mergeStatus === 'clean' ? 'Merge successful' : 'Merge conflict',
        mergeStatus,
        isGhost: false,
        activated: false,
      },
    };

    return { nodes: [...state.nodes, node], laneAssignments: {} };
  });
},
```

**Step 3: Verify** — `pnpm tsc --noEmit` passes.

**Step 4: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts
git commit -m "feat: swim lane positioning and fan-out/fan-in nodes in canvasStore"
```

---

### Task 15: Add orchestrator canvas event listeners to TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Add listeners for fan-out and fan-in events**

```ts
// Listen for fan-out — add fan-out node to canvas
useEffect(() => {
  const unlisten = listen<{ ticket_id: string; groups: { group_id: string; agent_role: string }[] }>(
    'orchestrator-fan-out',
    (event) => {
      useCanvasStore.getState().addFanOutNode(event.payload.ticket_id, event.payload.groups);
    },
  );
  return () => { unlisten.then((fn) => fn()); };
}, []);

// Listen for fan-in — add merge result node to canvas
useEffect(() => {
  const unlisten = listen<{ ticket_id: string; merge_status: string }>(
    'orchestrator-fan-in',
    (event) => {
      useCanvasStore.getState().addFanInNode(event.payload.ticket_id, event.payload.merge_status);
    },
  );
  return () => { unlisten.then((fn) => fn()); };
}, []);
```

**Step 2: Verify** — build compiles.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat: TicketCanvas listens for fan-out/fan-in orchestrator events"
```

---

### Task 16: Integration smoke test

**Step 1: Run all frontend tests**

```bash
cd apps/desktop && npx vitest run
```

Expected: all tests pass.

**Step 2: Run Rust tests**

```bash
cd apps/desktop/src-tauri && cargo test
```

Expected: all tests pass (including new parser tests).

**Step 3: Build the full app**

```bash
cd apps/desktop && pnpm tauri build --debug 2>&1 | tail -20
```

Expected: builds without errors.

**Step 4: Commit any fixups**

```bash
git add -A && git commit -m "fix: integration fixups from smoke test"
```

(Only if there are fixes needed.)
