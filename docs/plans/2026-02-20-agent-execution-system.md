# Agent Execution System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the end-to-end loop: ticket assigned → agent runs in a git worktree → JSONL stream renders as live canvas nodes → agent asks you a question → you reply → agent continues → PR opens → CI review is fed back → merge approval DM arrives.

**Architecture:** Thin Rust orchestration layer (5 modules, ~200 lines each) spawns `claude --print --output-format stream-json` as a child process. Rust parses the JSONL stream, emits typed Tauri events to React. React renders events as a live node graph using `@xyflow/react`. Zustand manages canvas state. No agent logic lives in Rust — all intelligence is in Claude Code.

**Tech Stack:** Rust (tokio async, serde_json, tauri 2), Claude Code CLI 2.x, `gh` CLI, `git worktree`, `@xyflow/react`, Zustand, TypeScript

---

## Rust Primer (read before Task 1)

You know Go, so here are the translation concepts you'll use throughout this plan:

| Go concept | Rust equivalent |
|---|---|
| `goroutine` | `tokio::spawn(async { ... })` |
| `channel` (send/receive) | `tokio::sync::mpsc::channel` |
| `struct` with methods | `struct Foo { ... }` + `impl Foo { ... }` |
| `interface` | `trait` (you won't need many in this plan) |
| `error` return | `Result<T, anyhow::Error>` — `?` operator propagates like Go's `if err != nil { return err }` |
| `map[K]V` | `HashMap<K, V>` |
| `sync.Mutex` | `std::sync::Mutex<T>` — but the data *lives inside* the mutex |
| `sync.Mutex` shared across goroutines | `Arc<Mutex<T>>` — `Arc` is like a reference-counted pointer, `Mutex` wraps the data |
| `defer` | Drop trait (automatic) — most cleanup is implicit |
| `:=` | `let` (immutable) or `let mut` (mutable) |

The biggest mental shift: Rust's compiler is strict about who *owns* data. When you get an ownership/borrow error, **read the error message** — it tells you exactly what's wrong. Don't fight it; the compiler is teaching you.

---

## Task 1: Add Rust Dependencies

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Step 1: Add dependencies**

Open `apps/desktop/src-tauri/Cargo.toml` and replace the `[dependencies]` section:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
uuid = { version = "1", features = ["v4"] }
```

- `tokio` — async runtime (like Go's scheduler, but explicit). `features = ["full"]` gives you everything.
- `anyhow` — easy error handling. `anyhow::Error` can hold any error type. The `?` operator propagates it.
- `uuid` — for generating unique IDs for canvas nodes and agents.

**Step 2: Verify it compiles**

```bash
cd apps/desktop/src-tauri && cargo build 2>&1 | head -30
```

Expected: no errors, just downloading and compiling. May take a minute on first run.

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(rust): add tokio, anyhow, uuid dependencies"
```

---

## Task 2: AgentEvent Enum — The Event Parser

**Files:**
- Create: `apps/desktop/src-tauri/src/agent/mod.rs`
- Create: `apps/desktop/src-tauri/src/agent/events.rs`

This is the heart of the system. Every line of JSONL from `claude --print --output-format stream-json` maps to one of these variants. Rust's exhaustive enum pattern matching means if you forget a case, the compiler tells you.

**Step 1: Create the agent module directory and mod.rs**

Create `apps/desktop/src-tauri/src/agent/mod.rs`:

```rust
pub mod events;
pub mod process;
pub mod state;
```

(The `process` and `state` modules don't exist yet — that's Tasks 4 and 3. Rust will complain until you create them. You can comment out those two lines temporarily while building.)

**Step 2: Write the test first**

Create `apps/desktop/src-tauri/src/agent/events.rs`:

```rust
use serde::Deserialize;

/// Every event that can come from the Claude Code JSONL stream.
///
/// Claude Code --output-format stream-json emits one JSON object per line.
/// Each object has a "type" field we use to pick the right variant.
///
/// In Go terms: this is an interface{} with a type switch, but the compiler
/// enforces exhaustiveness at compile time.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// A thinking block — the agent's internal reasoning.
    /// Maps to canvas node type: ThoughtNode (indigo)
    Thinking {
        thinking: String,
    },

    /// A text message — the agent narrating what it's doing.
    /// Routed to ticket chat AND becomes a canvas node (neutral gray).
    Text {
        text: String,
    },

    /// Tool use start — which tool and with what input.
    /// We inspect `tool_name` to decide canvas node type.
    ToolUse {
        id: String,
        tool_name: String,
        tool_input: serde_json::Value,
    },

    /// Tool result — what the tool returned.
    /// Paired with ToolUse by `tool_use_id`.
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        is_error: Option<bool>,
    },

    /// The agent completed its run.
    Result {
        result: Option<String>,
        session_id: Option<String>,
    },
}

/// Parses a single JSONL line into an AgentEvent.
/// Returns None (not an error) for lines we don't recognize —
/// the stream has some bookkeeping lines we can safely ignore.
pub fn parse_event(line: &str) -> Option<AgentEvent> {
    serde_json::from_str(line).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thinking_event() {
        let line = r#"{"type":"thinking","thinking":"I need to check the billing service first"}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::Thinking { .. }));
        if let AgentEvent::Thinking { thinking } = event {
            assert!(thinking.contains("billing service"));
        }
    }

    #[test]
    fn parses_text_event() {
        let line = r#"{"type":"text","text":"Looking at the billing handler now."}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::Text { .. }));
    }

    #[test]
    fn parses_tool_use_event() {
        let line = r#"{"type":"tool_use","id":"tu_123","tool_name":"Read","tool_input":{"file_path":"src/billing.go"}}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::ToolUse { .. }));
        if let AgentEvent::ToolUse { tool_name, .. } = event {
            assert_eq!(tool_name, "Read");
        }
    }

    #[test]
    fn returns_none_for_unknown_type() {
        let line = r#"{"type":"some_unknown_bookkeeping_event","data":{}}"#;
        assert!(parse_event(line).is_none());
    }

    #[test]
    fn returns_none_for_malformed_json() {
        let line = "not json at all";
        assert!(parse_event(line).is_none());
    }
}
```

**Step 3: Run the tests**

```bash
cd apps/desktop/src-tauri && cargo test agent::events 2>&1
```

Expected: 5 tests pass.

**Step 4: Add the agent module to lib.rs**

Edit `apps/desktop/src-tauri/src/lib.rs` — add at the top (before the greet function):

```rust
mod agent;
```

(Comment out `pub mod process;` and `pub mod state;` in `agent/mod.rs` until those files exist.)

**Step 5: Build to confirm**

```bash
cd apps/desktop/src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add AgentEvent enum with serde parsing"
```

---

## Task 3: Agent State Store

**Files:**
- Create: `apps/desktop/src-tauri/src/agent/state.rs`

This is shared state that multiple async tasks read and write. In Go, you'd use `sync.Mutex` protecting a map. In Rust, the data lives *inside* the mutex: `Mutex<HashMap<...>>`. The `Arc` wrapper lets you hand out cheap clones (reference-counted pointers) to multiple tasks without copying the data.

**Step 1: Write the test first**

Create `apps/desktop/src-tauri/src/agent/state.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

/// The statuses an agent can be in.
/// In Go terms: a const iota enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    WaitingForUser,
    Reviewing,
    Blocked,
}

/// Everything we know about a running (or idle) agent.
#[derive(Debug, Clone, Serialize)]
pub struct AgentState {
    pub id: String,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub status: AgentStatus,
    /// The ticket this agent is currently working on, if any.
    pub current_ticket_id: Option<String>,
    /// The Claude Code session ID, used for --resume.
    pub session_id: Option<String>,
    /// Path to the git worktree, if one is active.
    pub worktree_path: Option<String>,
    /// The open PR number, if one exists.
    pub pr_number: Option<u32>,
}

/// The shared state store.
///
/// Arc = "Atomically Reference Counted" — a smart pointer you can clone cheaply
/// and share across threads. The data is freed when the last clone is dropped.
///
/// Mutex = mutual exclusion lock. In Rust, the data lives *inside* the Mutex,
/// not outside it. You can't forget to lock before accessing.
pub type StateStore = Arc<Mutex<HashMap<String, AgentState>>>;

/// Create a new empty state store.
pub fn new_store() -> StateStore {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Insert or update an agent in the store.
pub fn upsert_agent(store: &StateStore, agent: AgentState) {
    // .lock() returns a MutexGuard. The guard releases the lock when it's dropped.
    // .unwrap() panics if the mutex is poisoned (another thread panicked while holding it).
    // For a desktop app, panicking here is acceptable — the app state is corrupted anyway.
    let mut map = store.lock().unwrap();
    map.insert(agent.id.clone(), agent);
}

/// Get a snapshot of an agent's state.
pub fn get_agent(store: &StateStore, id: &str) -> Option<AgentState> {
    let map = store.lock().unwrap();
    map.get(id).cloned()
}

/// Get all agents as a Vec (for sending to the frontend).
pub fn all_agents(store: &StateStore) -> Vec<AgentState> {
    let map = store.lock().unwrap();
    map.values().cloned().collect()
}

/// Update just the status of an agent.
pub fn set_status(store: &StateStore, id: &str, status: AgentStatus) {
    let mut map = store.lock().unwrap();
    if let Some(agent) = map.get_mut(id) {
        agent.status = status;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_agent(id: &str, status: AgentStatus) -> AgentState {
        AgentState {
            id: id.to_string(),
            name: "Test Agent".to_string(),
            role: "backend-engineer".to_string(),
            personality: "pragmatic".to_string(),
            status,
            current_ticket_id: None,
            session_id: None,
            worktree_path: None,
            pr_number: None,
        }
    }

    #[test]
    fn insert_and_retrieve_agent() {
        let store = new_store();
        let agent = make_agent("agent-1", AgentStatus::Idle);
        upsert_agent(&store, agent);

        let retrieved = get_agent(&store, "agent-1").expect("agent should exist");
        assert_eq!(retrieved.id, "agent-1");
        assert_eq!(retrieved.status, AgentStatus::Idle);
    }

    #[test]
    fn update_agent_status() {
        let store = new_store();
        upsert_agent(&store, make_agent("agent-2", AgentStatus::Idle));
        set_status(&store, "agent-2", AgentStatus::Working);

        let agent = get_agent(&store, "agent-2").unwrap();
        assert_eq!(agent.status, AgentStatus::Working);
    }

    #[test]
    fn all_agents_returns_all() {
        let store = new_store();
        upsert_agent(&store, make_agent("a1", AgentStatus::Idle));
        upsert_agent(&store, make_agent("a2", AgentStatus::Working));

        let all = all_agents(&store);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn missing_agent_returns_none() {
        let store = new_store();
        assert!(get_agent(&store, "nonexistent").is_none());
    }
}
```

**Step 2: Uncomment state in mod.rs**

Edit `apps/desktop/src-tauri/src/agent/mod.rs`:

```rust
pub mod events;
pub mod process; // still commented out until Task 4
pub mod state;
```

**Step 3: Run the tests**

```bash
cd apps/desktop/src-tauri && cargo test agent::state 2>&1
```

Expected: 4 tests pass.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/state.rs
git add apps/desktop/src-tauri/src/agent/mod.rs
git commit -m "feat(rust): add AgentState store with Arc<Mutex<HashMap>>"
```

---

## Task 4: Worktree Manager

**Files:**
- Create: `apps/desktop/src-tauri/src/git/mod.rs`
- Create: `apps/desktop/src-tauri/src/git/worktree.rs`

Each agent works in an isolated git worktree — a separate working directory on a separate branch, sharing the same `.git` history. No two agents step on each other's files.

**Step 1: Create git module**

Create `apps/desktop/src-tauri/src/git/mod.rs`:

```rust
pub mod worktree;
```

**Step 2: Write tests first**

Create `apps/desktop/src-tauri/src/git/worktree.rs`:

```rust
use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Context, Result};

