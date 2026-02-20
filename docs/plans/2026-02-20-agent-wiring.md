# Agent Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace all hardcoded values in the agent execution flow with runtime sources — Slack-style project switching, an agent roster picker, a GH token in an encrypted local vault, and a dedicated resume command that skips worktree re-creation.

**Architecture:** Four systems built in sequence: Projects (workspace switcher + tauri-plugin-store persistence), Agent Roster (frontend Zustand store mirroring Rust `AgentState`, assignment picker modal), Secrets (tauri-plugin-stronghold encrypted vault for GH token + settings panel), Resume Command (new `resume_agent` Tauri command). Each is additive — no existing APIs change until Task 11 where `process::run` return type changes from `Result<()>` to `Result<Option<String>>`.

**Tech Stack:** Tauri 2, `tauri-plugin-store` (project persistence), `tauri-plugin-dialog` (native folder picker), `tauri-plugin-stronghold` (encrypted local vault), `tauri-plugin-fs` (install key file), `sha2` (vault key derivation), React 19, Zustand, TypeScript.

---

### Task 1: Install Tauri plugins

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Add crates to Cargo.toml**

Open `apps/desktop/src-tauri/Cargo.toml`. Add to `[dependencies]`:

```toml
tauri-plugin-store = "2"
tauri-plugin-dialog = "2"
tauri-plugin-stronghold = "2"
tauri-plugin-fs = "2"
sha2 = "0.10"
```

**Step 2: Install JS packages**

```bash
cd apps/desktop && pnpm add @tauri-apps/plugin-store @tauri-apps/plugin-dialog @tauri-apps/plugin-stronghold @tauri-apps/plugin-fs
```

Expected: packages install, no errors.

**Step 3: Update capabilities/default.json**

Replace `apps/desktop/src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "store:default",
    "stronghold:allow-initialize",
    "stronghold:allow-execute",
    "fs:default"
  ]
}
```

**Step 4: Register plugins in lib.rs**

Read `apps/desktop/src-tauri/src/lib.rs` first. Add this import after existing `use` statements:

```rust
use sha2::{Sha256, Digest};
```

Then update the `run()` function to register all plugins. The `.plugin(...)` calls go before `.manage(...)`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Derive a 32-byte vault key from the installation key + a fixed app salt.
                // sha2 is lighter than argon2 and adequate for a machine-specific key.
                let mut hasher = Sha256::new();
                hasher.update(password.as_ref());
                hasher.update(b"poietai-vault-2026");
                hasher.finalize().into()
            })
            .build(),
        )
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

**Step 5: Verify Rust compiles**

```bash
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished ... target(s)` (will download crates; may take 1–2 minutes).

**Step 6: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
        apps/desktop/package.json apps/desktop/pnpm-lock.yaml \
        apps/desktop/src-tauri/capabilities/default.json \
        apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: install tauri-plugin-store, dialog, stronghold, and fs"
```

---

### Task 2: Project store (frontend)

**Files:**
- Create: `apps/desktop/src/store/projectStore.ts`

The project store manages the list of workspace projects and which one is active. It persists to `projects.json` in the app's config directory via `tauri-plugin-store`. On first load it reads from disk; mutations write back immediately via `autoSave: true`.

**Step 1: Create projectStore.ts**

```typescript
// apps/desktop/src/store/projectStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export interface Project {
  id: string;
  name: string;
  repoRoot: string;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  loaded: boolean;

  loadFromDisk: () => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  switchProject: (id: string) => Promise<void>;
}

