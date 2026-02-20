# Agent Execution System — Design Document

> *The engine that makes the office feel alive.*

**Goal:** Design the system that takes a ticket from the board, runs an AI agent against it, makes the agent's full reasoning visible on the canvas in real time, manages the GitHub PR and CI review loop, and routes all communication back through the Slack layer — using Claude Code CLI as the execution engine and a thin Rust orchestration layer.

**Architecture:** Claude Code CLI (`claude --print --output-format stream-json`) runs headless in isolated git worktrees. Rust manages processes, parses the JSONL event stream, and emits typed Tauri events to React. React renders the event stream as a live node graph on the ticket canvas. GitHub App identities give each agent a real presence on GitHub.

**Tech Stack:** Rust (Tauri backend), Claude Code CLI 2.x, `gh` CLI, `git worktree`, GitHub Apps API, Tauri IPC events, React (canvas renderer)

---

## Stack Overview

```
┌─────────────────────────────────────────────────────┐
│  React (UI layer)                                   │
│  Canvas renderer · Slack layer · Ticket board       │
│              ↑ Tauri events (typed structs)         │
├─────────────────────────────────────────────────────┤
│  Rust (orchestration layer)                         │
│  Process manager · Worktree manager                 │
│  Event parser · GitHub poller · Agent state         │
│              ↑ JSONL pipe (stdout)                  │
├─────────────────────────────────────────────────────┤
│  Claude Code CLI  (execution layer)                 │
│  claude --print --output-format stream-json         │
│  Running inside git worktree, as agent identity     │
│              ↑ git + gh CLI + file tools            │
├─────────────────────────────────────────────────────┤
│  GitHub (external)                                  │
│  Branches · PRs · App identities · CI review        │
└─────────────────────────────────────────────────────┘
```

The Rust layer is intentionally thin. It does I/O, process management, and state tracking. It does not implement agent logic. All intelligence lives in Claude Code.

---

## The Event Pipeline

When an agent starts a ticket, Claude Code emits a JSONL stream — one JSON object per line — representing every step of its reasoning and execution. Rust reads each line, parses it into a typed event, and emits a Tauri event to React. React renders each event as a canvas node and draws a wire from the previous node.

**The canvas builds itself in real time. It is not a log replay.**

### Event Type Mapping

| Claude Code stream event | Canvas node type | Color |
|---|---|---|
| `thinking` content block | 💭 **Thought box** — full reasoning text, expandable | Indigo |
| `tool_use: Read` | 📄 **File read** — filename + minimap preview | Blue |
| `tool_use: Edit` | ✏️ **File edit** — filename + diff preview on hover | Green |
| `tool_use: Write` (new file) | 🆕 **New file** — filename + content preview | Emerald |
| `tool_use: Bash` | ⚙️ **Command** — command string + truncated output | Orange |
| `text` (agent narrating) | 💬 **Agent message** — also routed to ticket chat | Neutral |
| Agent asks user a question | ⏸ **Awaiting you** — pulses amber, thread paused | Amber |
| User reply received | ✅ **You answered** — shows reply text | White |
| PR opened (detected from gh output) | 🔀 **PR opened** — number + title | Purple |
| CI review comment received | 🔍 **Review** — issue count badge, red/green status | Red/Green |

### Wire Types

Two wire types overlay on the same canvas:

- **Execution wire** (white) — the sequential reasoning chain: this thought caused this file read, that read led to this edit. Built from the stream in real time.
- **Structural wire** (subtle gray) — static codebase connections: imports, function calls, type dependencies. Always present, generated from codebase analysis on project setup. Dims when not relevant to the current ticket.

### The Pause Moment

When the agent needs your input, the canvas freezes. The awaiting node pulses. The question routes to your DM. You reply in the ticket chat or DM. A wire draws from your reply back into the graph. The agent continues.

**Your decision is now a node in the reasoning chain** — permanently visible in the ticket's history. Any future agent reading this ticket sees not just what was built, but the conversation that shaped it.

### Example Canvas Sequence