/// Configuration for a new worktree.
pub struct WorktreeConfig {
    /// The root of the main git repo.
    pub repo_root: PathBuf,
    /// The ticket ID — used to name the worktree directory and branch.
    pub ticket_id: String,
    /// Human-readable slug for the branch name, e.g. "fix-billing-nil-guard".
    pub ticket_slug: String,
    /// Agent display name for git commits.
    pub agent_name: String,
    /// Agent email for git commits.
    pub agent_email: String,
}

/// A created worktree, ready for agent use.
#[derive(Debug, Clone)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub ticket_id: String,
}

impl Worktree {
    /// The branch name for this ticket.
    /// Format: feat/<ticket-slug>
    pub fn branch_for(slug: &str) -> String {
        format!("feat/{}", slug)
    }

    /// The worktree directory path.
    /// Format: <repo_root>/.worktrees/<ticket-id>
    pub fn path_for(repo_root: &Path, ticket_id: &str) -> PathBuf {
        repo_root.join(".worktrees").join(ticket_id)
    }
}

/// Create a new git worktree for a ticket.
///
/// Equivalent to: git worktree add .worktrees/<ticket-id> -b feat/<slug>
pub fn create(config: &WorktreeConfig) -> Result<Worktree> {
    let branch = Worktree::branch_for(&config.ticket_slug);
    let path = Worktree::path_for(&config.repo_root, &config.ticket_id);

    // Run: git worktree add <path> -b <branch>
    let output = Command::new("git")
        .args(["worktree", "add", path.to_str().unwrap(), "-b", &branch])
        .current_dir(&config.repo_root)
        .output()
        .context("failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {}", stderr);
    }

    Ok(Worktree {
        path,
        branch,
        ticket_id: config.ticket_id.clone(),
    })
}

/// Remove a worktree after the ticket is done.
///
/// Equivalent to: git worktree remove <path> --force
pub fn remove(repo_root: &Path, worktree_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args(["worktree", "remove", worktree_path.to_str().unwrap(), "--force"])
        .current_dir(repo_root)
        .output()
        .context("failed to run git worktree remove")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree remove failed: {}", stderr);
    }

    Ok(())
}