async function getStore() {
  return load('projects.json', { autoSave: true });
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loaded: false,

  loadFromDisk: async () => {
    const store = await getStore();
    const projects = (await store.get<Project[]>('projects')) ?? [];
    const activeProjectId = (await store.get<string>('activeProjectId')) ?? null;
    set({ projects, activeProjectId, loaded: true });
  },

  addProject: async (project) => {
    const { projects } = get();
    const updated = [...projects, project];
    const store = await getStore();
    await store.set('projects', updated);
    await store.set('activeProjectId', project.id);
    set({ projects: updated, activeProjectId: project.id });
  },

  switchProject: async (id) => {
    const store = await getStore();
    await store.set('activeProjectId', id);
    set({ activeProjectId: id });
  },
}));
```

**Step 2: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/store/projectStore.ts
git commit -m "feat(react): add project store with disk persistence"
```

---

### Task 3: Project switcher UI + AppShell update

**Files:**
- Create: `apps/desktop/src/components/layout/ProjectSwitcher.tsx`
- Modify: `apps/desktop/src/components/layout/AppShell.tsx`

A slim `w-14` column on the far-left (like Slack's workspace column). Shows one circle avatar per project, highlights the active one, and has a "+" button that opens a native folder picker to add a new project.

**Step 1: Create ProjectSwitcher.tsx**

```tsx
// apps/desktop/src/components/layout/ProjectSwitcher.tsx
import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore, type Project } from '../../store/projectStore';

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function ProjectSwitcher() {
  const { projects, activeProjectId, loaded, loadFromDisk, addProject, switchProject } =
    useProjectStore();

  useEffect(() => {
    if (!loaded) loadFromDisk();
  }, [loaded, loadFromDisk]);

  const handleAdd = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select project folder',
    });
    if (!selected) return;
    // open() returns string | string[] | null
    const repoRoot = Array.isArray(selected) ? selected[0] : selected;
    const name = repoRoot.split('/').filter(Boolean).pop() ?? 'Project';
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      repoRoot,
    };
    await addProject(project);
  };

  return (
    <div className="w-14 flex flex-col items-center py-3 gap-2 bg-neutral-950 border-r border-neutral-800">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => switchProject(p.id)}
          title={p.name}
          className={`w-9 h-9 rounded-xl text-xs font-bold transition-all ${
            p.id === activeProjectId
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-neutral-950'
              : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
          }`}
        >
          {initials(p.name)}
        </button>
      ))}
      <button
        onClick={handleAdd}
        title="Add project"
        className="w-9 h-9 rounded-xl bg-neutral-800 text-neutral-400 hover:bg-neutral-700
                   hover:text-neutral-200 text-xl flex items-center justify-center transition-colors"
      >
        +
      </button>
    </div>
  );
}
```

**Step 2: Update AppShell.tsx**

Read `apps/desktop/src/components/layout/AppShell.tsx`, then replace with:

```tsx
// apps/desktop/src/components/layout/AppShell.tsx
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <ProjectSwitcher />
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <MainArea activeView={activeView} />
    </div>
  );
}
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/desktop/src/components/layout/ProjectSwitcher.tsx \
        apps/desktop/src/components/layout/AppShell.tsx
git commit -m "feat(react): add project switcher column with native folder picker"
```

---

### Task 4: Agent frontend store

**Files:**
- Create: `apps/desktop/src/store/agentStore.ts`
- Modify: `apps/desktop/src/App.tsx`

Mirrors the Rust `AgentState`. Polls `get_all_agents` every 2 seconds. The polling is started from `App.tsx` on mount.

**Step 1: Create agentStore.ts**

```typescript
// apps/desktop/src/store/agentStore.ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type AgentStatus = 'idle' | 'working' | 'waiting_for_user' | 'reviewing' | 'blocked';

export interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  status: AgentStatus;
  current_ticket_id?: string;
  session_id?: string;
  worktree_path?: string;
}

interface AgentStore {
  agents: Agent[];
  _intervalId: ReturnType<typeof setInterval> | null;

  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  _intervalId: null,

  refresh: async () => {
    try {
      const agents = await invoke<Agent[]>('get_all_agents');
      set({ agents });
    } catch (e) {
      console.error('failed to fetch agents:', e);
    }
  },

  startPolling: () => {
    if (get()._intervalId) return;
    get().refresh();
    const id = setInterval(() => get().refresh(), 2000);
    set({ _intervalId: id });
  },

  stopPolling: () => {
    const id = get()._intervalId;
    if (id) clearInterval(id);
    set({ _intervalId: null });
  },
}));
```

**Step 2: Read App.tsx before modifying**

Read `apps/desktop/src/App.tsx` to understand the current structure.

**Step 3: Update App.tsx to start polling on mount**

```tsx
// apps/desktop/src/App.tsx
import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';

function App() {
  const { startPolling, stopPolling } = useAgentStore();

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  return <AppShell />;
}

export default App;
```

**Step 4: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/desktop/src/store/agentStore.ts apps/desktop/src/App.tsx
git commit -m "feat(react): add agent store with 2-second roster polling"
```

---

### Task 5: Agent creation modal

**Files:**
- Create: `apps/desktop/src/components/agents/CreateAgentModal.tsx`

A modal for creating new agents. Invokes `create_agent` on submit, then refreshes the roster.

**Step 1: Create CreateAgentModal.tsx**

```tsx
// apps/desktop/src/components/agents/CreateAgentModal.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../store/agentStore';

const ROLES = [
  'fullstack-engineer',
  'backend-engineer',
  'frontend-engineer',
  'devops',
] as const;

const PERSONALITIES = [
  'pragmatic',
  'meticulous',
  'creative',
  'systematic',
] as const;

interface Props {
  onClose: () => void;
}

export function CreateAgentModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(ROLES[0]);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0]);
  const [creating, setCreating] = useState(false);
  const { refresh } = useAgentStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const id = crypto.randomUUID();
      await invoke('create_agent', { id, name: name.trim(), role, personality });
      await refresh();
      onClose();
    } catch (e) {
      console.error('failed to create agent:', e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-80 shadow-2xl">
        <h2 className="text-neutral-100 font-semibold mb-4">New agent</h2>

        <label className="block text-neutral-400 text-xs mb-1">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="e.g. Atlas"
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-3"
        />

        <label className="block text-neutral-400 text-xs mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white mb-3 focus:outline-none focus:border-indigo-500"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <label className="block text-neutral-400 text-xs mb-1">Personality</label>
        <select
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white mb-4 focus:outline-none focus:border-indigo-500"
        >
          {PERSONALITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/desktop/src/components/agents/CreateAgentModal.tsx
git commit -m "feat(react): add agent creation modal"
```

---

### Task 6: Agent picker modal

**Files:**
- Create: `apps/desktop/src/components/agents/AgentPickerModal.tsx`

Shown when "Assign agent" is clicked on a ticket card. Lists idle agents at the top (green dot), busy agents below (orange dot). Calls `onSelect` with the chosen agent. Has a "New agent" button that opens `CreateAgentModal`.

**Step 1: Create AgentPickerModal.tsx**

```tsx
// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { CreateAgentModal } from './CreateAgentModal';

function statusDot(status: Agent['status']): string {
  switch (status) {
    case 'idle': return 'bg-green-500';
    case 'working': return 'bg-orange-400';
    case 'waiting_for_user': return 'bg-amber-400';
    default: return 'bg-neutral-500';
  }
}

function statusLabel(agent: Agent): string {
  if (agent.status === 'idle') return 'Idle';
  if (agent.status === 'working') return `Working on ${agent.current_ticket_id ?? 'a ticket'}`;
  return agent.status.replace(/_/g, ' ');
}

interface Props {
  onSelect: (agent: Agent) => void;
  onClose: () => void;
}

export function AgentPickerModal({ onSelect, onClose }: Props) {
  const { agents } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  const idle = agents.filter((a) => a.status === 'idle');
  const busy = agents.filter((a) => a.status !== 'idle');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-neutral-100 font-semibold text-sm">Assign agent</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {agents.length === 0 && (
          <p className="text-neutral-500 text-xs text-center py-4">
            No agents yet — create one below.
          </p>
        )}

        {idle.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">Available</p>
            {idle.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">
              Busy (will queue)
            </p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        )}

        <button
          onClick={() => setShowCreate(true)}
          className="w-full mt-2 text-xs text-indigo-400 hover:text-indigo-300 py-2
                     border border-dashed border-neutral-700 rounded-lg transition-colors"
        >
          + New agent
        </button>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  onSelect,
}: {
  agent: Agent;
  onSelect: (a: Agent) => void;
}) {
  return (
    <button
      onClick={() => onSelect(agent)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                 hover:bg-neutral-800 transition-colors text-left"
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
      <div className="min-w-0">
        <p className="text-neutral-200 text-sm">{agent.name}</p>
        <p className="text-neutral-500 text-xs truncate">{statusLabel(agent)}</p>
      </div>
    </button>
  );
}
```

**Step 2: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/desktop/src/components/agents/AgentPickerModal.tsx
git commit -m "feat(react): add agent picker modal"
```

---

### Task 7: Wire agent picker and project into TicketCard

**Files:**
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

Remove the hardcoded `"agent-1"` and `/home/keenan/...` path. Show the `AgentPickerModal` on "Assign agent" click, use the selected agent's `id`/`role`/`personality`, and use the active project's `repoRoot`.

**Step 1: Read TicketCard.tsx**

Read `apps/desktop/src/components/board/TicketCard.tsx` before editing.

**Step 2: Replace TicketCard.tsx**

```tsx
// apps/desktop/src/components/board/TicketCard.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTicketStore, type Ticket } from '../../store/ticketStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useProjectStore } from '../../store/projectStore';
import { AgentPickerModal } from '../agents/AgentPickerModal';
import { buildPrompt } from '../../lib/promptBuilder';
import type { Agent } from '../../store/agentStore';

interface TicketCardProps {
  ticket: Ticket;
  onOpenCanvas: (ticketId: string) => void;
}

function complexityClass(n: number): string {
  if (n <= 3) return 'text-green-400 bg-green-950';
  if (n <= 6) return 'text-yellow-400 bg-yellow-950';
  return 'text-red-400 bg-red-950';
}

export function TicketCard({ ticket, onOpenCanvas }: TicketCardProps) {
  const { assignTicket, updateTicketStatus } = useTicketStore();
  const { setActiveTicket } = useCanvasStore();
  const { projects, activeProjectId } = useProjectStore();
  const [showPicker, setShowPicker] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleAgentSelected = async (agent: Agent) => {
    setShowPicker(false);
    if (!activeProject) return;

    assignTicket(ticket.id, agent.id);

    const systemPrompt = buildPrompt({
      role: agent.role,
      personality: agent.personality,
      projectName: activeProject.name,
      projectStack: 'Rust, React 19, Tauri 2, TypeScript',
      projectContext: '',
      ticketNumber: parseInt(ticket.id.replace('ticket-', ''), 10) || 0,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketAcceptanceCriteria: ticket.acceptanceCriteria,
    });

    // GH token will be wired in Task 10 via secretsStore.
    // Using empty string here temporarily so the flow compiles end-to-end.
    const ghToken = '';

    try {
      await invoke('start_agent', {
        payload: {
          agent_id: agent.id,
          ticket_id: ticket.id,
          ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: `${ticket.title}\n\n${ticket.description}`,
          system_prompt: systemPrompt,
          repo_root: activeProject.repoRoot,
          gh_token: ghToken,
          resume_session_id: null,
        },
      });
      updateTicketStatus(ticket.id, 'in_progress');
      setActiveTicket(ticket.id);
      onOpenCanvas(ticket.id);
    } catch (err) {
      console.error('failed to start agent:', err);
    }
  };

  return (
    <>
      {showPicker && (
        <AgentPickerModal
          onSelect={handleAgentSelected}
          onClose={() => setShowPicker(false)}
        />
      )}

      <div
        className="bg-neutral-800 border border-neutral-700 rounded-lg p-3
                   hover:border-neutral-600 transition-colors cursor-pointer group"
        onClick={() => onOpenCanvas(ticket.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-neutral-100 text-sm leading-snug">{ticket.title}</p>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${complexityClass(ticket.complexity)}`}
          >
            {ticket.complexity}
          </span>
        </div>

        {ticket.assignedAgentId ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-indigo-700 text-xs text-white
                            flex items-center justify-center">
              A
            </div>
            <span className="text-neutral-500 text-xs truncate">{ticket.assignedAgentId}</span>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
            disabled={!activeProject}
            title={activeProject ? 'Assign an agent' : 'Select a project first'}
            className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0
                       group-hover:opacity-100 transition-opacity
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Assign agent
          </button>
        )}
      </div>
    </>
  );
}
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(react): wire agent picker and active project into TicketCard"
```

---

### Task 8: Secrets store (Stronghold vault)

**Files:**
- Create: `apps/desktop/src/store/secretsStore.ts`
- Modify: `apps/desktop/src/App.tsx`

Reads and writes the GH token from an encrypted local vault. On first launch, generates a random installation key and writes it to `install.key` in the app data directory. This key unlocks the Stronghold vault. If Stronghold fails (e.g. missing permissions), logs a warning and continues with `ghToken: null`.

**Step 1: Create secretsStore.ts**

```typescript
// apps/desktop/src/store/secretsStore.ts
import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';