```
💭 "Need to understand how token deduction is ordered before
    touching the billing handler"
    │
    ▼ execution wire
📄 billing_service.go  [minimap]
    │
    ▼
💭 "Deduction happens before DB write — but no nil guard on
    subscription. Could panic if middleware ever changes."
    │
    ▼
📄 billing_handler.go  [minimap]
    │
    ▼
⏸  "Does middleware guarantee subscription is always set,
    or should I add the guard defensively?"
    │ (canvas paused — awaiting user)
    │
    ▼ (user replies: "Middleware guarantees it — add a comment")
✅ "Middleware guarantees it — add a comment explaining why"
    │
    ▼
📋 CLAUDE.md  ──── structural wire ──→  billing_service.go
    │
    ▼
💭 "Pattern: service methods wrap errors with apperr.New.
    I'll add a comment per the handler convention."
    │
    ▼
✏️  billing_service.go  [diff on hover]
    │
    ▼
🆕 billing_service_test.go
    │
    ▼
🔀 PR #312 opened  "fix: add nil guard comment + test"
    │
    ▼
🔍 CI Review — 1 issue  [red]
    │
    ▼
💭 "Blob URL cleanup — stale closure. Need stagedRef pattern."
    │
    ▼
✏️  billing_service.go
    │
    ▼
🔍 CI Review — LGTM  [green]
```

---

## The Ticket Lifecycle

```
BACKLOG
   │
   ▼  Agent scout polls every 60s
CANDIDATE SELECTED
   │  Score ticket vs agent: role match, complexity, workload
   │
   ▼  Check pickup settings
   ├─ Below threshold → auto-grab
   │    DM: "Hey, jumped on #45. Seemed straightforward."
   ├─ Above threshold → ask
   │    DM: "Is it cool if I start on #87? Touches billing middleware."
   └─ Always ask → ask
        DM: "You weren't planning on grabbing #135 yourself, were you?"
   │
   ▼  User approves (or auto-approved)
WORKTREE CREATED
   │  git worktree add .worktrees/<ticket-id> -b feat/<ticket-slug>
   │  env: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GH_TOKEN (agent app)
   │
   ▼
AGENT RUNNING ◄─────────────────────────────────────┐
   │  claude --print                                 │
   │    --output-format stream-json                  │
   │    --append-system-prompt "<role+personality    │
   │      +project context+ticket context>"          │
   │    --allowedTools "Bash(git:*),Bash(gh:*),      │
   │      Edit,Write,Read,Bash(cargo:*),..."          │
   │    "<ticket description + acceptance criteria>" │
   │                                                 │
   │  Stream → Rust parser → Tauri events            │
   │  Canvas nodes build in real time ─────────────► canvas
   │  Agent text messages ─────────────────────────► ticket chat
   │  Questions ───────────────────────────────────► DM to user
   │                                                 │
   ▼  Agent commits + pushes                         │
PR OPENED  (via agent GitHub App token)              │
   │                                                 │
   ▼  Rust polls: gh pr view <n> --json comments     │
WAITING FOR CI REVIEW  (poll every 30s)              │
   │                                                 │
   ▼  CI review comment detected                     │
REVIEW RECEIVED ─── feed comment back as prompt ─────┘
   │  (loop until CI review says LGTM / approved)
   │
   ▼
AWAITING MERGE APPROVAL
   │  Agent DMs: "PR #312 is clean. CI approved.
   │   Two rounds, both issues resolved. Ready when you are."
   │
   ▼  User merges (poietai.ai UI or GitHub)
SHIPPED
   │  git worktree remove .worktrees/<ticket-id>
   │  git branch -d feat/<ticket-slug>  (or keep, user setting)
   │  Ticket moved to SHIPPED column
   └─ Agent status → idle → scout checks backlog
```

---

## GitHub App Identities

Each agent **role** has its own GitHub App registered under the poietai.ai GitHub organization. When you add a project to poietai.ai, it walks you through installing the relevant apps on that repo.

### What This Gives You

- **Commits** — `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` set per worktree environment. `git log` shows "Staff Engineer", "QA Agent", etc. as commit authors.
- **PRs** — opened by `poietai-staff-engineer[bot]`, `poietai-qa[bot]`, etc. with their avatar.
- **PR comments** — each agent posts under their GitHub identity. Review history is per-agent.
- **Approvals / change requests** — `poietai-qa[bot]` requests changes. `poietai-staff-engineer[bot]` approves.
- **`@mentionable`** — any team member can `@poietai-qa` in a GitHub comment.

### Token Management