/// Build the environment variables to inject into the agent process.
/// Sets git author identity so commits show the agent's name.
pub fn agent_env(config: &WorktreeConfig, gh_token: &str) -> Vec<(String, String)> {
    vec![
        ("GIT_AUTHOR_NAME".to_string(), config.agent_name.clone()),
        ("GIT_AUTHOR_EMAIL".to_string(), config.agent_email.clone()),
        ("GIT_COMMITTER_NAME".to_string(), config.agent_name.clone()),
        ("GIT_COMMITTER_EMAIL".to_string(), config.agent_email.clone()),
        ("GH_TOKEN".to_string(), gh_token.to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_name_format() {
        let branch = Worktree::branch_for("fix-billing-nil-guard");
        assert_eq!(branch, "feat/fix-billing-nil-guard");
    }

    #[test]
    fn worktree_path_format() {
        let root = PathBuf::from("/home/user/myrepo");
        let path = Worktree::path_for(&root, "ticket-42");
        assert_eq!(path, PathBuf::from("/home/user/myrepo/.worktrees/ticket-42"));
    }

    #[test]
    fn agent_env_sets_git_identity() {
        let config = WorktreeConfig {
            repo_root: PathBuf::from("/tmp/repo"),
            ticket_id: "t-1".to_string(),
            ticket_slug: "fix-thing".to_string(),
            agent_name: "Staff Engineer".to_string(),
            agent_email: "staff-engineer@poietai.ai".to_string(),
        };
        let env = agent_env(&config, "gh_token_abc");

        let git_author: Vec<_> = env.iter()
            .filter(|(k, _)| k == "GIT_AUTHOR_NAME")
            .collect();
        assert_eq!(git_author.len(), 1);
        assert_eq!(git_author[0].1, "Staff Engineer");

        let gh_tok: Vec<_> = env.iter()
            .filter(|(k, _)| k == "GH_TOKEN")
            .collect();
        assert_eq!(gh_tok[0].1, "gh_token_abc");
    }
}
```

**Step 3: Add git module to lib.rs**

Edit `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod agent;
mod git;
```

**Step 4: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test git::worktree 2>&1
```

Expected: 3 tests pass. (The `create`/`remove` functions aren't tested here — they need a real git repo. They'll be integration-tested when you run the full agent loop.)

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/git/
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add git worktree manager"
```

---

## Task 5: Process Manager — The Core Loop

**Files:**
- Create: `apps/desktop/src-tauri/src/agent/process.rs`

This is the most important module. It spawns `claude --print --output-format stream-json`, reads each JSONL line as it arrives, parses it into an `AgentEvent`, and emits a Tauri event to the React frontend. This is where the canvas comes alive.

Rust async I/O note: `tokio::process::Command` is the async version of `std::process::Command`. You `await` it like a Go channel receive. `BufReader` wraps the stdout pipe and gives you line-by-line reading.

**Step 1: Write the module**

Create `apps/desktop/src-tauri/src/agent/process.rs`:

```rust
use std::path::PathBuf;
use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tauri::{AppHandle, Emitter};
use serde::Serialize;

use super::events::{parse_event, AgentEvent};

/// Payload sent to the React frontend for each canvas node.
/// This is what Tauri serializes and emits.
#[derive(Debug, Clone, Serialize)]
pub struct CanvasNodePayload {
    /// Unique ID for this node in the graph.
    pub node_id: String,
    /// The agent this event came from.
    pub agent_id: String,
    /// The ticket this event belongs to.
    pub ticket_id: String,
    /// The parsed event data.
    pub event: AgentEvent,
}

/// Configuration for running an agent against a ticket.
pub struct AgentRunConfig {
    /// The agent's unique ID (for state tracking and Tauri events).
    pub agent_id: String,
    /// The ticket being worked on.
    pub ticket_id: String,
    /// The full prompt: ticket description + acceptance criteria.
    pub prompt: String,
    /// System prompt suffix: role + personality + project context + ticket context.
    pub system_prompt: String,
    /// Tools the agent is allowed to use.
    pub allowed_tools: Vec<String>,
    /// The working directory (the git worktree path).
    pub working_dir: PathBuf,
    /// Environment variables (git identity, GH_TOKEN, etc.).
    pub env: Vec<(String, String)>,
    /// If resuming a paused session, provide the session ID.
    pub resume_session_id: Option<String>,
}

/// Run the agent and stream events to the React frontend.
///
/// This function is async — it runs until the agent finishes or errors.
/// In Go terms: this would be a goroutine that reads from a channel.
///
/// The `app` handle is Tauri's way of emitting events to the frontend.
pub async fn run(config: AgentRunConfig, app: AppHandle) -> Result<()> {
    let mut cmd = Command::new("claude");

    cmd.arg("--print")
        .arg("--output-format").arg("stream-json")
        .arg("--append-system-prompt").arg(&config.system_prompt)
        .arg("--allowedTools").arg(config.allowed_tools.join(","));

    // If resuming a paused session (user answered a question), add --resume
    if let Some(session_id) = &config.resume_session_id {
        cmd.arg("--resume").arg(session_id);
    }

    // The prompt is the last argument
    cmd.arg(&config.prompt);

    // Set working directory to the agent's worktree
    cmd.current_dir(&config.working_dir);

    // Inject git identity and GitHub token
    for (key, value) in &config.env {
        cmd.env(key, value);
    }

    // Capture stdout as a pipe so we can read it line by line
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().context("failed to spawn claude process")?;

    // Wrap stdout in an async buffered reader for line-by-line reading
    let stdout = child.stdout.take().expect("stdout was not piped");
    let mut reader = BufReader::new(stdout).lines();

    let mut node_sequence: u32 = 0;

    // Read lines as they arrive — this loops until Claude exits
    while let Some(line) = reader.next_line().await.context("error reading claude output")? {
        if line.trim().is_empty() {
            continue;
        }

        // Try to parse this line as an AgentEvent
        if let Some(event) = parse_event(&line) {
            node_sequence += 1;
            let node_id = format!("{}-{}-{}", config.agent_id, config.ticket_id, node_sequence);

            let payload = CanvasNodePayload {
                node_id,
                agent_id: config.agent_id.clone(),
                ticket_id: config.ticket_id.clone(),
                event,
            };

            // Emit to React — the event name is "agent-event"
            // React listens with: listen("agent-event", handler)
            let _ = app.emit("agent-event", &payload);
        }
    }

    // Wait for the process to exit cleanly
    let status = child.wait().await.context("failed to wait for claude process")?;

    if !status.success() {
        anyhow::bail!("claude process exited with status: {}", status);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_tools_formats_correctly() {
        // Just verify our string join logic is right
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
}
```

**Step 2: Uncomment process module in mod.rs**

Edit `apps/desktop/src-tauri/src/agent/mod.rs`:

```rust
pub mod events;
pub mod process;
pub mod state;
```

**Step 3: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test agent::process 2>&1
```

Expected: 2 tests pass.

**Step 4: Build to confirm everything still compiles**

```bash
cd apps/desktop/src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors. (There may be `unused import` warnings — those are fine for now.)

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/process.rs
git add apps/desktop/src-tauri/src/agent/mod.rs
git commit -m "feat(rust): add process manager to spawn claude and stream events"
```

---

## Task 6: GitHub Poller

**Files:**
- Create: `apps/desktop/src-tauri/src/github/mod.rs`
- Create: `apps/desktop/src-tauri/src/github/poller.rs`

After a PR is opened, we poll `gh pr view` every 30 seconds to detect new CI review comments. When a review arrives, we emit a Tauri event to trigger a new agent run (feeding the review comment as the next prompt).

**Step 1: Create github module**

Create `apps/desktop/src-tauri/src/github/mod.rs`:

```rust
pub mod poller;
```

**Step 2: Write the poller**

Create `apps/desktop/src-tauri/src/github/poller.rs`:

```rust
use std::process::Command;
use std::time::Duration;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::interval;

/// A single PR review or comment from GitHub.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReview {
    pub author: String,
    pub body: String,
    pub state: String, // "APPROVED", "CHANGES_REQUESTED", "COMMENTED"
    pub submitted_at: String,
}

/// Payload emitted to React when a new CI review arrives.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewPayload {
    pub agent_id: String,
    pub ticket_id: String,
    pub pr_number: u32,
    pub review: PrReview,
}

/// Raw shape of `gh pr view --json reviews` output.
#[derive(Deserialize)]
struct GhPrViewOutput {
    reviews: Vec<PrReview>,
}

/// Fetch current reviews for a PR using the `gh` CLI.
pub fn fetch_reviews(repo: &str, pr_number: u32) -> Result<Vec<PrReview>> {
    let output = Command::new("gh")
        .args(["pr", "view", &pr_number.to_string(),
               "--repo", repo,
               "--json", "reviews"])
        .output()
        .context("failed to run gh pr view")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr view failed: {}", stderr);
    }

    let parsed: GhPrViewOutput = serde_json::from_slice(&output.stdout)
        .context("failed to parse gh pr view output")?;

    Ok(parsed.reviews)
}

/// Poll a PR for new CI reviews, emitting a Tauri event when one arrives.
///
/// This runs in a background task (tokio::spawn). It stops when the PR is
/// approved (state == "APPROVED") or after a max number of polls.
///
/// In Go terms: this is a goroutine with a ticker.
pub async fn poll_pr(
    app: AppHandle,
    repo: String,
    pr_number: u32,
    agent_id: String,
    ticket_id: String,
    poll_interval_secs: u64,
) {
    let mut ticker = interval(Duration::from_secs(poll_interval_secs));
    let mut seen_count = 0usize;
    let max_polls = 120; // 60 minutes at 30s intervals

    for _ in 0..max_polls {
        ticker.tick().await;

        let reviews = match fetch_reviews(&repo, pr_number) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("poller: error fetching reviews: {}", e);
                continue;
            }
        };

        // Only emit events for reviews we haven't seen yet
        if reviews.len() > seen_count {
            for review in reviews.iter().skip(seen_count) {
                let payload = ReviewPayload {
                    agent_id: agent_id.clone(),
                    ticket_id: ticket_id.clone(),
                    pr_number,
                    review: review.clone(),
                };
                let _ = app.emit("pr-review", &payload);

                // If approved, we're done
                if review.state == "APPROVED" {
                    return;
                }
            }
            seen_count = reviews.len();
        }
    }

    eprintln!("poller: max polls reached for PR #{}", pr_number);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_review_deserializes() {
        let json = r#"{"author":"ci-claude[bot]","body":"LGTM — clean implementation.","state":"APPROVED","submitted_at":"2026-02-20T10:00:00Z"}"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.state, "APPROVED");
        assert_eq!(review.author, "ci-claude[bot]");
    }

    #[test]
    fn gh_pr_view_parses_empty_reviews() {
        let json = r#"{"reviews":[]}"#;
        let parsed: GhPrViewOutput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.reviews.len(), 0);
    }
}
```

**Step 3: Add github module to lib.rs**

Edit `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod agent;
mod git;
mod github;
```

**Step 4: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test github::poller 2>&1
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/github/
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add GitHub PR poller for CI review detection"
```

---

## Task 7: Tauri Commands — Wire Everything Together

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

Tauri commands are like RPC handlers. React calls `invoke("command_name", { args })` and Rust handles it. This is where we expose the agent execution system to the frontend.

**Step 1: Replace lib.rs**

Replace the entire contents of `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod agent;
mod git;
mod github;

use std::sync::Mutex;
use tauri::State;
use serde::{Deserialize, Serialize};

use agent::state::{AgentState, AgentStatus, StateStore, new_store, upsert_agent, all_agents, get_agent};
use agent::process::{AgentRunConfig, run};
use git::worktree::{WorktreeConfig, create as create_worktree, remove as remove_worktree};

/// Global app state managed by Tauri.
/// Tauri injects this into commands via `State<AppState>`.
pub struct AppState {
    pub agents: StateStore,
}

/// Create a new agent and add it to the roster.
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

/// Payload from React to start an agent on a ticket.
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
/// This spawns a background task — the command returns immediately
/// and the agent runs asynchronously, emitting "agent-event" Tauri events.
#[tauri::command]
async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: StartAgentPayload,
) -> Result<(), String> {
    use std::path::PathBuf;

    let repo_root = PathBuf::from(&payload.repo_root);
    let agents_store = state.agents.clone();

    // Update agent status to Working
    agent::state::set_status(&agents_store, &payload.agent_id, AgentStatus::Working);
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.current_ticket_id = Some(payload.ticket_id.clone());
        upsert_agent(&agents_store, a);
    }

    // Create the git worktree
    let agent = get_agent(&agents_store, &payload.agent_id)
        .ok_or("agent not found")?;

    let wt_config = WorktreeConfig {
        repo_root: repo_root.clone(),
        ticket_id: payload.ticket_id.clone(),
        ticket_slug: payload.ticket_slug.clone(),
        agent_name: agent.name.clone(),
        agent_email: format!("{}@poietai.ai", agent.role),
    };

    let worktree = create_worktree(&wt_config)
        .map_err(|e| format!("failed to create worktree: {}", e))?;

    // Save worktree path to state
    if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
        a.worktree_path = Some(worktree.path.to_string_lossy().to_string());
        upsert_agent(&agents_store, a);
    }

    // Build agent environment (git identity + GitHub token)
    let env = git::worktree::agent_env(&wt_config, &payload.gh_token);

    let run_config = AgentRunConfig {
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

    // Spawn the agent run as a background task
    tokio::spawn(async move {
        match run(run_config, app_clone).await {
            Ok(()) => {
                agent::state::set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
            }
            Err(e) => {
                eprintln!("agent {} error: {}", agent_id, e);
                agent::state::set_status(&agents_store_clone, &agent_id, AgentStatus::Blocked);
            }
        }
    });

    Ok(())
}

/// Start polling a PR for CI reviews.
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
```

**Step 2: Build and verify**

```bash
cd apps/desktop/src-tauri && cargo build 2>&1
```

Expected: compiles with no errors. There will be warnings about unused variables — those are fine and expected at this stage.

**Step 3: Run all tests**

```bash
cd apps/desktop/src-tauri && cargo test 2>&1
```

Expected: all previously written tests still pass.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): wire Tauri commands for agent creation, start, and PR polling"
```

---

## Task 8: React Types and Zustand Store

**Files:**
- Create: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/package.json` (add @xyflow/react)

**Step 1: Install @xyflow/react**

```bash
pnpm --filter @poietai/desktop add @xyflow/react
```

**Step 2: Create canvas types**

Create `apps/desktop/src/types/canvas.ts`:

```typescript
// These mirror the Rust AgentEvent enum.
// When Tauri emits "agent-event", the payload has this shape.

export type AgentEventKind =
  | { type: 'thinking'; thinking: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; tool_name: string; tool_input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'result'; result?: string; session_id?: string };

export interface CanvasNodePayload {
  node_id: string;
  agent_id: string;
  ticket_id: string;
  event: AgentEventKind;
}

// The visual node type for @xyflow/react
export type CanvasNodeType =
  | 'thought'
  | 'file_read'
  | 'file_edit'
  | 'file_write'
  | 'bash_command'
  | 'agent_message'
  | 'awaiting_user'
  | 'user_reply'
  | 'pr_opened'
  | 'ci_review';

export interface CanvasNodeData {
  nodeType: CanvasNodeType;
  agentId: string;
  ticketId: string;
  // Content varies by node type
  content: string;
  // For file nodes: the file path
  filePath?: string;
  // For diff nodes: the diff text
  diff?: string;
  // For awaiting nodes: the session ID for resume
  sessionId?: string;
  // For CI review nodes: approved or changes requested
  approved?: boolean;
}
```

**Step 3: Create the Zustand store**

Create `apps/desktop/src/store/canvasStore.ts`:

```typescript
import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { CanvasNodeData, CanvasNodePayload, CanvasNodeType, AgentEventKind } from '../types/canvas';

interface CanvasStore {
  // The nodes and edges for the active ticket canvas
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  // The ticket currently displayed on the canvas
  activeTicketId: string | null;

  // Actions
  setActiveTicket: (ticketId: string) => void;
  addNodeFromEvent: (payload: CanvasNodePayload) => void;
  clearCanvas: () => void;
}

/// Determine the visual node type from a raw AgentEvent
function nodeTypeFromEvent(event: AgentEventKind): CanvasNodeType | null {
  switch (event.type) {
    case 'thinking': return 'thought';
    case 'text': return 'agent_message';
    case 'tool_use': {
      switch (event.tool_name) {
        case 'Read': return 'file_read';
        case 'Edit': return 'file_edit';
        case 'Write': return 'file_write';
        case 'Bash': return 'bash_command';
        default: return 'bash_command';
      }
    }
    case 'result': return null; // Don't render result events as nodes
    default: return null;
  }
}

/// Extract display content from an event
function contentFromEvent(event: AgentEventKind): string {
  switch (event.type) {
    case 'thinking': return event.thinking;
    case 'text': return event.text;
    case 'tool_use': return JSON.stringify(event.tool_input, null, 2);
    default: return '';
  }
}

/// Extract file path from a tool_use event if applicable
function filePathFromEvent(event: AgentEventKind): string | undefined {
  if (event.type !== 'tool_use') return undefined;
  const input = event.tool_input as Record<string, string>;
  return input.file_path ?? input.path ?? undefined;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  activeTicketId: null,

  setActiveTicket: (ticketId) => {
    set({ activeTicketId: ticketId, nodes: [], edges: [] });
  },

  addNodeFromEvent: (payload) => {
    const { nodes, edges, activeTicketId } = get();

    // Only add nodes for the active ticket
    if (activeTicketId && payload.ticket_id !== activeTicketId) return;

    const nodeType = nodeTypeFromEvent(payload.event);
    if (!nodeType) return; // Some events don't become nodes

    const content = contentFromEvent(payload.event);
    const filePath = filePathFromEvent(payload.event);

    // Position nodes in a vertical chain, 120px apart
    const yPosition = nodes.length * 120;

    const newNode: Node<CanvasNodeData> = {
      id: payload.node_id,
      type: nodeType,
      position: { x: 300, y: yPosition },
      data: {
        nodeType,
        agentId: payload.agent_id,
        ticketId: payload.ticket_id,
        content,
        filePath,
      },
    };

    // Draw an edge from the previous node to this one
    const newEdges = [...edges];
    if (nodes.length > 0) {
      const prevNode = nodes[nodes.length - 1];
      newEdges.push({
        id: `${prevNode.id}->${payload.node_id}`,
        source: prevNode.id,
        target: payload.node_id,
        type: 'smoothstep',
        style: { stroke: '#ffffff', strokeWidth: 2 },
      });
    }

    set({ nodes: [...nodes, newNode], edges: newEdges });
  },

  clearCanvas: () => {
    set({ nodes: [], edges: [] });
  },
}));
```

**Step 4: Run TypeScript type check**

```bash
cd apps/desktop && pnpm tsc --noEmit 2>&1
```

Expected: no errors on the new files.

**Step 5: Commit**

```bash
git add apps/desktop/src/types/ apps/desktop/src/store/ apps/desktop/package.json
git add pnpm-lock.yaml
git commit -m "feat(react): add canvas types and Zustand store for agent events"
```

---

## Task 9: Canvas Node Components

**Files:**
- Create: `apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx`
- Create: `apps/desktop/src/components/canvas/nodes/FileNode.tsx`
- Create: `apps/desktop/src/components/canvas/nodes/BashNode.tsx`
- Create: `apps/desktop/src/components/canvas/nodes/AwaitingNode.tsx`
- Create: `apps/desktop/src/components/canvas/nodes/index.ts`

Each node type is a React component that @xyflow/react renders. They're simple cards — the complexity is in their visual style, not their logic.

**Step 1: Create ThoughtNode**

Create `apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function ThoughtNode({ data, id }: NodeProps<CanvasNodeData>) {
  return (
    <div className="bg-indigo-950 border border-indigo-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-indigo-500" />
      <div className="flex items-start gap-2">
        <span className="text-indigo-400 text-sm mt-0.5">💭</span>
        <p className="text-indigo-100 text-xs leading-relaxed line-clamp-4">
          {data.content}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500" />
    </div>
  );
}
```

**Step 2: Create FileNode**

Create `apps/desktop/src/components/canvas/nodes/FileNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

