# Agent Wiring Design

**Goal:** Replace all hardcoded values (repo path, agent ID, GH token) with real runtime sources, add project-switching, and fix the resume flow.

**Architecture:** Four coordinated changes — Projects system, Agent Roster, Secrets (Stronghold), and a dedicated resume Tauri command. All are additive; no existing APIs change.

**Tech Stack:** Tauri 2, `tauri-plugin-store` (project persistence), `tauri-plugin-dialog` (folder picker), `tauri-plugin-stronghold` (OS keychain), React 19, Zustand, TypeScript.

---

## 1. Projects System

A **Project** represents one git repository the user works in, like a Slack workspace.

### Data model

```typescript
interface Project {
  id: string;       // uuid
  name: string;     // display name, user-entered
  repoRoot: string; // absolute path to the git repo root
}
```

### Persistence

Projects stored via `tauri-plugin-store` in the app's config directory (`app_config_dir()/projects.json`). Loaded on app startup. Active project ID stored in the same file.

### UI

- A slim **project switcher column** on the far-left of the app (inside or beside the sidebar), showing one avatar circle per project. Clicking an avatar switches the active project.
- A **"+" button** at the bottom opens: native folder-picker dialog → user picks the repo root → prompt for project name → project created and activated.
- Switching projects resets in-memory state (tickets, agents, canvas) for the new project.

### Data flow

`projectStore.ts` (Zustand) holds `projects[]` and `activeProjectId`. It reads/writes via `tauri-plugin-store`. The `activeProject.repoRoot` is passed to `start_agent` / `resume_agent` instead of the hardcoded string.

---

## 2. Agent Roster

### Frontend agent store

`agentStore.ts` (Zustand) mirrors the Rust `AgentState`. It polls `invoke('get_all_agents')` every 2 seconds while the app is in focus, replacing the result in-store.

```typescript
interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  status: 'idle' | 'working' | 'waiting_for_user' | 'reviewing' | 'blocked';
  currentTicketId?: string;
}
```

### Assignment flow

Clicking "Assign agent" on a TicketCard opens an **AgentPickerModal**:
- Lists all agents: idle agents at the top (green dot), working agents below (orange dot + current ticket name).
- Selecting an idle agent → `invoke('start_agent', ...)` immediately.
- Selecting a working agent → stores `{ ticketId, agentId }` as a pending assignment in `ticketStore`. When the poller sees that agent go idle, it triggers `start_agent` automatically.

### Agent creation

A **"+ New agent"** button in the roster panel opens a small form: name (text), role (dropdown: `fullstack-engineer | backend-engineer | frontend-engineer | devops`), personality (dropdown: `pragmatic | meticulous | creative | systematic`). Submitting invokes `create_agent` on the Rust side, then re-polls the roster.

### Wiring

Agent `id`, `role`, and `personality` from the selected agent replace the hardcoded `"agent-1"` in `TicketCard.tsx` and `TicketCanvas.tsx`. The `buildPrompt()` call uses the agent's `role` and `personality` fields.

---

## 3. Secrets — GH Token via Stronghold

### Storage

`tauri-plugin-stronghold` stores the GH token in the OS keychain:
- Windows: Credential Manager
- macOS: Keychain
- Linux: Secret Service (requires `gnome-keyring` or `kwallet`)

Stronghold requires a **salt** (a fixed per-installation random byte sequence) to derive the vault encryption key. The salt is generated on first launch and stored in `app_config_dir()/vault.salt`. The vault itself is stored at `app_config_dir()/vault.hold`.

### Settings panel

A gear icon in the sidebar opens a **Settings panel** with a "GitHub Token" field (masked input). On save, the token is written to Stronghold. On app startup, the token is read from Stronghold and held in a React context (`SecretsContext`) — never written to localStorage or logs.

### Fallback for WSL2

If Stronghold fails to initialize (no Secret Service daemon), show a warning in the Settings panel and allow the user to set `GH_TOKEN` in their shell environment. A Tauri command `get_gh_token` returns the Stronghold value if available, else reads from the process environment, else returns `null` (which causes the Settings panel to show the warning).

### Data flow

`TicketCard` and `AskUserOverlay` call `invoke('get_gh_token')` before calling `start_agent` / `resume_agent`. The token is never stored in React state beyond the invocation.

---

## 4. Resume Command

### Problem

`start_agent` always calls `git::worktree::create()`, which fails if the worktree for that ticket already exists.

### Solution

A new **`resume_agent`** Tauri command:

```rust
#[tauri::command]
async fn resume_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    prompt: String,
) -> Result<(), String>
```

It:
1. Looks up the agent in `StateStore` to get `worktree_path` and confirms `status == WaitingForUser`.
2. Builds an `AgentRunConfig` using the existing `worktree_path` (no worktree creation).
3. After a successful run, writes the new `session_id` back to `AgentState.session_id`.

### Frontend change

`AskUserOverlay` calls `invoke('resume_agent', { agent_id, session_id, prompt })` instead of `invoke('start_agent', ...)`.

### Session ID persistence

After `run()` completes, the Rust process manager extracts the `session_id` from the `Result` event and calls a new `save_session_id(store, agent_id, session_id)` helper that writes it to `AgentState`. This makes it available for the next resume.

---

## Error Handling

- **No active project**: disable "Assign agent" button with tooltip "Select a project first".
- **No agents**: show "Create an agent to get started" empty state in roster.
- **No GH token**: disable "Assign agent" with tooltip "Add a GitHub token in Settings".
- **Stronghold unavailable**: settings warning banner; fall back to env var.
- **Worktree already exists**: `resume_agent` only — skip creation and log.

---

## Out of Scope

- Task queuing for working agents (store pending assignment; auto-trigger on idle — minimal implementation only)
- Agent personality/role editing after creation
- Per-project agent rosters (agents are global across projects for now)