GitHub App installation tokens expire every hour. Rust holds a token refresh loop per agent — requests a new token at 55 minutes, stores it in memory (never on disk in plaintext), injects it into the next process spawn via environment variable.

### The Marketplace Connection

When you hire an agent from the marketplace, their corresponding GitHub App gets added to your repo installation. They don't just appear in poietai.ai — they join your GitHub org. Their review history and commit history follow them.

### App Registry (v1 agent roles)

| Role | GitHub App name |
|---|---|
| Staff Engineer | `poietai-staff-engineer` |
| Backend Engineer | `poietai-backend-engineer` |
| Frontend Engineer | `poietai-frontend-engineer` |
| Fullstack Engineer | `poietai-fullstack-engineer` |
| QA | `poietai-qa` |
| Product Manager | `poietai-product-manager` |
| DevOps | `poietai-devops` |
| Designer | `poietai-designer` |
| Security / Compliance | `poietai-security` |
| Technical Writer | `poietai-technical-writer` |

Custom agents get a generic `poietai-agent[bot]` identity until published to the marketplace (where they get their own App).

---

## The Ticket Pickup System

A background **agent scout** runs on a configurable interval (default: 60 seconds). It scans the backlog, scores unassigned tickets against idle agents, and triggers the pickup flow.

### Scoring

A ticket is scored against an agent by:
- **Role match** — does the ticket type match the agent's role? (frontend ticket → frontend engineer)
- **Complexity fit** — is the complexity within the agent's configured range?
- **Current workload** — is the agent under their max concurrent ticket limit?
- **Priority** — higher priority tickets score higher

### Pickup Settings (per agent)

```
┌─────────────────────────────────────────────────────┐
│ Staff Engineer — Pickup Settings                    │
│                                                     │
│ Auto-grab complexity ≤  [====●─────]  5             │
│ Always ask before grabbing          [○] off         │
│ Notify me on auto-grab              [●] on          │
│ Max concurrent tickets              [●──] 2         │
└─────────────────────────────────────────────────────┘
```

### Personality-Flavored Ask Messages

The pickup message is generated by a short Claude API call with the agent's personality trait:

| Personality | Example message |
|---|---|
| Pragmatic | *"Jumped on #45. Seems straightforward — billing nil guard."* |
| Perfectionist | *"Before I grab #87 — want to make sure you didn't have specific notes on the token refund edge case. All yours if so."* |
| Ambitious | *"#135 looks like a good one — the new dashboard feature. Mind if I take it?"* |
| Conservative | *"Is it cool if I start on #87? Complexity 4, so within my range, but wanted to check."* |
| Devil's Advocate | *"I'll take #45 but flagging — acceptance criteria don't mention error state. Starting anyway, will ask when I get there."* |

### User Response Options