const iconMap = {
  file_read: { icon: '📄', color: 'blue' },
  file_edit: { icon: '✏️', color: 'green' },
  file_write: { icon: '🆕', color: 'emerald' },
} as const;

export function FileNode({ data }: NodeProps<CanvasNodeData>) {
  const style = iconMap[data.nodeType as keyof typeof iconMap] ?? iconMap.file_read;

  const borderColor = {
    blue: 'border-blue-700',
    green: 'border-green-700',
    emerald: 'border-emerald-700',
  }[style.color];

  const bgColor = {
    blue: 'bg-blue-950',
    green: 'bg-green-950',
    emerald: 'bg-emerald-950',
  }[style.color];

  const textColor = {
    blue: 'text-blue-200',
    green: 'text-green-200',
    emerald: 'text-emerald-200',
  }[style.color];

  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg p-3 min-w-48 shadow-lg`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <span className="text-sm">{style.icon}</span>
        <span className={`${textColor} text-xs font-mono truncate max-w-40`}>
          {data.filePath ?? 'unknown file'}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 3: Create BashNode**

Create `apps/desktop/src/components/canvas/nodes/BashNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function BashNode({ data }: NodeProps<CanvasNodeData>) {
  // content is JSON of tool_input — try to extract the command string
  let command = data.content;
  try {
    const parsed = JSON.parse(data.content);
    command = parsed.command ?? data.content;
  } catch { /* use raw content */ }

  return (
    <div className="bg-orange-950 border border-orange-700 rounded-lg p-3 max-w-xs shadow-lg">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start gap-2">
        <span className="text-orange-400 text-sm mt-0.5">⚙️</span>
        <code className="text-orange-100 text-xs font-mono truncate">
          {command}
        </code>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 4: Create AwaitingNode**

Create `apps/desktop/src/components/canvas/nodes/AwaitingNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function AwaitingNode({ data }: NodeProps<CanvasNodeData>) {
  return (
    <div className="bg-amber-950 border-2 border-amber-500 rounded-lg p-3 max-w-xs shadow-lg animate-pulse">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start gap-2">
        <span className="text-amber-400 text-sm mt-0.5">⏸</span>
        <div>
          <p className="text-amber-200 text-xs font-semibold mb-1">Waiting for you</p>
          <p className="text-amber-100 text-xs leading-relaxed">
            {data.content}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 5: Create the node registry**

Create `apps/desktop/src/components/canvas/nodes/index.ts`:

```typescript
import { ThoughtNode } from './ThoughtNode';
import { FileNode } from './FileNode';
import { BashNode } from './BashNode';
import { AwaitingNode } from './AwaitingNode';

// This object maps node type strings (from Zustand) to React components.
// @xyflow/react uses this to render each node type.
export const nodeTypes = {
  thought: ThoughtNode,
  agent_message: ThoughtNode,   // reuse thought style for messages
  file_read: FileNode,
  file_edit: FileNode,
  file_write: FileNode,
  bash_command: BashNode,
  awaiting_user: AwaitingNode,
} as const;
```

**Step 6: Type check**

```bash
cd apps/desktop && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

**Step 7: Commit**

```bash
git add apps/desktop/src/components/canvas/
git commit -m "feat(react): add canvas node components (thought, file, bash, awaiting)"
```

---

## Task 10: Ticket Canvas — Wire Events to the Graph

**Files:**
- Create: `apps/desktop/src/components/canvas/TicketCanvas.tsx`
- Modify: `apps/desktop/src/components/layout/MainArea.tsx`

This is the component that renders the live node graph and listens for Tauri events.

**Step 1: Create TicketCanvas**

Create `apps/desktop/src/components/canvas/TicketCanvas.tsx`:

```tsx
import { useEffect } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { nodeTypes } from './nodes';
import type { CanvasNodePayload } from '../../types/canvas';

interface TicketCanvasProps {
  ticketId: string;
}

export function TicketCanvas({ ticketId }: TicketCanvasProps) {
  const { nodes, edges, setActiveTicket, addNodeFromEvent } = useCanvasStore();

  // When the ticket changes, reset the canvas
  useEffect(() => {
    setActiveTicket(ticketId);
  }, [ticketId, setActiveTicket]);

  // Listen for agent-event from Tauri (the JSONL stream)
  useEffect(() => {
    // `listen` returns a Promise<UnlistenFn> — the cleanup function
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      addNodeFromEvent(event.payload);
    });

    // Cleanup: stop listening when the component unmounts
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addNodeFromEvent]);

  return (
    <div className="w-full h-full bg-neutral-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        // Dark theme
        colorMode="dark"
        // Don't show the attribution (we have a license)
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#333"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

**Step 2: Update MainArea to show the canvas**

Read the current MainArea.tsx, then update it to render TicketCanvas when the active view is `canvas`:

Edit `apps/desktop/src/components/layout/MainArea.tsx` — update the body section to include a canvas view. The existing `activeView` prop already exists; add a canvas case:

```tsx
import { TicketCanvas } from '../canvas/TicketCanvas';

// Inside the component body, add to the view switch:
{activeView === 'graph' && (
  <div className="flex-1 overflow-hidden">
    {/* Hardcode ticket-1 for now; will be dynamic in later tasks */}
    <TicketCanvas ticketId="ticket-1" />
  </div>
)}
```

(Read the full current file first and make a targeted edit — don't replace the whole file.)

**Step 3: Type check and build**

```bash
cd apps/desktop && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

**Step 4: Dev run to visually verify**

```bash
pnpm --filter @poietai/desktop tauri dev
```

Click the graph icon in the sidebar. You should see a dark canvas with a dot grid and the ReactFlow controls. No nodes yet — those appear when an agent runs.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git add apps/desktop/src/components/layout/MainArea.tsx
git commit -m "feat(react): add TicketCanvas with live Tauri event listener"
```

---

## Task 11: Ask-User Pause and Resume

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Create: `apps/desktop/src/components/canvas/AskUserOverlay.tsx`
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

When the agent encounters something it needs to ask you about, it emits a `text` event that ends with `?` (or a structured ask pattern). We need to:
1. Detect the question
2. Pause the visual canvas (show amber pulse on the awaiting node)
3. Surface a reply input in the ticket canvas
4. On reply, call `invoke("start_agent", { resume_session_id: ... })` to continue

The key insight: Claude Code with `--print` runs to completion. To ask a question mid-run, the agent uses a `Bash` tool call with a command like `read_user_input` that we intercept. For v1, the simpler approach: the agent ends its run with an explicit question as its last `text` event, and we detect that pattern to show the input.

**Step 1: Add awaiting state to the store**

Edit `apps/desktop/src/store/canvasStore.ts` — add to the store interface:

```typescript
// Add to CanvasStore interface:
awaitingQuestion: string | null;
awaitingSessionId: string | null;
setAwaiting: (question: string, sessionId: string) => void;
clearAwaiting: () => void;
```

And implement in the `create` call:

```typescript
awaitingQuestion: null,
awaitingSessionId: null,

setAwaiting: (question, sessionId) => {
  set({ awaitingQuestion: question, awaitingSessionId: sessionId });
},

clearAwaiting: () => {
  set({ awaitingQuestion: null, awaitingSessionId: null });
},
```

Also update `addNodeFromEvent` — when we receive a `result` event that has a `session_id`, and the last text node looked like a question (ends with `?`), call `setAwaiting`. This is handled in the `TicketCanvas` component by also listening for `result` events.

**Step 2: Create AskUserOverlay**

Create `apps/desktop/src/components/canvas/AskUserOverlay.tsx`:

```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AskUserOverlayProps {
  question: string;
  sessionId: string;
  agentId: string;
  ticketId: string;
  ticketSlug: string;
  repoRoot: string;
  ghToken: string;
  systemPrompt: string;
  onDismiss: () => void;
}

export function AskUserOverlay({
  question, sessionId, agentId, ticketId, ticketSlug,
  repoRoot, ghToken, systemPrompt, onDismiss
}: AskUserOverlayProps) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!reply.trim()) return;
    setSending(true);

    try {
      await invoke('start_agent', {
        payload: {
          agent_id: agentId,
          ticket_id: ticketId,
          ticket_slug: ticketSlug,
          prompt: reply,
          system_prompt: systemPrompt,
          repo_root: repoRoot,
          gh_token: ghToken,
          resume_session_id: sessionId,
        }
      });
      onDismiss();
    } catch (err) {
      console.error('failed to resume agent:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-lg
                    bg-neutral-900 border border-amber-600 rounded-xl p-4 shadow-2xl z-10">
      <p className="text-amber-200 text-sm mb-3 font-medium">⏸ Agent is waiting for you</p>
      <p className="text-neutral-300 text-sm mb-4">{question}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Your reply..."
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-amber-500"
          autoFocus
        />
        <button
          onClick={handleSend}
          disabled={sending || !reply.trim()}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50
                     text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {sending ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Add overlay to TicketCanvas**

Edit `apps/desktop/src/components/canvas/TicketCanvas.tsx` — add a `listen` for `result` events and render the overlay:

```tsx
// Add to imports:
import { useCanvasStore } from '../../store/canvasStore';
import { AskUserOverlay } from './AskUserOverlay';

// Inside the component, add a second useEffect for result events:
useEffect(() => {
  const unlisten = listen<{ session_id?: string }>('agent-result', (event) => {
    const { nodes } = useCanvasStore.getState();
    if (!event.payload.session_id) return;

    // Check if the last text node was a question
    const lastTextNode = [...nodes].reverse().find(n => n.data.nodeType === 'agent_message');
    if (lastTextNode && lastTextNode.data.content.trim().endsWith('?')) {
      useCanvasStore.getState().setAwaiting(
        lastTextNode.data.content,
        event.payload.session_id
      );
    }
  });
  return () => { unlisten.then(fn => fn()); };
}, []);

// In the return JSX, add:
{awaitingQuestion && awaitingSessionId && (
  <AskUserOverlay
    question={awaitingQuestion}
    sessionId={awaitingSessionId}
    agentId="agent-1"         // will be dynamic in later tasks
    ticketId={ticketId}
    ticketSlug="active-ticket"
    repoRoot="/home/user/repo" // will be from workspace config
    ghToken=""                 // will be from secure store
    systemPrompt=""            // will be from agent config
    onDismiss={() => useCanvasStore.getState().clearAwaiting()}
  />
)}
```

**Step 4: Update process.rs to emit result event**

Edit `apps/desktop/src-tauri/src/agent/process.rs` — after the readline loop ends, emit an `agent-result` event with the session ID if one was captured:

```rust
// After the while loop, before `child.wait()`:
// (Track session_id from Result events during the loop)
// Add this before the while loop:
let mut last_session_id: Option<String> = None;

// Inside the while loop, in the event match:
if let AgentEvent::Result { session_id, .. } = &event {
    last_session_id = session_id.clone();
}

// After child.wait():
if let Some(sid) = last_session_id {
    let _ = app.emit("agent-result", serde_json::json!({ "session_id": sid }));
}
```

**Step 5: Build and type check**

```bash
cd apps/desktop/src-tauri && cargo build 2>&1 | grep -E "^error"
cd apps/desktop && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts
git add apps/desktop/src/components/canvas/AskUserOverlay.tsx
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git add apps/desktop/src-tauri/src/agent/process.rs
git commit -m "feat: add ask-user pause and resume flow"
```

---

## Task 12: Agent DM Routing — The Slack Layer Foundation

**Files:**
- Create: `apps/desktop/src/types/message.ts`
- Create: `apps/desktop/src/store/messageStore.ts`
- Create: `apps/desktop/src/components/messages/DmList.tsx`
- Modify: `apps/desktop/src/components/layout/MainArea.tsx`

Agent DMs are how the system talks to you — pickup requests, PR approvals, questions, CI results. For v1, a simple in-memory list of messages per agent is enough. The `agent-event` stream's `text` events are routed here as well as to the canvas.

**Step 1: Create message types**

Create `apps/desktop/src/types/message.ts`:

```typescript
export interface Message {
  id: string;
  from: 'agent' | 'user';
  agentId: string;
  agentName: string;
  content: string;
  timestamp: string;
  ticketId?: string;
  // Link to a canvas node (deep link)
  canvasNodeId?: string;
}
```

**Step 2: Create message store**

Create `apps/desktop/src/store/messageStore.ts`:

```typescript
import { create } from 'zustand';
import type { Message } from '../types/message';

interface MessageStore {
  // messages keyed by agentId
  threads: Record<string, Message[]>;
  unreadCounts: Record<string, number>;
  activeThread: string | null;

  addMessage: (message: Message) => void;
  setActiveThread: (agentId: string) => void;
  markRead: (agentId: string) => void;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  threads: {},
  unreadCounts: {},
  activeThread: null,

  addMessage: (message) => {
    const { threads, unreadCounts, activeThread } = get();
    const thread = threads[message.agentId] ?? [];
    const isActive = activeThread === message.agentId;

    set({
      threads: {
        ...threads,
        [message.agentId]: [...thread, message],
      },
      unreadCounts: {
        ...unreadCounts,
        [message.agentId]: isActive
          ? 0
          : (unreadCounts[message.agentId] ?? 0) + 1,
      },
    });
  },

  setActiveThread: (agentId) => {
    set({ activeThread: agentId });
    get().markRead(agentId);
  },

  markRead: (agentId) => {
    const { unreadCounts } = get();
    set({ unreadCounts: { ...unreadCounts, [agentId]: 0 } });
  },
}));
```

**Step 3: Create DmList component**

Create `apps/desktop/src/components/messages/DmList.tsx`:

```tsx
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMessageStore } from '../../store/messageStore';
import type { CanvasNodePayload } from '../../types/canvas';

export function DmList() {
  const { threads, unreadCounts, activeThread, setActiveThread, addMessage } = useMessageStore();

  // Route agent text events to the DM panel
  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      const { event: agentEvent } = event.payload;
      if (agentEvent.type !== 'text') return;

      addMessage({
        id: event.payload.node_id,
        from: 'agent',
        agentId: event.payload.agent_id,
        agentName: event.payload.agent_id, // will be resolved from state later
        content: agentEvent.text,
        timestamp: new Date().toISOString(),
        ticketId: event.payload.ticket_id,
        canvasNodeId: event.payload.node_id,
      });
    });
    return () => { unlisten.then(fn => fn()); };
  }, [addMessage]);

  const agentIds = Object.keys(threads);

  return (
    <div className="flex h-full">
      {/* Thread list */}
      <div className="w-56 border-r border-neutral-800 flex flex-col">
        <div className="px-4 py-3 border-b border-neutral-800">
          <h2 className="text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            Direct Messages
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {agentIds.map((agentId) => (
            <button
              key={agentId}
              onClick={() => setActiveThread(agentId)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm
                         hover:bg-neutral-800 transition-colors text-left
                         ${activeThread === agentId ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
            >
              <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center text-xs text-white">
                {agentId[0]?.toUpperCase()}
              </div>
              <span className="flex-1 truncate">{agentId}</span>
              {(unreadCounts[agentId] ?? 0) > 0 && (
                <span className="bg-indigo-600 text-white text-xs rounded-full px-1.5">
                  {unreadCounts[agentId]}
                </span>
              )}
            </button>
          ))}
          {agentIds.length === 0 && (
            <p className="px-4 py-3 text-neutral-600 text-xs">
              No messages yet. Assign a ticket to an agent to get started.
            </p>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 flex flex-col">
        {activeThread ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(threads[activeThread] ?? []).map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.from === 'user' ? 'justify-end' : ''}`}
              >
                {msg.from === 'agent' && (
                  <div className="w-7 h-7 rounded-full bg-indigo-700 flex-shrink-0
                                  flex items-center justify-center text-xs text-white mt-0.5">
                    {msg.agentId[0]?.toUpperCase()}
                  </div>
                )}
                <div
                  className={`rounded-xl px-3 py-2 max-w-sm text-sm
                    ${msg.from === 'agent'
                      ? 'bg-neutral-800 text-neutral-100'
                      : 'bg-indigo-700 text-white'
                    }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-neutral-600 text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Add DmList to MainArea for the messages view**

Edit `apps/desktop/src/components/layout/MainArea.tsx` — import and render `DmList` when `activeView === 'messages'`.

**Step 5: Type check**

```bash
cd apps/desktop && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/desktop/src/types/message.ts
git add apps/desktop/src/store/messageStore.ts
git add apps/desktop/src/components/messages/
git add apps/desktop/src/components/layout/MainArea.tsx
git commit -m "feat(react): add DM thread store and routing for agent messages"
```

---

## Task 13: Context Builder — System Prompt Assembly

**Files:**
- Create: `apps/desktop/src-tauri/src/context/mod.rs`
- Create: `apps/desktop/src-tauri/src/context/builder.rs`

Every agent run needs a `--append-system-prompt` that injects role + personality + project context + ticket context. This module assembles that string from stored config.

**Step 1: Create context module**

Create `apps/desktop/src-tauri/src/context/mod.rs`:

```rust
pub mod builder;
```

**Step 2: Write the builder**

Create `apps/desktop/src-tauri/src/context/builder.rs`:

```rust
/// Everything needed to build a system prompt for an agent run.
pub struct ContextInput<'a> {
    pub role: &'a str,
    pub personality: &'a str,
    pub project_name: &'a str,
    pub project_stack: &'a str,
    pub project_context: &'a str,  // The CLAUDE.md equivalent
    pub ticket_number: u32,
    pub ticket_title: &'a str,
    pub ticket_description: &'a str,
    pub ticket_acceptance_criteria: &'a [String],
}

/// Personality descriptions injected into the system prompt.
/// These shape how the agent writes, how often it asks questions,
/// and how bold its suggestions are.
fn personality_description(personality: &str) -> &'static str {
    match personality {
        "pragmatic" => "You favor proven patterns and shipping quickly. \
                        You ask clarifying questions only when truly blocked. \
                        When in doubt, make a reasonable decision and note your reasoning.",
        "perfectionist" => "You catch edge cases and push for clean abstractions. \
                            You flag technical debt you notice even if not in scope. \
                            You ask clarifying questions when you see multiple valid approaches.",
        "ambitious" => "You look for opportunities to improve things beyond the immediate ticket. \
                        You propose bold refactors when they would help. \
                        You communicate your ideas actively before implementing.",
        "conservative" => "You question scope creep and ask 'do users actually need this?' \
                           You prefer smaller, safer changes over sweeping ones. \
                           You flag complexity risks before starting.",
        "devils-advocate" => "You challenge assumptions and find holes in the plan. \
                              You surface edge cases and unhandled states proactively. \
                              You push back constructively when you think something is wrong.",
        _ => "You are a skilled, collaborative software engineer.",
    }
}

/// Role descriptions for the system prompt.
fn role_description(role: &str) -> &'static str {
    match role {
        "backend-engineer" => "You own the server-side code: APIs, database queries, \
                               business logic, background jobs. You do not modify frontend code \
                               unless explicitly asked.",
        "frontend-engineer" => "You own the client-side code: React components, styling, \
                                browser state, API integration. You do not modify backend logic \
                                unless explicitly asked.",
        "fullstack-engineer" => "You work across the full stack. You make pragmatic decisions \
                                 about where logic lives and own changes end-to-end.",
        "staff-engineer" => "You think about system-level concerns: abstractions, patterns, \
                             tech debt, architecture decisions. You review other agents' work \
                             critically and surface systemic issues.",
        "qa" => "You write tests, find edge cases, and validate that implementations \
                 match acceptance criteria. You are thorough and skeptical.",
        _ => "You are a skilled software engineer working on this project.",
    }
}

/// Build the full system prompt string for a single agent run.
pub fn build(input: &ContextInput) -> String {
    let acceptance_criteria = if input.ticket_acceptance_criteria.is_empty() {
        "No explicit criteria — use good judgment.".to_string()
    } else {
        input.ticket_acceptance_criteria
            .iter()
            .map(|c| format!("- {}", c))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "## Your Role\n\
        You are a {role} on the {project} engineering team.\n\
        {role_desc}\n\n\
        ## Your Working Style\n\
        {personality_desc}\n\n\
        ## Project Context\n\
        Project: {project}\n\
        Stack: {stack}\n\n\
        {project_context}\n\n\
        ## Current Ticket\n\
        Ticket #{ticket_num}: {ticket_title}\n\n\
        {ticket_description}\n\n\
        Acceptance criteria:\n\
        {acceptance_criteria}\n\n\
        ## Working Instructions\n\
        - Commit your changes with clear messages as you work\n\
        - When you're ready to create a PR, use: gh pr create --title \"...\" --body \"...\"\n\
        - If you need clarification before proceeding, ask as your last message\n\
        - Use the project context above to follow existing patterns",
        role = input.role,
        project = input.project_name,
        role_desc = role_description(input.role),
        personality_desc = personality_description(input.personality),
        stack = input.project_stack,
        project_context = input.project_context,
        ticket_num = input.ticket_number,
        ticket_title = input.ticket_title,
        ticket_description = input.ticket_description,
        acceptance_criteria = acceptance_criteria,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> ContextInput<'static> {
        ContextInput {
            role: "backend-engineer",
            personality: "pragmatic",
            project_name: "RRP API",
            project_stack: "Go 1.23, PostgreSQL, pgx",
            project_context: "Key patterns: use apperr.New for errors. Database via pgx pool.",
            ticket_number: 87,
            ticket_title: "Fix nil guard in billing service",
            ticket_description: "The subscription pointer is not guarded before deduction.",
            ticket_acceptance_criteria: &[
                "Subscription is guarded before token deduction".to_string(),
                "Existing tests pass".to_string(),
            ],
        }
    }

    #[test]
    fn builds_system_prompt_with_role() {
        let prompt = build(&sample_input());
        assert!(prompt.contains("backend-engineer"));
        assert!(prompt.contains("server-side code"));
    }

    #[test]
    fn includes_ticket_number_and_title() {
        let prompt = build(&sample_input());
        assert!(prompt.contains("Ticket #87"));
        assert!(prompt.contains("Fix nil guard in billing service"));
    }

    #[test]
    fn includes_acceptance_criteria() {
        let prompt = build(&sample_input());
        assert!(prompt.contains("Subscription is guarded"));
        assert!(prompt.contains("Existing tests pass"));
    }

    #[test]
    fn includes_project_context() {
        let prompt = build(&sample_input());
        assert!(prompt.contains("apperr.New"));
    }

    #[test]
    fn personality_affects_working_style() {
        let prompt = build(&sample_input());
        assert!(prompt.contains("proven patterns"));  // pragmatic description
    }
}
```

**Step 3: Add context module to lib.rs**

Edit `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod agent;
mod context;
mod git;
mod github;
```

**Step 4: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test context::builder 2>&1
```

Expected: 5 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/context/
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add context builder for agent system prompt assembly"
```

---

## Checkpoint: End-to-End Smoke Test

At this point all the pieces are built. Before the final task (ticket board UI), do a manual smoke test of the full loop.

**What you need:**
- `claude` CLI installed and authenticated (`claude --version`)
- `gh` CLI authenticated (`gh auth status`)
- A test git repo checked out locally

**Test sequence:**

1. Start the Tauri dev server: `pnpm --filter @poietai/desktop tauri dev`

2. Open the Rust test harness — in a separate terminal, test the context builder directly:
   ```bash
   cd apps/desktop/src-tauri && cargo test 2>&1
   ```
   Expected: all tests pass.

3. Test `claude --print` output format manually in a temp directory:
   ```bash
   mkdir /tmp/test-repo && cd /tmp/test-repo && git init
   echo "# test" > README.md && git add . && git commit -m "init"
   claude --print --output-format stream-json "List the files in this directory"
   ```
   Expected: JSONL output with `thinking`, `tool_use`, `text`, and `result` lines.

4. Verify the canvas in the app shows the dot grid when you click the graph icon in the sidebar.

---

## Task 14: Ticket Board UI — The Entry Point

**Files:**
- Create: `apps/desktop/src/types/ticket.ts` (re-export from shared)
- Create: `apps/desktop/src/store/ticketStore.ts`
- Create: `apps/desktop/src/components/board/TicketBoard.tsx`
- Create: `apps/desktop/src/components/board/TicketCard.tsx`
- Modify: `apps/desktop/src/components/layout/MainArea.tsx`

The ticket board is the default view when you open a workspace. Kanban columns. Each card has an "Assign to Agent" button. Clicking a card opens the ticket canvas for that ticket.

**Step 1: Create ticket store**

Create `apps/desktop/src/store/ticketStore.ts`:

```typescript
import { create } from 'zustand';

// Mirror the shared package types
export type TicketStatus =
  | 'backlog' | 'refined' | 'assigned'
  | 'in_progress' | 'in_review' | 'shipped';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: number; // 1-10
  status: TicketStatus;
  assignedAgentId?: string;
  acceptanceCriteria: string[];
}

interface TicketStore {
  tickets: Ticket[];
  selectedTicketId: string | null;

  addTicket: (ticket: Ticket) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => void;
  assignTicket: (ticketId: string, agentId: string) => void;
  selectTicket: (id: string | null) => void;
}

// Seed with a demo ticket so the board isn't empty on first launch
const DEMO_TICKETS: Ticket[] = [
  {
    id: 'ticket-1',
    title: 'Fix nil guard in billing service',
    description: 'The subscription pointer is not checked before token deduction. Under certain race conditions this can panic.',
    complexity: 3,
    status: 'refined',
    acceptanceCriteria: [
      'Subscription is guarded before token deduction',
      'Existing billing tests still pass',
      'New test covers the nil case',
    ],
  },
];

export const useTicketStore = create<TicketStore>((set) => ({
  tickets: DEMO_TICKETS,
  selectedTicketId: null,

  addTicket: (ticket) => {
    set((s) => ({ tickets: [...s.tickets, ticket] }));
  },

  updateTicketStatus: (id, status) => {
    set((s) => ({
      tickets: s.tickets.map((t) => t.id === id ? { ...t, status } : t),
    }));
  },

  assignTicket: (ticketId, agentId) => {
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId
          ? { ...t, assignedAgentId: agentId, status: 'assigned' }
          : t
      ),
    }));
  },

  selectTicket: (id) => set({ selectedTicketId: id }),
}));
```

**Step 2: Create TicketCard**

Create `apps/desktop/src/components/board/TicketCard.tsx`:

```tsx
import { invoke } from '@tauri-apps/api/core';
import { useTicketStore, type Ticket } from '../../store/ticketStore';
import { useCanvasStore } from '../../store/canvasStore';
import { buildPrompt } from '../../lib/promptBuilder';

