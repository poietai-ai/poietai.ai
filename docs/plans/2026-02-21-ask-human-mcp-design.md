# ask_human MCP Tool — Design

**Date:** 2026-02-21
**Status:** Approved

## Problem

When Claude Code runs as a headless agent (`--print` mode):

1. The `AskUserQuestion` interactive tool always errors — skills that call it (brainstorming, etc.) silently break mid-session.
2. The current "ask and wait" mechanism requires Claude to exit, save a session ID, and be re-spawned via `--resume`. This works for end-of-task questions but cannot pause mid-task.

The desired behavior: an agent sends a question to the user ("Slack message" feel), stays running, waits for a reply, then continues the task.

## Solution

Two changes:

1. **Short-term fix** — add two lines to the system prompt that suppress `AskUserQuestion` and skills in headless mode.
2. **MCP `ask_human` tool** — a global axum HTTP/SSE server inside Tauri that Claude can call to block and wait for a human reply.

---

## Short-Term Fix

Add to the `## When to Ask vs. Proceed` section in `context/builder.rs`:

```
Do NOT use the `AskUserQuestion` tool — it is disabled in headless mode and will always error.
Do NOT invoke skills (brainstorming, writing-plans, debugging, etc.) — skills are for interactive sessions, not automated agents.
```

---

## MCP Server Architecture

### New module: `src-tauri/src/mcp/`

| File | Purpose |
|---|---|
| `mod.rs` | Public surface, re-exports `start_server` and `McpAppState` |
| `server.rs` | axum HTTP/SSE server — MCP protocol handler |
| `state.rs` | `McpState { port: u16, pending: Mutex<HashMap<String, oneshot::Sender<String>>> }` |

### New Cargo dependencies

```toml
axum = "0.7"
# tokio already present; add "net" feature
tokio = { version = "1", features = ["rt-multi-thread", "macros", "process", "io-util", "time", "sync", "net"] }
```

### Server lifecycle

Started once in `tauri::Builder::setup()` on an OS-assigned port (`bind("127.0.0.1:0")`). The actual port is stored in `AppState` so agent runs can read it.

### How Claude discovers the server

Before spawning Claude, `process.rs` writes a `.claude/settings.json` into the worktree:

```json
{
  "mcpServers": {
    "poietai": { "type": "sse", "url": "http://127.0.0.1:{PORT}/sse" }
  }
}
```

### System prompt addition (`builder.rs`)

```
## MCP Tools
You have an `ask_human(question, agent_id)` tool available via MCP.
Use it whenever you need clarification that would change your approach.
Always pass agent_id="{agent_id}" exactly as given.
```

---

## Data Flow

```
Claude subprocess
  │
  ├─ GET /sse → SSE connection (MCP handshake: initialize, tools/list)
  │
  └─ tools/call ask_human { question: "...", agent_id: "abc-123" }
       │
       ├─ MCP handler: insert oneshot::Sender into pending["abc-123"]
       ├─ app.emit("agent-question", { agent_id, question })   ← Tauri event
       └─ await oneshot::Receiver   (Claude blocks here — stays running)
                │
                │  User sees inline question card in the ticket canvas
                │  User types reply and submits
                │
       invoke("answer_agent", { agent_id: "abc-123", reply: "..." })
                │
       Tauri cmd: pending["abc-123"].send(reply)
                │
       oneshot delivers → MCP response returns reply text to Claude
                │
       Claude continues the task
```

The existing `agent-result` / `AskUserOverlay` path (exit → `--resume`) is kept intact as a fallback for end-of-task questions.

---

## Frontend Changes

- **New Tauri event listener:** `agent-question` → renders an inline question card on the ticket canvas, above the current work stream, labeled "Agent needs input"
- **New Tauri command:** `answer_agent(agent_id, reply)` → delivers the reply to the waiting oneshot channel
- `AskUserOverlay` is kept unchanged for the exit-based flow

---

## Error Handling

| Scenario | Handling |
|---|---|
| User closes app mid-question | Sender drops → Receiver errors → MCP returns error to Claude → Claude surfaces it and stops |
| No reply after 10 minutes | `tokio::time::timeout` wraps the Receiver → times out → MCP returns timeout error to Claude |
| Port conflict at startup | Bind to port 0 (OS-assigned) eliminates this entirely |
| Wrong agent_id in ask_human call | MCP returns structured error: "unknown agent_id" |

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `axum`, add `net` feature to tokio |
| `src-tauri/src/mcp/mod.rs` | New module |
| `src-tauri/src/mcp/server.rs` | axum MCP HTTP/SSE server |
| `src-tauri/src/mcp/state.rs` | `McpState` struct |
| `src-tauri/src/lib.rs` | Start MCP server in `setup()`, add `answer_agent` command |
| `src-tauri/src/agent/process.rs` | Write `.claude/settings.json` to worktree before spawn |
| `src-tauri/src/context/builder.rs` | Short-term fix + MCP tool instructions in system prompt |
| `src/components/canvas/TicketCanvas.tsx` | Listen for `agent-question`, render question card |
| `src/components/canvas/AgentQuestionCard.tsx` | New component — inline question + reply input |
| `src/types/canvas.ts` | Add `AgentQuestionPayload` type |