When an agent asks, your DM shows three quick-reply options:
- ✅ **Go for it**
- ❌ **Leave it** (I'll handle it or reassign)
- 💬 **Reply with instructions** (free text — agent incorporates into its approach)

If no response in 10 minutes → one gentle follow-up. After that → agent moves to the next ticket in the queue and leaves the original unassigned.

---

## Context Injection — The CLAUDE.md Problem, Solved

Every agent run gets a `--append-system-prompt` with three layers of context:

### Layer 1: Agent Identity
```
You are a [role] with a [personality] working style.
[Role description — what you own, what you don't touch]
[Personality description — how you approach problems,
 when you ask questions vs proceed, how verbose you are]
```

### Layer 2: Project Context (auto-generated + maintained)
```
Project: [name]
Stack: [inferred from repo]
Key files: [indexed file map — path, purpose, last modified]
Patterns: [coding conventions inferred from codebase]
Architecture: [layer boundaries, service structure]
Decisions: [captured from past brainstorm rooms + design reviews]
```

### Layer 3: Ticket Context
```
Ticket #[N]: [title]
Description: [full description]
Acceptance criteria: [list]
Related tickets: [linked ticket titles]
Relevant rooms: [links to brainstorm/design review transcripts]
Files likely involved: [suggested by PM agent or previous work]
```

### Context Generation

On first project add, a one-time **context agent** runs:
- Reads repo structure, key files, package manifests
- Infers stack, patterns, and architecture
- Produces a draft context doc shown for your review
- You edit, approve, and it becomes the project's context

As work happens, agents can propose updates: *"I established a new pattern for GitHub App token injection — want me to add it to the project context?"* You approve or reject. The context evolves with the codebase.

---

## The Rust Backend — Five Modules

*The Rust layer is intentionally learnable. Each module has one clear responsibility. No module is longer than ~200 lines.*

### `agent/process.rs` — Process Manager

Spawns `claude --print` as a child process with the right environment. Reads stdout line by line in an async loop. Sends each line to the event parser. Handles clean shutdown (SIGTERM to the child process on ticket cancel).

**Key Rust concepts used:** `tokio::process::Command`, `BufReader`, async streams. Good intro to Rust async I/O.

### `agent/events.rs` — Event Parser

Deserializes each JSONL line into a typed Rust enum. Rust's `serde_json` + `enum` with `#[serde(tag = "type")]` makes this clean. Exhaustive pattern matching means the compiler tells you if you forget an event type.

```rust
// Conceptual shape:
enum AgentEvent {
    Thinking { text: String },
    FileRead { path: String },
    FileEdit { path: String, diff: String },
    AskUser { question: String },
    BashCommand { command: String, output: String },
    // ...
}
```

**Key Rust concepts used:** enums, pattern matching, serde deserialization. Core Rust.

### `git/worktree.rs` — Worktree Manager

Runs `git worktree add` and `git worktree remove` via `std::process::Command`. Constructs the environment for each worktree (author name, email, GitHub token). Tracks active worktrees in a `HashMap<TicketId, WorktreePath>`.

**Key Rust concepts used:** `Command`, `HashMap`, string formatting. Straightforward.

### `github/poller.rs` — GitHub Poller

After a PR is opened, polls `gh pr view <n> --json comments,reviews` on a timer. Diffs the response against the last seen state to detect new CI comments. When a new review is detected, emits an event that feeds the comment back to the agent process as a follow-up.

**Key Rust concepts used:** `tokio::time::interval`, JSON parsing, async tasks. Good async Rust practice.

### `agent/state.rs` — Agent State Store

An in-memory store wrapped in `Arc<Mutex<HashMap<AgentId, AgentState>>>`. Tracks each agent's current status, ticket, process handle, and worktree path. The React frontend queries this via Tauri `invoke` commands to render the agent roster and ticket board.

**Key Rust concepts used:** `Arc`, `Mutex`, shared state across async tasks. Important Rust pattern — you'll understand why it works the way it does after the first compile error.

---

## What v1 Ships

The full design is the target. v1 is the smallest slice that completes one end-to-end loop and makes the experience feel real.

| Feature | v1 | Later |
|---|---|---|
| Single agent, single ticket | ✅ | |
| Worktree creation + cleanup | ✅ | |
| `claude --print stream-json` execution | ✅ | |
| Canvas node rendering from stream | ✅ | |
| Ask-user pause + resume | ✅ | |
| Agent DMs via Slack layer | ✅ | |
| PR opened via `gh` CLI | ✅ | |
| CI review poll + feed-back loop | ✅ | |
| Merge approval DM | ✅ | |
| Ticket pickup with personality DM | ✅ | |
| GitHub App identities | ✅ | |
| Context auto-generation | ✅ | |
| Multiple parallel agents | | ✅ |
| Ticket scout (auto-pickup from backlog) | | ✅ |
| Marketplace agent hiring | | ✅ |
| Multi-repo workspace | | ✅ |
| Context auto-maintenance | | ✅ |

---

## The Moment That Proves It

You assign a ticket. A DM arrives: *"Is it cool if I start on #87? Touches the billing middleware — wanted to flag it."* You reply: *"Go for it. Start with the service layer."*

You switch to the ticket canvas. A node appears: a thought box. Then a file read. Then another thought. Then the agent pauses — amber pulse — *"Does middleware guarantee subscription is set, or should I guard defensively?"* You answer in two sentences. The canvas resumes. Nodes build. Files get edited. A new test file appears.

Thirty minutes later, a DM: *"PR #312 is up. CI reviewed it — one issue with a stale closure I've already addressed. Second review came back clean. Ready for your merge when you are."*

You look at the canvas. You can see exactly what the agent thought, what it read, what it decided, where you shaped it. You merge.

That's the product.

---

*Design finalized: 2026-02-20*