interface TicketCardProps {
  ticket: Ticket;
  onOpenCanvas: (ticketId: string) => void;
}

const complexityColor = (n: number) => {
  if (n <= 3) return 'text-green-400 bg-green-950';
  if (n <= 6) return 'text-yellow-400 bg-yellow-950';
  return 'text-red-400 bg-red-950';
};

export function TicketCard({ ticket, onOpenCanvas }: TicketCardProps) {
  const { assignTicket } = useTicketStore();
  const { setActiveTicket } = useCanvasStore();

  const handleAssign = async () => {
    // For now, hardcode agent-1 — will be a picker in later tasks
    const agentId = 'agent-1';
    assignTicket(ticket.id, agentId);

    const systemPrompt = buildPrompt({
      role: 'backend-engineer',
      personality: 'pragmatic',
      projectName: 'poietai.ai',
      projectStack: 'Rust, React, Tauri 2',
      projectContext: '',
      ticketNumber: parseInt(ticket.id.replace('ticket-', ''), 10),
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketAcceptanceCriteria: ticket.acceptanceCriteria,
    });

    try {
      await invoke('start_agent', {
        payload: {
          agent_id: agentId,
          ticket_id: ticket.id,
          ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: `${ticket.title}\n\n${ticket.description}`,
          system_prompt: systemPrompt,
          repo_root: '/home/keenan/github/poietai.ai', // will be from workspace config
          gh_token: '',  // will be from secure store
          resume_session_id: null,
        }
      });
      setActiveTicket(ticket.id);
      onOpenCanvas(ticket.id);
    } catch (err) {
      console.error('failed to start agent:', err);
    }
  };

  return (
    <div
      className="bg-neutral-800 border border-neutral-700 rounded-lg p-3
                 hover:border-neutral-600 transition-colors cursor-pointer group"
      onClick={() => onOpenCanvas(ticket.id)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-neutral-100 text-sm leading-snug">{ticket.title}</p>
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityColor(ticket.complexity)}`}>
          {ticket.complexity}
        </span>
      </div>
      {ticket.assignedAgentId ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-indigo-700 text-xs text-white
                          flex items-center justify-center">
            A
          </div>
          <span className="text-neutral-500 text-xs">{ticket.assignedAgentId}</span>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); handleAssign(); }}
          className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0
                     group-hover:opacity-100 transition-opacity"
        >
          + Assign agent
        </button>
      )}
    </div>
  );
}
```

**Step 3: Create promptBuilder utility**

Create `apps/desktop/src/lib/promptBuilder.ts`:

```typescript
// Thin wrapper around the context builder logic on the React side.
// The Rust context builder is the authoritative version — this mirrors it
// for quick calls from the React layer without an invoke round-trip.

interface PromptInput {
  role: string;
  personality: string;
  projectName: string;
  projectStack: string;
  projectContext: string;
  ticketNumber: number;
  ticketTitle: string;
  ticketDescription: string;
  ticketAcceptanceCriteria: string[];
}

export function buildPrompt(input: PromptInput): string {
  const criteria = input.ticketAcceptanceCriteria
    .map((c) => `- ${c}`)
    .join('\n');

  return [
    `You are a ${input.role} on the ${input.projectName} team.`,
    '',
    `## Project`,
    `${input.projectName} — ${input.projectStack}`,
    input.projectContext,
    '',
    `## Ticket #${input.ticketNumber}: ${input.ticketTitle}`,
    input.ticketDescription,
    '',
    `Acceptance criteria:`,
    criteria,
  ].join('\n');
}
```

**Step 4: Create TicketBoard**

Create `apps/desktop/src/components/board/TicketBoard.tsx`:

```tsx
import { useState } from 'react';
import { useTicketStore, type TicketStatus } from '../../store/ticketStore';
import { TicketCard } from './TicketCard';
import { TicketCanvas } from '../canvas/TicketCanvas';

const COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'refined', label: 'Refined' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'shipped', label: 'Shipped' },
];

export function TicketBoard() {
  const { tickets } = useTicketStore();
  const [canvasTicketId, setCanvasTicketId] = useState<string | null>(null);

  if (canvasTicketId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
          <button
            onClick={() => setCanvasTicketId(null)}
            className="text-neutral-400 hover:text-white text-sm transition-colors"
          >
            ← Back to board
          </button>
          <span className="text-neutral-500 text-sm">
            {tickets.find(t => t.id === canvasTicketId)?.title}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <TicketCanvas ticketId={canvasTicketId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 p-4 overflow-x-auto h-full">
      {COLUMNS.map((col) => {
        const colTickets = tickets.filter((t) => t.status === col.id);
        return (
          <div key={col.id} className="flex-shrink-0 w-56">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-neutral-400 text-xs font-semibold uppercase tracking-wider">
                {col.label}
              </h3>
              <span className="text-neutral-600 text-xs">{colTickets.length}</span>
            </div>
            <div className="space-y-2">
              {colTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onOpenCanvas={setCanvasTicketId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 5: Wire TicketBoard into MainArea**

Edit `apps/desktop/src/components/layout/MainArea.tsx` — import and render `TicketBoard` for `activeView === 'dashboard'`.

**Step 6: Type check and dev run**

```bash
cd apps/desktop && pnpm tsc --noEmit 2>&1
pnpm --filter @poietai/desktop tauri dev
```

Expected: the default view shows the ticket board with the demo ticket in the Refined column.

**Step 7: Commit**

```bash
git add apps/desktop/src/store/ticketStore.ts
git add apps/desktop/src/components/board/
git add apps/desktop/src/lib/
git commit -m "feat(react): add ticket board with kanban columns and agent assignment"
```

---

## Final: The Moment That Proves It

With all tasks complete, you have the full v1 loop:

1. Open the app → ticket board shows with the demo ticket
2. Hover the "Fix nil guard" card → "Assign agent" appears
3. Click "Assign agent" → Rust creates a worktree, spawns `claude --print --output-format stream-json`, board moves the card to "Assigned"
4. Canvas view opens automatically → nodes appear as Claude reasons
5. If Claude asks a question → amber pulse, overlay appears → you reply → agent continues
6. Agent commits, opens PR via `gh pr create`
7. PR poller detects CI review → review comment feeds back to agent
8. Agent addresses it, CI approves → DM arrives: "PR #N is clean, ready for merge"

---

*Plan written: 2026-02-20*
*Implements: docs/plans/2026-02-20-agent-execution-design.md*
