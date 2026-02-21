# ask_human MCP Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give AI agents an `ask_human` MCP tool that pauses mid-task, surfaces a question in the UI, and resumes when the user replies — plus a short-term fix suppressing `AskUserQuestion` and skills in headless mode.

**Architecture:** A global axum HTTP/SSE server starts inside the Tauri process on an OS-assigned port. Claude discovers it via `.claude/settings.json` written into each worktree before spawn. When Claude calls `ask_human`, the MCP handler stores a `oneshot::Sender` keyed by `agent_id`, emits a Tauri event to the frontend, and blocks until `answer_agent` delivers the reply.

**Tech Stack:** Rust (axum 0.7, tokio, serde_json), TypeScript/React (Tauri invoke/listen), MCP SSE transport (protocol version 2024-11-05)

---

### Task 1: Short-term fix — suppress AskUserQuestion and skills in TypeScript prompt builder

**Files:**
- Modify: `apps/desktop/src/lib/promptBuilder.ts`
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

**Context:** The system prompt is built in TypeScript via `buildPrompt()` and passed to `start_agent` as `system_prompt`. This is the prompt Claude actually receives. `context/builder.rs` is the Rust mirror — updated separately in Task 2.

**Step 1: Write a failing test**

There are no existing tests for `promptBuilder.ts`. Create `apps/desktop/src/lib/promptBuilder.test.ts`:

```typescript
import { buildPrompt } from './promptBuilder';

const base = {
  agentId: 'agent-abc',
  role: 'backend-engineer',
  personality: 'pragmatic',
  projectName: 'MyApp',
  projectStack: 'Go, PostgreSQL',
  projectContext: '',
  ticketNumber: 1,
  ticketTitle: 'Fix bug',
  ticketDescription: 'The thing is broken.',
  ticketAcceptanceCriteria: [],
};

test('prompt includes agent id in MCP section', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('agent-abc');
  expect(prompt).toContain('ask_human');
});

test('prompt suppresses AskUserQuestion', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('AskUserQuestion');
  expect(prompt).toContain('disabled');
});

test('prompt suppresses skills', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('skills');
  expect(prompt).toContain('automated agent');
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop && pnpm test promptBuilder
```
Expected: FAIL — `ask_human`, `AskUserQuestion`, `automated agent` not found.

**Step 3: Add `agentId` to `PromptInput` and update `buildPrompt`**

Replace the full content of `apps/desktop/src/lib/promptBuilder.ts`:

```typescript
// Thin TypeScript mirror of the Rust context builder.
// Used for quick prompt assembly from the React layer without an invoke round-trip.

interface PromptInput {
  agentId: string;
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
    `## Your Role`,
    `You are a ${input.role} on the ${input.projectName} team.`,
    ``,
    `## Project`,
    `${input.projectName} — ${input.projectStack}`,
    input.projectContext,
    ``,
    `## Ticket #${input.ticketNumber}: ${input.ticketTitle}`,
    input.ticketDescription,
    ``,
    `Acceptance criteria:`,
    criteria || `No explicit criteria — use good judgment.`,
    ``,
    `## Tool Restrictions`,
    `Do NOT use the \`AskUserQuestion\` tool — it is disabled in headless mode and will always error.`,
    `Do NOT invoke skills (brainstorming, writing-plans, debugging, etc.) — skills are for interactive sessions, not automated agents.`,
    ``,
    `## MCP Tools`,
    `You have an \`ask_human\` tool available via the poietai MCP server.`,
    `Use it when you need clarification that would meaningfully change your approach.`,
    `Always call it with agent_id="${input.agentId}" exactly.`,
  ].join('\n');
}
```

**Step 4: Pass `agentId` in TicketCard.tsx**

In `apps/desktop/src/components/board/TicketCard.tsx`, find the `buildPrompt({...})` call (line 43) and add `agentId: agent.id`:

```typescript
const systemPrompt = buildPrompt({
  agentId: agent.id,        // ADD THIS LINE
  role: agent.role,
  personality: agent.personality,
  projectName: project.name,
  projectStack: 'Rust, React 19, Tauri 2, TypeScript',
  projectContext: '',
  ticketNumber: parseInt(ticket.id.replace('ticket-', ''), 10) || 0,
  ticketTitle: ticket.title,
  ticketDescription: ticket.description,
  ticketAcceptanceCriteria: ticket.acceptanceCriteria,
});
```

**Step 5: Run tests**

```bash
cd apps/desktop && pnpm test promptBuilder
```
Expected: 3 tests PASS.

**Step 6: Check TypeScript compiles**

```bash
cd apps/desktop && pnpm tsc --noEmit
```
Expected: no errors.

**Step 7: Commit**

```bash
git add apps/desktop/src/lib/promptBuilder.ts apps/desktop/src/lib/promptBuilder.test.ts apps/desktop/src/components/board/TicketCard.tsx
git commit -m "fix: suppress AskUserQuestion/skills; add ask_human MCP instructions to prompt"
```

---

### Task 2: Short-term fix — sync Rust context/builder.rs

**Files:**
- Modify: `apps/desktop/src-tauri/src/context/builder.rs`

**Context:** `builder.rs` is the canonical Rust builder (has full role/personality descriptions). It's not used in the current React flow but must stay in sync. Add `agent_id` field and the same suppressions.

**Step 1: Add `agent_id` to `ContextInput` and format string**

In `apps/desktop/src-tauri/src/context/builder.rs`:

Add `pub agent_id: &'a str,` to `ContextInput` after `ticket_acceptance_criteria`:

```rust
pub struct ContextInput<'a> {
    pub role: &'a str,
    pub personality: &'a str,
    pub project_name: &'a str,
    pub project_stack: &'a str,
    pub project_context: &'a str,
    pub ticket_number: u32,
    pub ticket_title: &'a str,
    pub ticket_description: &'a str,
    pub ticket_acceptance_criteria: &'a [String],
    pub agent_id: &'a str,  // ADD
}
```

In the `format!(...)` call inside `build()`, replace the `## When to Ask vs. Proceed` section with:

```rust
        "## When to Ask vs. Proceed\n\
        You are working asynchronously. ALWAYS ask rather than assume when you encounter:\n\
        - Requirements with multiple valid interpretations\n\
        - A design decision with meaningfully different tradeoffs (e.g. two library choices)\n\
        - Unclear scope — something that might belong in a separate ticket\n\
        - A risk or dependency the requester may not be aware of\n\
        - Anything where a wrong assumption could waste significant effort\n\n\
        Do NOT use the `AskUserQuestion` tool — it is disabled in headless mode and will always error.\n\
        Do NOT invoke skills (brainstorming, writing-plans, debugging, etc.) — skills are for interactive sessions, not automated agents.\n\n\
        To ask: output your question(s) as your final message and stop. Do not continue past a question.\n\
        The user will reply and your session will be resumed with their answer.\n\n\
        ## MCP Tools\n\
        You have an `ask_human` tool available via the poietai MCP server.\n\
        Use it when you need clarification that would meaningfully change your approach.\n\
        Always call it with agent_id=\"{agent_id}\" exactly.\n\n\
        ## Working Instructions\n\
        - Commit your changes with clear messages as you work\n\
        - When ready to create a PR, use: gh pr create --title \"...\" --body \"...\"\n\
        - Follow existing patterns from the project context above",
```

And add `agent_id = input.agent_id,` to the format arguments.

**Step 2: Update all tests in builder.rs**

Every `ContextInput { ... }` in the tests needs `agent_id: "test-agent-123"` added. There are two helpers: `build_prompt_with_criteria` and the inline test in `unknown_personality_uses_default`. Update both.

In `build_prompt_with_criteria`:
```rust
fn build_prompt_with_criteria(criteria: &[String]) -> String {
    let input = ContextInput {
        role: "backend-engineer",
        personality: "pragmatic",
        project_name: "RRP API",
        project_stack: "Go 1.23, PostgreSQL, pgx",
        project_context: "Key patterns: use apperr.New for errors. Database via pgx pool.",
        ticket_number: 87,
        ticket_title: "Fix nil guard in billing service",
        ticket_description: "The subscription pointer is not guarded before deduction.",
        ticket_acceptance_criteria: criteria,
        agent_id: "test-agent-123",  // ADD
    };
    build(&input)
}
```