const CLIENT_NAME = 'poietai';
const TOKEN_KEY = 'gh_token';

async function getInstallKey(): Promise<string> {
  const dir = await appDataDir();
  const keyPath = await join(dir, 'install.key');
  if (await exists(keyPath)) {
    return readTextFile(keyPath);
  }
  const key = crypto.randomUUID();
  await writeTextFile(keyPath, key);
  return key;
}

async function openVault() {
  const dir = await appDataDir();
  const vaultPath = await join(dir, 'vault.hold');
  const password = await getInstallKey();
  const stronghold = await Stronghold.load(vaultPath, password);
  const client = await stronghold.loadClient(CLIENT_NAME);
  return { stronghold, client };
}

interface SecretsStore {
  ghToken: string | null;
  loaded: boolean;

  loadToken: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsStore>((set) => ({
  ghToken: null,
  loaded: false,

  loadToken: async () => {
    try {
      const { client } = await openVault();
      const store = client.getStore();
      const raw = await store.get(TOKEN_KEY);
      if (raw) {
        const token = new TextDecoder().decode(new Uint8Array(raw));
        set({ ghToken: token, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      console.warn('Stronghold unavailable — GH token not loaded:', e);
      set({ loaded: true });
    }
  },

  saveToken: async (token: string) => {
    const { stronghold, client } = await openVault();
    const store = client.getStore();
    const encoded = Array.from(new TextEncoder().encode(token));
    await store.insert(TOKEN_KEY, encoded);
    await stronghold.save();
    set({ ghToken: token });
  },
}));
```

**Step 2: Load token on app startup in App.tsx**

Read `apps/desktop/src/App.tsx`, then update the `useEffect` to also call `loadToken`:

```tsx
// apps/desktop/src/App.tsx
import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';

function App() {
  const { startPolling, stopPolling } = useAgentStore();
  const { loadToken } = useSecretsStore();

  useEffect(() => {
    startPolling();
    loadToken();
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken]);

  return <AppShell />;
}

export default App;
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/desktop/src/store/secretsStore.ts apps/desktop/src/App.tsx
git commit -m "feat(react): add secrets store with Stronghold encrypted vault"
```

---

### Task 9: Settings panel UI

**Files:**
- Create: `apps/desktop/src/components/layout/SettingsPanel.tsx`
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx`
- Modify: `apps/desktop/src/components/layout/AppShell.tsx`

A modal panel with a GH token input. Accessible via a gear icon at the bottom of the sidebar.

**Step 1: Create SettingsPanel.tsx**

```tsx
// apps/desktop/src/components/layout/SettingsPanel.tsx
import { useState, useEffect } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { ghToken, saveToken } = useSecretsStore();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ghToken) setDraft(ghToken);
  }, [ghToken]);

  const handleSave = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await saveToken(draft.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('failed to save GH token:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-96 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-neutral-100 font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <label className="block text-neutral-400 text-xs mb-1">GitHub Token</label>
        <p className="text-neutral-600 text-xs mb-2">
          Used for PR creation and review polling. Stored in an encrypted local vault.
        </p>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ghp_..."
          className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 mb-3 font-mono"
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !draft.trim()}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update Sidebar.tsx — add gear icon and onSettings prop**

Read `apps/desktop/src/components/layout/Sidebar.tsx`. Add `onSettings: () => void` to `SidebarProps` and a gear button at the bottom:

```tsx
// apps/desktop/src/components/layout/Sidebar.tsx
const navItems = [
  { label: 'Dashboard', icon: '⌂', id: 'dashboard' },
  { label: 'Rooms', icon: '◉', id: 'rooms' },
  { label: 'Board', icon: '▦', id: 'board' },
  { label: 'Graph', icon: '⬡', id: 'graph' },
  { label: 'Messages', icon: '✉', id: 'messages' },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSettings: () => void;
}

export function Sidebar({ activeView, onNavigate, onSettings }: SidebarProps) {
  return (
    <aside className="w-16 flex flex-col items-center py-4 gap-2 bg-neutral-950 border-r border-neutral-800">
      <div className="mb-4 w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
        <span className="text-white text-xs font-bold">N</span>
      </div>
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors ${
            activeView === item.id
              ? 'bg-indigo-600 text-white'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
          }`}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onSettings}
        title="Settings"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xl
                   text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
      >
        ⚙
      </button>
    </aside>
  );
}
```

**Step 3: Update AppShell.tsx to wire settings panel**

Read `apps/desktop/src/components/layout/AppShell.tsx`, then update:

```tsx
// apps/desktop/src/components/layout/AppShell.tsx
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SettingsPanel } from './SettingsPanel';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <ProjectSwitcher />
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onSettings={() => setShowSettings(true)}
      />
      <MainArea activeView={activeView} />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
```

**Step 4: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/desktop/src/components/layout/SettingsPanel.tsx \
        apps/desktop/src/components/layout/Sidebar.tsx \
        apps/desktop/src/components/layout/AppShell.tsx
git commit -m "feat(react): add settings panel with GH token field and gear icon"
```

---

### Task 10: Wire GH token into agent invocations

**Files:**
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`
- Modify: `apps/desktop/src/components/canvas/AskUserOverlay.tsx`

Replace `gh_token: ''` placeholders with the real value from `useSecretsStore`. Simplify `AskUserOverlay` props (remove `repoRoot`, `systemPrompt`, `ticketSlug` — not needed for resume).

**Step 1: Update TicketCard.tsx**

Read `apps/desktop/src/components/board/TicketCard.tsx`. In `handleAgentSelected`, replace:

```tsx
const ghToken = '';
```

with:

```tsx
import { useSecretsStore } from '../../store/secretsStore';
// ...
const ghToken = useSecretsStore.getState().ghToken ?? '';
```

(The import goes at the top; the const stays inside `handleAgentSelected`.)

**Step 2: Update AskUserOverlay.tsx — simplify props**

Read `apps/desktop/src/components/canvas/AskUserOverlay.tsx`. The overlay currently accepts `ticketSlug`, `repoRoot`, and `systemPrompt` that were only needed for the old `start_agent` call. Remove them. The new interface is:

```tsx
interface AskUserOverlayProps {
  question: string;
  sessionId: string;
  agentId: string;
  ticketId: string;
  onDismiss: () => void;
}
```

Keep the `handleSend` calling `invoke('start_agent', ...)` for now with the correct GH token — Task 11 will replace it with `resume_agent`:

```tsx
const handleSend = async () => {
  if (!reply.trim()) return;
  setSending(true);
  try {
    // Temporary: calls start_agent which will attempt to re-create the worktree.
    // Task 11 replaces this with invoke('resume_agent', ...).
    await invoke('start_agent', {
      payload: {
        agent_id: agentId,
        ticket_id: ticketId,
        ticket_slug: ticketId,
        prompt: reply,
        system_prompt: '',
        repo_root: '',
        gh_token: useSecretsStore.getState().ghToken ?? '',
        resume_session_id: sessionId,
      },
    });
    onDismiss();
  } catch (err) {
    console.error('failed to resume agent:', err);
  } finally {
    setSending(false);
  }
};
```

Add import: `import { useSecretsStore } from '../../store/secretsStore';`

**Step 3: Update TicketCanvas.tsx — derive agentId dynamically**

Read `apps/desktop/src/components/canvas/TicketCanvas.tsx`. The overlay currently has `agentId="agent-1"` hardcoded. Replace with a dynamic value derived from the last canvas node:

```tsx
import { useProjectStore } from '../../store/projectStore';

// Inside the component (after nodes/edges destructuring):
const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
const agentId = lastNode ? String(lastNode.data.agentId) : '';
```

Update the `<AskUserOverlay>` render to remove the now-unnecessary props:

```tsx
{awaitingQuestion && awaitingSessionId && (
  <AskUserOverlay
    question={awaitingQuestion}
    sessionId={awaitingSessionId}
    agentId={agentId}
    ticketId={ticketId}
    onDismiss={clearAwaiting}
  />
)}
```

**Step 4: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/desktop/src/components/board/TicketCard.tsx \
        apps/desktop/src/components/canvas/TicketCanvas.tsx \
        apps/desktop/src/components/canvas/AskUserOverlay.tsx
git commit -m "feat(react): wire GH token from secrets store, simplify overlay props"
```

---

### Task 11: resume_agent Tauri command (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/state.rs`
- Modify: `apps/desktop/src-tauri/src/agent/process.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

Add `save_session_id` to state.rs, change `process::run()` to return `Result<Option<String>>` (the final session ID), add a `resume_agent` command to lib.rs.

**Step 1: Write failing tests in state.rs**

Read `apps/desktop/src-tauri/src/agent/state.rs`. Add to the `#[cfg(test)]` block:

```rust
#[test]
fn save_and_retrieve_session_id() {
    let store = new_store();
    upsert_agent(&store, make_agent("agent-5", AgentStatus::Idle));
    save_session_id(&store, "agent-5", "session-abc");

    let agent = get_agent(&store, "agent-5").unwrap();
    assert_eq!(agent.session_id, Some("session-abc".to_string()));
}

#[test]
fn save_session_id_no_op_for_missing_agent() {
    let store = new_store();
    // Should not panic — just silently does nothing
    save_session_id(&store, "nonexistent", "session-xyz");
    assert!(get_agent(&store, "nonexistent").is_none());
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent::state 2>&1 | grep -E "error\[|FAILED"
```

Expected: compile error — `save_session_id` not found.

**Step 3: Add save_session_id to state.rs**

Add after `set_status`:

```rust
/// Persist the Claude Code session ID on an agent after a successful run.
/// No-op if the agent ID is not found.
pub fn save_session_id(store: &StateStore, id: &str, session_id: &str) {
    let mut map = store.lock().unwrap();
    if let Some(agent) = map.get_mut(id) {
        agent.session_id = Some(session_id.to_string());
    }
}
```

**Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent::state 2>&1 | tail -5
```

Expected: `test result: ok. 6 passed`

**Step 5: Change process::run() return type to Result<Option<String>>**

Read `apps/desktop/src-tauri/src/agent/process.rs`. Change the function signature from:

```rust
pub async fn run(config: AgentRunConfig, app: AppHandle) -> Result<()> {
```

to:

```rust
pub async fn run(config: AgentRunConfig, app: AppHandle) -> Result<Option<String>> {
```

At the end of the function, replace:

```rust
if !status.success() {
    anyhow::bail!("claude process exited with status: {}", status);
}

Ok(())
```

with:

```rust
if !status.success() {
    anyhow::bail!("claude process exited with status: {}", status);
}

Ok(last_session_id)
```

**Step 6: Update start_agent in lib.rs to use new return value**

Read `apps/desktop/src-tauri/src/lib.rs`. In the `tokio::spawn` block of `start_agent`, change:

```rust
match agent::process::run(run_config, app_clone).await {
    Ok(()) => {
        set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
    }
```

to:

```rust
match agent::process::run(run_config, app_clone).await {
    Ok(session_id) => {
        if let Some(sid) = session_id {
            agent::state::save_session_id(&agents_store_clone, &agent_id, &sid);
        }
        set_status(&agents_store_clone, &agent_id, AgentStatus::Idle);
    }
```

**Step 7: Add resume_agent command to lib.rs**

Add this command after `start_agent`:

```rust
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
        system_prompt: String::new(),
        allowed_tools: vec![
            "Read".to_string(),
            "Edit".to_string(),
            "Write".to_string(),
            "Bash(git:*)".to_string(),
            "Bash(gh:*)".to_string(),
            "Bash(cargo:*)".to_string(),
            "Bash(pnpm:*)".to_string(),
        ],
        working_dir,
        env: vec![],
        resume_session_id: Some(session_id),
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
```

**Step 8: Register resume_agent in the invoke handler**

In the `.invoke_handler(tauri::generate_handler![...])` call, add `resume_agent`:

```rust
.invoke_handler(tauri::generate_handler![
    create_agent,
    get_all_agents,
    start_agent,
    resume_agent,
    start_pr_poll,
])
```

**Step 9: Run all Rust tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: `test result: ok. 29 passed` (27 original + 2 new state tests).

**Step 10: Commit**

```bash
git add apps/desktop/src-tauri/src/agent/state.rs \
        apps/desktop/src-tauri/src/agent/process.rs \
        apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add resume_agent command and session_id persistence"
```

---

### Task 12: Wire AskUserOverlay to resume_agent

**Files:**
- Modify: `apps/desktop/src/components/canvas/AskUserOverlay.tsx`

Replace the temporary `start_agent` call in the overlay with the new `resume_agent` command.

**Step 1: Read AskUserOverlay.tsx**

Read `apps/desktop/src/components/canvas/AskUserOverlay.tsx` to see the current state after Task 10.

**Step 2: Replace the invoke call**

Change the `handleSend` function to call `resume_agent` instead of `start_agent`.

The `resume_agent` Rust signature is:
```rust
async fn resume_agent(app, state, agent_id: String, session_id: String, prompt: String)
```

Tauri serializes camelCase JS keys to snake_case Rust params automatically.

Replace the `invoke` call:

```tsx
await invoke('resume_agent', {
  agentId,
  sessionId,
  prompt: reply,
});
```

Remove the now-unused `import { useSecretsStore }` if it was only used for `gh_token` in `start_agent`. Remove the full old `start_agent` payload block.

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

**Step 4: Run Rust tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `test result: ok. 29 passed`

**Step 5: Push**

```bash
git add apps/desktop/src/components/canvas/AskUserOverlay.tsx
git commit -m "feat(react): switch AskUserOverlay to resume_agent command"
git push origin main
```