In `unknown_personality_uses_default`, add `agent_id: "test-agent-123"` to the `ContextInput` there too.

Add a new test:
```rust
#[test]
fn includes_agent_id_in_mcp_section() {
    let prompt = build_prompt_with_criteria(&default_criteria());
    assert!(prompt.contains("test-agent-123"));
    assert!(prompt.contains("ask_human"));
}

#[test]
fn includes_skill_suppression() {
    let prompt = build_prompt_with_criteria(&default_criteria());
    assert!(prompt.contains("AskUserQuestion"));
    assert!(prompt.contains("automated agent"));
}
```

**Step 3: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test context
```
Expected: all tests PASS.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/context/builder.rs
git commit -m "fix: sync Rust builder with TS — add agent_id, skill/AskUserQuestion suppression"
```

---

### Task 3: Add axum and tokio-stream to Cargo.toml

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Step 1: Add dependencies**

In `[dependencies]`, add:
```toml
axum = "0.7"
tokio-stream = "0.1"
```

Update the existing `tokio` line to add `net`:
```toml
tokio = { version = "1", features = ["rt-multi-thread", "macros", "process", "io-util", "time", "sync", "net"] }
```

**Step 2: Verify it compiles**

```bash
cd apps/desktop/src-tauri && cargo check
```
Expected: compiles without errors. (axum will download ~30 dependencies.)

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "chore: add axum and tokio-stream for MCP HTTP/SSE server"
```

---

### Task 4: MCP server module

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp/mod.rs`
- Create: `apps/desktop/src-tauri/src/mcp/server.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `mod mcp;`)

**Step 1: Write failing tests for the JSON-RPC handlers**

Create `apps/desktop/src-tauri/src/mcp/server.rs` with just the test module first:

```rust
// apps/desktop/src-tauri/src/mcp/server.rs

#[cfg(test)]
mod tests {
    use serde_json::json;

    // Helper: pure JSON-RPC responses without needing AppHandle.
    // Mirrors the logic in handle_jsonrpc for testable methods.
    fn initialize_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "poietai", "version": "1.0.0" }
            }
        })
    }

    fn tools_list_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [{
                    "name": "ask_human",
                    "description": "Ask the human a question and wait for their reply.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "agent_id": { "type": "string" }
                        },
                        "required": ["question", "agent_id"]
                    }
                }]
            }
        })
    }

    #[test]
    fn initialize_has_correct_protocol_version() {
        let resp = initialize_response(json!(1));
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
    }

    #[test]
    fn initialize_includes_tools_capability() {
        let resp = initialize_response(json!(1));
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_contains_ask_human() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "ask_human");
    }

    #[test]
    fn ask_human_schema_requires_question_and_agent_id() {
        let resp = tools_list_response(json!(2));
        let required = resp["result"]["tools"][0]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> = required.iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(required_strs.contains(&"question"));
        assert!(required_strs.contains(&"agent_id"));
    }
}
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop/src-tauri && cargo test mcp
```
Expected: compile error — `mcp` module doesn't exist yet.

**Step 3: Create mod.rs**

```rust
// apps/desktop/src-tauri/src/mcp/mod.rs
mod server;
pub use server::{serve, McpState};

use std::net::TcpListener;

/// Bind an OS-assigned localhost port synchronously.
/// Call this in Tauri's setup() before the async runtime has full control.
pub fn bind() -> TcpListener {
    TcpListener::bind("127.0.0.1:0").expect("MCP: failed to bind port")
}

pub fn bound_port(listener: &TcpListener) -> u16 {
    listener.local_addr().expect("MCP: no local addr").port()
}
```

**Step 4: Create the full server.rs**

```rust
// apps/desktop/src-tauri/src/mcp/server.rs

use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_stream::wrappers::ReceiverStream;

// ── Public types ─────────────────────────────────────────────────────────────

/// State held in AppState — provides `answer()` for the answer_agent command.
pub struct McpState {
    pub port: u16,
    pub(super) pending_questions:
        Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

impl McpState {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Deliver a reply to a waiting ask_human call.
    /// Returns Err if no question is pending for this agent_id.
    pub async fn answer(&self, agent_id: &str, reply: String) -> Result<(), String> {
        let tx = {
            let mut pending = self.pending_questions.lock().await;
            pending.remove(agent_id)
        };
        match tx {
            Some(sender) => sender
                .send(reply)
                .map_err(|_| "agent is no longer waiting".to_string()),
            None => Err(format!("no pending question for agent '{}'", agent_id)),
        }
    }
}

// ── Axum internal state ───────────────────────────────────────────────────────

type SseSender = mpsc::Sender<Result<Event, Infallible>>;

#[derive(Clone)]
struct ServerState {
    sessions: Arc<Mutex<HashMap<String, SseSender>>>,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    app: tauri::AppHandle,
}

#[derive(Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Serve the MCP HTTP/SSE server on the given std listener.
/// Call via tauri::async_runtime::spawn().
pub async fn serve(
    listener: std::net::TcpListener,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    app: tauri::AppHandle,
) {
    let state = ServerState {
        sessions: Arc::new(Mutex::new(HashMap::new())),
        pending_questions,
        app,
    };

    let router = Router::new()
        .route("/sse", get(sse_handler))
        .route("/message", post(message_handler))
        .with_state(state);

    let tokio_listener = tokio::net::TcpListener::from_std(listener)
        .expect("MCP: failed to convert listener");

    axum::serve(tokio_listener, router)
        .await
        .expect("MCP server crashed");
}

// ── SSE handler ───────────────────────────────────────────────────────────────

async fn sse_handler(
    State(state): State<ServerState>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);

    state.sessions.lock().await.insert(session_id.clone(), tx.clone());

    // Tell the client where to POST messages
    let _ = tx
        .send(Ok(Event::default()
            .event("endpoint")
            .data(format!("/message?sessionId={}", session_id))))
        .await;

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

// ── Message handler ───────────────────────────────────────────────────────────

async fn message_handler(
    Query(SessionQuery { session_id }): Query<SessionQuery>,
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> StatusCode {
    // Respond 202 immediately; send the JSON-RPC response over SSE async.
    tokio::spawn(async move {
        if let Some(resp) = handle_jsonrpc(&state, body).await {
            let data = serde_json::to_string(&resp).unwrap_or_default();
            let sessions = state.sessions.lock().await;
            if let Some(tx) = sessions.get(&session_id) {
                let _ = tx
                    .send(Ok(Event::default().event("message").data(data)))
                    .await;
            }
        }
    });

    StatusCode::ACCEPTED
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

async fn handle_jsonrpc(state: &ServerState, body: Value) -> Option<Value> {
    let id = body.get("id").cloned();
    let method = body["method"].as_str()?;

    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "poietai", "version": "1.0.0" }
            }
        })),

        // Client signals ready — no response needed
        "notifications/initialized" => None,

        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [{
                    "name": "ask_human",
                    "description": "Ask the human a question and wait for their reply. Use when you need clarification that would meaningfully change your approach.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The question to ask"
                            },
                            "agent_id": {
                                "type": "string",
                                "description": "Your agent ID, exactly as given in your system prompt"
                            }
                        },
                        "required": ["question", "agent_id"]
                    }
                }]
            }
        })),

        "tools/call" => {
            let params = body.get("params")?;
            if params["name"].as_str()? != "ask_human" {
                return Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "Unknown tool" }
                }));
            }

            let question = params["arguments"]["question"].as_str()?.to_string();
            let agent_id = params["arguments"]["agent_id"].as_str()?.to_string();

            let (tx, rx) = oneshot::channel::<String>();
            state
                .pending_questions
                .lock()
                .await
                .insert(agent_id.clone(), tx);

            let _ = state.app.emit(
                "agent-question",
                json!({ "agent_id": agent_id, "question": question }),
            );

            // Block until reply arrives or timeout (10 minutes)
            match tokio::time::timeout(Duration::from_secs(600), rx).await {
                Ok(Ok(reply)) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": reply }],
                        "isError": false
                    }
                })),
                Ok(Err(_)) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32001, "message": "Reply channel closed (app may have been closed)" }
                })),
                Err(_) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32002, "message": "Timed out waiting for human reply (10 minutes)" }
                })),
            }
        }

        _ => None,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use serde_json::json;

    fn initialize_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "poietai", "version": "1.0.0" }
            }
        })
    }

    fn tools_list_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [{
                    "name": "ask_human",
                    "description": "Ask the human a question and wait for their reply.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "agent_id": { "type": "string" }
                        },
                        "required": ["question", "agent_id"]
                    }
                }]
            }
        })
    }

    #[test]
    fn initialize_has_correct_protocol_version() {
        let resp = initialize_response(json!(1));
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
    }

    #[test]
    fn initialize_includes_tools_capability() {
        let resp = initialize_response(json!(1));
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_contains_ask_human() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "ask_human");
    }

    #[test]
    fn ask_human_schema_requires_question_and_agent_id() {
        let resp = tools_list_response(json!(2));
        let required = resp["result"]["tools"][0]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"question"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[tokio::test]
    async fn mcp_state_answer_returns_err_when_no_pending() {
        let state = super::McpState::new(9999);
        let result = state.answer("nonexistent", "hello".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no pending question"));
    }

    #[tokio::test]
    async fn mcp_state_answer_delivers_reply() {
        use tokio::sync::oneshot;
        let state = super::McpState::new(9999);
        let (tx, rx) = oneshot::channel::<String>();
        state
            .pending_questions
            .lock()
            .await
            .insert("agent-1".to_string(), tx);
        let result = state.answer("agent-1", "use approach A".to_string()).await;
        assert!(result.is_ok());
        let received = rx.await.unwrap();
        assert_eq!(received, "use approach A");
    }
}
```

**Step 5: Add `mod mcp;` to lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, find the `mod` block at the top (lines 1-4) and add:

```rust
mod agent;
mod context;
mod git;
mod github;
mod mcp;       // ADD
```

**Step 6: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test mcp
```
Expected: 6 tests PASS.

**Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add MCP server module with ask_human tool"
```

---

### Task 5: Wire MCP server into AppState and Tauri setup

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Context:** `AppState` currently has one field `agents: StateStore`. We need to add `mcp: mcp::McpState`. The `manage()` call must move into `.setup()` because binding the listener is synchronous but spawning the server is async.

**Step 1: Update `AppState` and add `answer_agent` command**

In `lib.rs`, make the following changes:

1. Update `AppState`:
```rust
pub struct AppState {
    pub agents: StateStore,
    pub mcp: mcp::McpState,
}
```

2. Add the `answer_agent` command (after `start_pr_poll`):
```rust
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
```

3. Replace the `.manage(AppState { ... })` + `.invoke_handler(...)` + `.run(...)` block with a `.setup()` block. The full updated `run()` function:

```rust
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
                agents: agent::state::new_store(),
                mcp,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_agent,
            scan_folder,
            get_all_agents,
            start_agent,
            resume_agent,
            start_pr_poll,
            answer_agent,   // ADD
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 2: cargo check**

```bash
cd apps/desktop/src-tauri && cargo check
```
Expected: compiles without errors.

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add answer_agent command; wire MCP server into Tauri setup"
```

---

### Task 6: Write .claude/settings.json before spawning Claude

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/process.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Context:** `AgentRunConfig` needs a `mcp_port: u16` field. Before spawning Claude, `process::run()` writes `.claude/settings.json` to the worktree so Claude discovers the MCP server. Both `start_agent` and `resume_agent` in `lib.rs` must pass the port.

**Step 1: Add `mcp_port` to `AgentRunConfig`**

In `apps/desktop/src-tauri/src/agent/process.rs`, add to `AgentRunConfig`:

```rust
pub struct AgentRunConfig {
    pub agent_id: String,
    pub ticket_id: String,
    pub prompt: String,
    pub system_prompt: String,
    pub allowed_tools: Vec<String>,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
    pub resume_session_id: Option<String>,
    pub mcp_port: u16,   // ADD — port of the Tauri MCP server
}
```

**Step 2: Write .claude/settings.json in `run()`**

In `process::run()`, at the top of the function body (after the info! log, before the `#[cfg(target_os = "windows")]` block):

```rust
// Write .claude/settings.json so Claude discovers the MCP server
{
    let claude_dir = config.working_dir.join(".claude");
    tokio::fs::create_dir_all(&claude_dir)
        .await
        .with_context(|| format!("failed to create {:?}", claude_dir))?;

    let settings = serde_json::json!({
        "mcpServers": {
            "poietai": {
                "type": "sse",
                "url": format!("http://127.0.0.1:{}/sse", config.mcp_port)
            }
        }
    });

    tokio::fs::write(
        claude_dir.join("settings.json"),
        serde_json::to_string_pretty(&settings).unwrap(),
    )
    .await
    .with_context(|| "failed to write .claude/settings.json")?;

    info!(
        "[process::run] wrote .claude/settings.json for agent={} mcp_port={}",
        config.agent_id, config.mcp_port
    );
}
```

**Step 3: Pass mcp_port in `start_agent` and `resume_agent` in lib.rs**

In `start_agent`, add `mcp_port: state.mcp.port,` to the `AgentRunConfig`:

```rust
let run_config = agent::process::AgentRunConfig {
    agent_id: payload.agent_id.clone(),
    ticket_id: payload.ticket_id.clone(),
    prompt: payload.prompt.clone(),
    system_prompt: payload.system_prompt.clone(),
    allowed_tools: vec![...],
    working_dir: worktree.path.clone(),
    env,
    resume_session_id: payload.resume_session_id,
    mcp_port: state.mcp.port,   // ADD
};
```

In `resume_agent`, add `mcp_port: state.mcp.port,` to the `AgentRunConfig` there too.

**Step 4: cargo check**

```bash
cd apps/desktop/src-tauri && cargo check
```
Expected: no errors.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/process.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: write .claude/settings.json to worktree so Claude discovers MCP server"
```

---

### Task 7: Frontend types and AgentQuestionCard component

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/AgentQuestionCard.tsx`

**Step 1: Add `AgentQuestionPayload` type**

In `apps/desktop/src/types/canvas.ts`, add at the end:

```typescript
/// Emitted by Tauri when Claude calls ask_human mid-task.
/// Agent stays running — answer via invoke('answer_agent', { agentId, reply }).
export interface AgentQuestionPayload {
  agent_id: string;
  question: string;
}
```

**Step 2: Create `AgentQuestionCard`**

```typescript
// apps/desktop/src/components/canvas/AgentQuestionCard.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentQuestionPayload } from '../../types/canvas';

interface Props {
  payload: AgentQuestionPayload;
  onAnswered: (agentId: string) => void;
}

export function AgentQuestionCard({ payload, onAnswered }: Props) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await invoke('answer_agent', { agentId: payload.agent_id, reply: reply.trim() });
      onAnswered(payload.agent_id);
    } catch (err) {
      console.error('Failed to deliver reply:', err);
      setSending(false);
    }
  };

  return (
    <div className="border border-violet-400 bg-violet-50 rounded-lg p-4 shadow-md">
      <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">
        Agent needs input
      </p>
      <p className="text-sm text-zinc-800 mb-3">{payload.question}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type your reply…"
          disabled={sending}
          autoFocus
          className="flex-1 text-sm border border-zinc-300 rounded px-3 py-1.5
                     focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="submit"
          disabled={sending || !reply.trim()}
          className="text-sm bg-violet-600 text-white px-3 py-1.5 rounded
                     hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

**Step 3: Check TypeScript compiles**

```bash
cd apps/desktop && pnpm tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/types/canvas.ts apps/desktop/src/components/canvas/AgentQuestionCard.tsx
git commit -m "feat: add AgentQuestionCard component and AgentQuestionPayload type"
```

---

### Task 8: Wire AgentQuestionCard into TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Add state, listener, and render**

Replace the full content of `TicketCanvas.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant } from '@xyflow/react';
import { listen } from '@tauri-apps/api/event';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { nodeTypes } from './nodes';
import { AskUserOverlay } from './AskUserOverlay';
import { AgentQuestionCard } from './AgentQuestionCard';
import type { CanvasNodePayload, AgentQuestionPayload } from '../../types/canvas';

interface AgentResultPayload {
  agent_id: string;
  ticket_id: string;
  session_id?: string;
}

interface TicketCanvasProps {
  ticketId: string;
}

export function TicketCanvas({ ticketId }: TicketCanvasProps) {
  const {
    nodes, edges,
    setActiveTicket, addNodeFromEvent,
    awaitingQuestion, awaitingSessionId,
    setAwaiting, clearAwaiting,
  } = useCanvasStore();

  // Active mid-task questions from ask_human MCP calls (agent stays running)
  const [activeQuestions, setActiveQuestions] = useState<AgentQuestionPayload[]>([]);

  useEffect(() => {
    setActiveTicket(ticketId);
  }, [ticketId, setActiveTicket]);

  // Listen for canvas node events from the agent stream
  useEffect(() => {
    const unlisten = listen<CanvasNodePayload>('agent-event', (event) => {
      addNodeFromEvent(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addNodeFromEvent]);

  // Listen for end-of-run questions (agent exited, resume flow)
  useEffect(() => {
    const unlisten = listen<AgentResultPayload>('agent-result', (event) => {
      const { session_id } = event.payload;
      if (!session_id) return;

      const currentNodes = useCanvasStore.getState().nodes;
      const lastTextNode = [...currentNodes]
        .reverse()
        .find((n) => n.data.nodeType === 'agent_message');

      if (lastTextNode && String(lastTextNode.data.content).trim().endsWith('?')) {
        setAwaiting(String(lastTextNode.data.content), session_id);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setAwaiting]);

  // Listen for mid-task questions from ask_human MCP calls (agent is still running)
  useEffect(() => {
    const unlisten = listen<AgentQuestionPayload>('agent-question', (event) => {
      setActiveQuestions((prev) => {
        // Deduplicate by agent_id — replace if already asking
        const filtered = prev.filter((q) => q.agent_id !== event.payload.agent_id);
        return [...filtered, event.payload];
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleQuestionAnswered = (agentId: string) => {
    setActiveQuestions((prev) => prev.filter((q) => q.agent_id !== agentId));
  };

  const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  const agentId = lastNode ? String(lastNode.data.agentId ?? '') : '';

  return (
    <div className="relative w-full h-full bg-zinc-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="light"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#d4d4d8"
        />
        <Controls />
      </ReactFlow>

      {/* Mid-task questions — agent is still running, waiting for reply */}
      {activeQuestions.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 pointer-events-auto">
          {activeQuestions.map((q) => (
            <AgentQuestionCard
              key={q.agent_id}
              payload={q}
              onAnswered={handleQuestionAnswered}
            />
          ))}
        </div>
      )}

      {/* End-of-run question — agent exited, will resume via --resume */}
      {awaitingQuestion && awaitingSessionId && (
        <AskUserOverlay
          question={awaitingQuestion}
          sessionId={awaitingSessionId}
          agentId={agentId}
          onDismiss={clearAwaiting}
        />
      )}
    </div>
  );
}
```

**Step 2: Check TypeScript compiles**

```bash
cd apps/desktop && pnpm tsc --noEmit
```
Expected: no errors.

**Step 3: Full build check**

```bash
cd apps/desktop && pnpm tauri build --no-bundle 2>&1 | tail -20
```
Expected: successful build.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat: render AgentQuestionCard for mid-task ask_human questions"
```

---

## Done

After all 8 tasks, the feature is complete:

- Agents no longer break on `AskUserQuestion` or skill invocations
- Each worktree gets a `.claude/settings.json` pointing at the MCP server
- `ask_human(question, agent_id)` is available to Claude mid-task
- The frontend shows an inline card, user types a reply, and Claude continues without restarting
- The existing exit-based `AskUserOverlay` remains for end-of-task questions
