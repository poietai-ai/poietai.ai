# Onboarding, Workspace & Provider Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Guide non-developer users from a blank app to their first agent-assigned ticket through a 3-step welcome wizard, while upgrading the Project model to support multiple repos per workspace and adding a repo picker to agent assignment.

**Architecture:** Twelve additive tasks in dependency order — Rust `scan_folder` command, `settingsStore` (onboarding state), updated `secretsStore` (provider-keyed + plaintext fallback), updated `Project`/`Ticket` models, the 3-step `OnboardingWizard` component, repo picker in `AgentPickerModal`, updated `TicketCard`, expanded `SettingsPanel`, and contextual nudges. No existing Tauri commands are removed.

**Tech Stack:** Tauri 2, React 19, Zustand, TypeScript, `tauri-plugin-store` (settings persistence), `tauri-plugin-stronghold` (token vault), `tauri-plugin-fs` (plaintext fallback), `tauri-plugin-dialog` (folder picker).

**Design doc:** `docs/plans/2026-02-20-onboarding-workspace-design.md`

---

### Task 1: `scan_folder` Rust command

**Files:**
- Create: `apps/desktop/src-tauri/src/git/scan.rs`
- Modify: `apps/desktop/src-tauri/src/git/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Context:** When the user picks a folder in the wizard, a Rust command scans it and returns one of three results: a single valid git repo, a list of git repos found one level deep (monorepo parent), or no repo at all. Provider is auto-detected from the git remote URL.

**Step 1: Write failing tests in scan.rs**

Create `apps/desktop/src-tauri/src/git/scan.rs`:

```rust
use std::path::Path;
use std::process::Command;
use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FolderScanResult {
    SingleRepo {
        name: String,
        repo_root: String,
        remote_url: Option<String>,
        provider: Option<String>,
    },
    MultiRepo {
        repos: Vec<RepoInfo>,
        suggested_name: String,
    },
    NoRepo,
}

#[derive(Serialize, Debug)]
pub struct RepoInfo {
    pub name: String,
    pub repo_root: String,
    pub remote_url: Option<String>,
    pub provider: Option<String>,
}

pub fn detect_provider(remote_url: &str) -> Option<&'static str> {
    if remote_url.contains("github.com") { Some("github") }
    else if remote_url.contains("gitlab.com") { Some("gitlab") }
    else if remote_url.contains("bitbucket.org") { Some("bitbucket") }
    else if remote_url.contains("dev.azure.com") || remote_url.contains("visualstudio.com") { Some("azure") }
    else { None }
}

pub fn get_remote_url(path: &Path) -> Option<String> {
    Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn scan_folder(path: &Path) -> FolderScanResult {
    // Case 1: path itself is a git repo
    if path.join(".git").exists() {
        let name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let remote_url = get_remote_url(path);
        let provider = remote_url.as_deref()
            .and_then(detect_provider)
            .map(String::from);
        return FolderScanResult::SingleRepo {
            name,
            repo_root: path.to_string_lossy().to_string(),
            remote_url,
            provider,
        };
    }

    // Case 2: scan one level deep for git repos
    let mut repos: Vec<RepoInfo> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        sorted.sort_by_key(|e| e.file_name());
        for entry in sorted {
            let sub = entry.path();
            if sub.is_dir() && sub.join(".git").exists() {
                let name = entry.file_name().to_string_lossy().to_string();
                let remote_url = get_remote_url(&sub);
                let provider = remote_url.as_deref()
                    .and_then(detect_provider)
                    .map(String::from);
                repos.push(RepoInfo {
                    name,
                    repo_root: sub.to_string_lossy().to_string(),
                    remote_url,
                    provider,
                });
            }
        }
    }

    if repos.is_empty() {
        FolderScanResult::NoRepo
    } else {
        let suggested_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        FolderScanResult::MultiRepo { repos, suggested_name }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_github_https() {
        assert_eq!(detect_provider("https://github.com/user/repo"), Some("github"));
    }

    #[test]
    fn detects_github_ssh() {
        assert_eq!(detect_provider("git@github.com:user/repo.git"), Some("github"));
    }

    #[test]
    fn detects_gitlab() {
        assert_eq!(detect_provider("https://gitlab.com/user/repo"), Some("gitlab"));
    }

    #[test]
    fn detects_bitbucket() {
        assert_eq!(detect_provider("https://bitbucket.org/user/repo"), Some("bitbucket"));
    }

    #[test]
    fn detects_azure() {
        assert_eq!(detect_provider("https://dev.azure.com/org/project/_git/repo"), Some("azure"));
    }

    #[test]
    fn returns_none_for_unknown_host() {
        assert_eq!(detect_provider("https://custom-git.company.com/repo"), None);
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml git::scan 2>&1 | grep -E "error\[|not found"
```

Expected: compile error — `scan` module not found.

**Step 3: Add module to git/mod.rs**

Edit `apps/desktop/src-tauri/src/git/mod.rs`:

```rust
pub mod scan;
pub mod worktree;
```

**Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml git::scan 2>&1 | tail -3
```

Expected: `test result: ok. 6 passed`

**Step 5: Add `scan_folder` Tauri command to lib.rs**

Read `apps/desktop/src-tauri/src/lib.rs`. Add this command after `create_agent`:

```rust
/// Scan a folder and return git repo information.
/// Returns SingleRepo, MultiRepo (one level deep), or NoRepo.
#[tauri::command]
fn scan_folder(path: String) -> git::scan::FolderScanResult {
    git::scan::scan_folder(std::path::Path::new(&path))
}
```

Add `scan_folder` to the invoke handler:

```rust
.invoke_handler(tauri::generate_handler![
    create_agent,
    get_all_agents,
    scan_folder,
    start_agent,
    resume_agent,
    start_pr_poll,
])
```

**Step 6: Verify Rust builds**

```bash
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -3
```

Expected: `Finished` with no errors.

**Step 7: Run all Rust tests**

```bash
cd apps/desktop/src-tauri && cargo test 2>&1 | grep "test result"
```

Expected: `test result: ok. 35 passed` (29 original + 6 new).

**Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/git/scan.rs \
        apps/desktop/src-tauri/src/git/mod.rs \
        apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(rust): add scan_folder command with provider auto-detection"
```

---

### Task 2: `settingsStore` — onboarding state

**Files:**
- Create: `apps/desktop/src/store/settingsStore.ts`

**Context:** Tracks whether the user has completed onboarding. Persisted to `settings.json` via `tauri-plugin-store`. `AppShell` will read `onboardingComplete` to decide whether to show the wizard or the main app.

**Step 1: Create settingsStore.ts**

```typescript
// apps/desktop/src/store/settingsStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

interface SettingsStore {
  onboardingComplete: boolean;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

async function getStore() {
  return load('settings.json', { defaults: {}, autoSave: true });
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  onboardingComplete: false,
  loaded: false,

  loadSettings: async () => {
    const store = await getStore();
    const onboardingComplete = (await store.get<boolean>('onboardingComplete')) ?? false;
    set({ onboardingComplete, loaded: true });
  },

  completeOnboarding: async () => {
    const store = await getStore();
    await store.set('onboardingComplete', true);
    set({ onboardingComplete: true });
  },
}));
```

**Step 2: Load settings on app startup**

Read `apps/desktop/src/App.tsx`. Add `useSettingsStore` and call `loadSettings` in the startup effect:

```tsx
// apps/desktop/src/App.tsx
import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAgentStore } from './store/agentStore';
import { useSecretsStore } from './store/secretsStore';
import { useSettingsStore } from './store/settingsStore';

function App() {
  const { startPolling, stopPolling } = useAgentStore();
  const { loadToken } = useSecretsStore();
  const { loadSettings } = useSettingsStore();

  useEffect(() => {
    startPolling();
    loadToken();
    loadSettings();
    return () => stopPolling();
  }, [startPolling, stopPolling, loadToken, loadSettings]);

  return <AppShell />;
}

export default App;
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/store/settingsStore.ts apps/desktop/src/App.tsx
git commit -m "feat(react): add settings store with onboarding state"
```

---

### Task 3: Update `secretsStore` — provider-keyed tokens + plaintext fallback

**Files:**
- Modify: `apps/desktop/src/store/secretsStore.ts`

**Context:** Change the Stronghold key from `gh_token` to `token:github` (provider-keyed, ready for GitLab etc.). Add a plaintext fallback to `tokens.json` for when Stronghold is unavailable (WSL2/Linux without keychain daemon). Migrate old `gh_token` key on load.

**Step 1: Update secretsStore.ts**

Read `apps/desktop/src/store/secretsStore.ts`. Replace entirely with:

```typescript
// apps/desktop/src/store/secretsStore.ts
import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure';

const CLIENT_NAME = 'poietai';

function tokenKey(provider: GitProvider): string {
  return `token:${provider}`;
}

// Plaintext fallback path — used when Stronghold is unavailable (e.g. WSL2).
async function getFallbackPath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, 'tokens.json');
}

async function readFallbackTokens(): Promise<Partial<Record<GitProvider, string>>> {
  const path = await getFallbackPath();
  if (!(await exists(path))) return {};
  try {
    return JSON.parse(await readTextFile(path));
  } catch {
    return {};
  }
}

async function writeFallbackTokens(tokens: Partial<Record<GitProvider, string>>): Promise<void> {
  const path = await getFallbackPath();
  await writeTextFile(path, JSON.stringify(tokens, null, 2));
}

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

  let client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
    await stronghold.save();
  }

  return { stronghold, client };
}

interface SecretsStore {
  ghToken: string | null;   // convenience alias for tokens['github']
  loaded: boolean;
  isLoading: boolean;
  usingFallback: boolean;   // true when Stronghold is unavailable

  loadToken: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsStore>((set, get) => ({
  ghToken: null,
  loaded: false,
  isLoading: false,
  usingFallback: false,

  loadToken: async () => {
    if (get().loaded || get().isLoading) return;
    set({ isLoading: true });

    // Try Stronghold first
    try {
      const { client } = await openVault();
      const store = client.getStore();

      // Try new provider-keyed key first, then migrate from old gh_token key
      let raw = await store.get(tokenKey('github'));
      if (!raw) {
        raw = await store.get('gh_token'); // legacy migration
        if (raw) {
          // Migrate to new key
          const encoded = Array.from(new TextEncoder().encode(
            new TextDecoder().decode(raw)
          ));
          try { await store.remove('gh_token'); } catch { /* ignore */ }
          await store.insert(tokenKey('github'), encoded);
          const { stronghold } = await openVault();
          await stronghold.save();
        }
      }

      if (raw) {
        const token = new TextDecoder().decode(raw);
        set({ ghToken: token, loaded: true, isLoading: false });
      } else {
        set({ loaded: true, isLoading: false });
      }
      return;
    } catch (e) {
      console.warn('Stronghold unavailable — trying plaintext fallback:', e);
    }

    // Plaintext fallback
    try {
      const tokens = await readFallbackTokens();
      const token = tokens['github'] ?? null;
      set({ ghToken: token, loaded: true, isLoading: false, usingFallback: true });
    } catch (e) {
      console.warn('Plaintext fallback also failed:', e);
      set({ loaded: true, isLoading: false, usingFallback: true });
    }
  },

  saveToken: async (token: string) => {
    // Try Stronghold first
    try {
      const { stronghold, client } = await openVault();
      const store = client.getStore();
      const encoded = Array.from(new TextEncoder().encode(token));
      try { await store.remove(tokenKey('github')); } catch { /* may not exist */ }
      await store.insert(tokenKey('github'), encoded);
      await stronghold.save();
      set({ ghToken: token, usingFallback: false });
      return;
    } catch (e) {
      console.warn('Stronghold save failed — using plaintext fallback:', e);
    }

    // Plaintext fallback
    const tokens = await readFallbackTokens();
    tokens['github'] = token;
    await writeFallbackTokens(tokens);
    set({ ghToken: token, usingFallback: true });
  },
}));
```

**Step 2: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/store/secretsStore.ts
git commit -m "feat(react): provider-keyed token storage with plaintext fallback"
```

---

### Task 4: Update `Project` model — `repos: Repo[]`

**Files:**
- Modify: `apps/desktop/src/store/projectStore.ts`

**Context:** `Project.repoRoot: string` becomes `Project.repos: Repo[]`. Each `Repo` has `id`, `name`, `repoRoot`, `remoteUrl?`, `provider`. `loadFromDisk` migrates old projects that only have `repoRoot`.

**Step 1: Update projectStore.ts**

Read `apps/desktop/src/store/projectStore.ts`. Replace entirely with:

```typescript
// apps/desktop/src/store/projectStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import type { GitProvider } from './secretsStore';

export interface Repo {
  id: string;
  name: string;
  repoRoot: string;
  remoteUrl?: string;
  provider: GitProvider;
}

export interface Project {
  id: string;
  name: string;
  repos: Repo[];
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
  return load('projects.json', { defaults: {}, autoSave: true });
}

// Migrate old project shape { repoRoot: string } → { repos: Repo[] }
function migrateProject(raw: Record<string, unknown>): Project {
  if (Array.isArray(raw.repos)) return raw as unknown as Project;
  // Legacy project had a single repoRoot string
  const repoRoot = raw.repoRoot as string ?? '';
  const name = raw.name as string ?? '';
  return {
    id: raw.id as string,
    name,
    repos: [{
      id: crypto.randomUUID(),
      name: repoRoot.split('/').filter(Boolean).pop() ?? name,
      repoRoot,
      provider: 'github',
    }],
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loaded: false,

  loadFromDisk: async () => {
    const store = await getStore();
    const raw = (await store.get<Record<string, unknown>[]>('projects')) ?? [];
    const projects = raw.map(migrateProject);
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

**Step 2: Fix ProjectSwitcher.tsx**

Read `apps/desktop/src/components/layout/ProjectSwitcher.tsx`. The `handleAdd` function built a `Project` with `repoRoot`. Update it to pass `repos: [...]` instead. Replace the `handleAdd` function:

```tsx
const handleAdd = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select project folder',
  });
  if (!selected) return;
  const repoRoot = selected as string;
  const repoName = repoRoot.split('/').filter(Boolean).pop() ?? 'Repo';
  const project: Project = {
    id: crypto.randomUUID(),
    name: repoName,
    repos: [{
      id: crypto.randomUUID(),
      name: repoName,
      repoRoot,
      provider: 'github',
    }],
  };
  await addProject(project);
};
```

Also update the import to include `Repo`:
```tsx
import { useProjectStore, type Project, type Repo } from '../../store/projectStore';
```

**Step 3: Fix TicketCard.tsx**

Read `apps/desktop/src/components/board/TicketCard.tsx`. The `handleAgentSelected` function uses `project.repoRoot`. Update it to use `project.repos[0]?.repoRoot ?? ''` as a temporary placeholder (Task 9 will wire the real repo picker):

```tsx
// Temporary: uses first repo until repo picker (Task 9) is wired in
const repoRoot = project.repos[0]?.repoRoot ?? '';
```

Replace the `repo_root: project.repoRoot` line with `repo_root: repoRoot`.

**Step 4: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors. Fix any remaining references to `project.repoRoot`.

**Step 5: Commit**

```bash
git add apps/desktop/src/store/projectStore.ts \
        apps/desktop/src/components/layout/ProjectSwitcher.tsx \
        apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(react): Project model now holds repos[] with migration from repoRoot"
```

---

### Task 5: Update `ticketStore` — `assignments: Assignment[]`

**Files:**
- Modify: `apps/desktop/src/store/ticketStore.ts`
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

**Context:** Replace `assignedAgentId?: string` with `assignments: Assignment[]`. Each assignment records which agent and which repo. `TicketCard` shows all assigned agents (first agent name + count if >1).

**Step 1: Update ticketStore.ts**

Read `apps/desktop/src/store/ticketStore.ts`. Replace entirely with:

```typescript
// apps/desktop/src/store/ticketStore.ts
import { create } from 'zustand';

export type TicketStatus =
  | 'backlog' | 'refined' | 'assigned'
  | 'in_progress' | 'in_review' | 'shipped';

export interface Assignment {
  agentId: string;
  repoId: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: number; // 1-10
  status: TicketStatus;
  assignments: Assignment[];
  acceptanceCriteria: string[];
}

interface TicketStore {
  tickets: Ticket[];
  selectedTicketId: string | null;

  addTicket: (ticket: Ticket) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => void;
  assignTicket: (ticketId: string, assignment: Assignment) => void;
  selectTicket: (id: string | null) => void;
}

const DEMO_TICKETS: Ticket[] = [
  {
    id: 'ticket-1',
    title: 'Fix nil guard in billing service',
    description: 'The subscription pointer is not checked before token deduction. Under certain conditions this can panic at runtime.',
    complexity: 3,
    status: 'refined',
    assignments: [],
    acceptanceCriteria: [
      'Subscription is guarded before token deduction',
      'Existing billing tests still pass',
      'New test covers the nil/missing case',
    ],
  },
  {
    id: 'ticket-2',
    title: 'Add loading state to dashboard metrics',
    description: 'Dashboard metrics flash undefined while fetching. Show a skeleton loader instead.',
    complexity: 2,
    status: 'backlog',
    assignments: [],
    acceptanceCriteria: [
      'Skeleton loader shows during fetch',
      'No layout shift when data loads',
    ],
  },
];

export const useTicketStore = create<TicketStore>((set) => ({
  tickets: DEMO_TICKETS,
  selectedTicketId: null,

  addTicket: (ticket) => set((s) => ({ tickets: [...s.tickets, ticket] })),

  updateTicketStatus: (id, status) =>
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status } : t)),
    })),

  assignTicket: (ticketId, assignment) =>
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId
          ? { ...t, assignments: [...t.assignments, assignment], status: 'assigned' as TicketStatus }
          : t
      ),
    })),

  selectTicket: (id) => set({ selectedTicketId: id }),
}));
```

**Step 2: Update TicketCard.tsx**

Read `apps/desktop/src/components/board/TicketCard.tsx`. Update the `handleAgentSelected` call and the assignment display.

Replace `assignTicket(ticket.id, agent.id)` with:
```tsx
assignTicket(ticket.id, { agentId: agent.id, repoId: '' }); // repoId wired in Task 9
```

Replace the assigned agent display block:
```tsx
{ticket.assignments.length > 0 ? (
  <div className="flex items-center gap-2">
    <div className="w-4 h-4 rounded-full bg-indigo-700 text-xs text-white
                    flex items-center justify-center">
      A
    </div>
    <span className="text-neutral-500 text-xs truncate">
      {ticket.assignments[0].agentId}
      {ticket.assignments.length > 1 && ` +${ticket.assignments.length - 1}`}
    </span>
  </div>
) : (
  // ... existing assign button
)}
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/store/ticketStore.ts \
        apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(react): Ticket assignments replace assignedAgentId"
```

---

### Task 6: `OnboardingWizard` — Step 1: Connect GitHub

**Files:**
- Create: `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`
- Create: `apps/desktop/src/components/onboarding/StepConnectGitHub.tsx`

**Context:** Step 1 explains what a GitHub PAT is, shows required permissions, includes a masked token input, and a "Test connection" button that calls `https://api.github.com/user`. On success it shows "Connected as @username". On Stronghold failure, `saveToken` still succeeds via the plaintext fallback — no extra handling needed here.

**Step 1: Create StepConnectGitHub.tsx**

```tsx
// apps/desktop/src/components/onboarding/StepConnectGitHub.tsx
import { useState } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; username: string }
  | { state: 'error'; message: string };

export function StepConnectGitHub({ onNext, onSkip }: Props) {
  const { saveToken } = useSecretsStore();
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'idle' });
  const [showInstructions, setShowInstructions] = useState(false);

  const handleTest = async () => {
    if (!token.trim()) return;
    setConnection({ state: 'testing' });
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (res.ok) {
        const data = await res.json() as { login: string };
        setConnection({ state: 'ok', username: data.login });
      } else {
        const text = await res.text();
        setConnection({ state: 'error', message: `GitHub: ${res.status} — ${text}` });
      }
    } catch (e) {
      setConnection({ state: 'error', message: 'Could not reach GitHub. Check your network.' });
    }
  };

  const handleSave = async () => {
    if (!token.trim()) return;
    setSaving(true);
    try {
      await saveToken(token.trim());
      onNext();
    } catch (e) {
      // saveToken uses plaintext fallback — this should not throw
      console.error('token save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Connect GitHub</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        poietai uses your GitHub account to push branches and open pull requests.
        You'll need a Personal Access Token — a key you generate on GitHub.
      </p>

      <button
        onClick={() => setShowInstructions((v) => !v)}
        className="text-indigo-400 text-xs mb-4 hover:text-indigo-300 flex items-center gap-1"
      >
        {showInstructions ? '▾' : '▸'} How to create a token
      </button>

      {showInstructions && (
        <ol className="text-neutral-400 text-xs space-y-1 mb-4 pl-4 list-decimal leading-relaxed">
          <li>Go to <span className="text-neutral-200">github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</span></li>
          <li>Click <span className="text-neutral-200">Generate new token</span></li>
          <li>Set <span className="text-neutral-200">Resource owner</span> to your account or org</li>
          <li>Under <span className="text-neutral-200">Repository access</span>, select the repos you'll use</li>
          <li>
            Enable these permissions:
            <ul className="pl-4 list-disc mt-1 space-y-0.5">
              <li>Contents — Read and write</li>
              <li>Pull requests — Read and write</li>
              <li>Commit statuses — Read</li>
              <li>Issues — Read</li>
              <li>Workflows — Read</li>
            </ul>
          </li>
          <li>If your repo is in an <span className="text-neutral-200">organisation</span>, set Resource owner to that org — an org owner may need to approve the token</li>
          <li>Copy the token and paste it below</li>
        </ol>
      )}

      <label htmlFor="wizard-gh-token" className="block text-neutral-400 text-xs mb-1">
        Personal Access Token
      </label>
      <div className="flex gap-2 mb-2">
        <input
          id="wizard-gh-token"
          type="password"
          value={token}
          onChange={(e) => { setToken(e.target.value); setConnection({ state: 'idle' }); }}
          placeholder="ghp_... or github_pat_..."
          className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                     text-sm text-white placeholder-neutral-500 focus:outline-none
                     focus:border-indigo-500 font-mono"
          autoFocus
        />
        <button
          onClick={handleTest}
          disabled={!token.trim() || connection.state === 'testing'}
          className="text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50
                     text-white px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          {connection.state === 'testing' ? 'Testing…' : 'Test'}
        </button>
      </div>

      {connection.state === 'ok' && (
        <p className="text-green-400 text-xs mb-3">✓ Connected as @{connection.username}</p>
      )}
      {connection.state === 'error' && (
        <p className="text-red-400 text-xs mb-3">{connection.message}</p>
      )}

      <div className="flex gap-2 justify-between mt-4">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !token.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Create OnboardingWizard.tsx (shell — steps 2 and 3 filled in Tasks 7 and 8)**

```tsx
// apps/desktop/src/components/onboarding/OnboardingWizard.tsx
import { useState } from 'react';
import { StepConnectGitHub } from './StepConnectGitHub';

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);

  const steps = ['Connect GitHub', 'Add project', 'Create agent'];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950">
      <div className="flex flex-col items-center w-full max-w-2xl px-8">
        {/* Logo / brand */}
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center mb-8">
          <span className="text-white text-xl font-bold">P</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 mb-10">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium
                  ${i + 1 < step ? 'bg-indigo-600 text-white' :
                    i + 1 === step ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-neutral-950' :
                    'bg-neutral-800 text-neutral-500'}`}>
                  {i + 1 < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs ${i + 1 === step ? 'text-neutral-200' : 'text-neutral-600'}`}>
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && <div className="w-8 h-px bg-neutral-700" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 1 && (
          <StepConnectGitHub
            onNext={() => setStep(2)}
            onSkip={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <div className="text-neutral-500 text-sm">Step 2 coming in Task 7</div>
        )}
        {step === 3 && (
          <div className="text-neutral-500 text-sm">Step 3 coming in Task 8</div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Wire wizard into AppShell**

Read `apps/desktop/src/components/layout/AppShell.tsx`. Add the onboarding check:

```tsx
// apps/desktop/src/components/layout/AppShell.tsx
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SettingsPanel } from './SettingsPanel';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
import { useSettingsStore } from '../../store/settingsStore';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const { onboardingComplete, loaded, completeOnboarding } = useSettingsStore();

  // Don't render until settings are loaded (avoids flash of wizard on returning users)
  if (!loaded) return null;

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={completeOnboarding} />;
  }

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

Expected: zero errors.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/onboarding/OnboardingWizard.tsx \
        apps/desktop/src/components/onboarding/StepConnectGitHub.tsx \
        apps/desktop/src/components/layout/AppShell.tsx \
        apps/desktop/src/store/settingsStore.ts
git commit -m "feat(react): onboarding wizard shell + Step 1 Connect GitHub"
```

---

### Task 7: `OnboardingWizard` — Step 2: Add project

**Files:**
- Create: `apps/desktop/src/components/onboarding/StepAddProject.tsx`
- Modify: `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`

**Context:** Calls `scan_folder` Tauri command on the selected folder. Renders one of three outcomes: SingleRepo (confirm + name), MultiRepo (multi-select + name), NoRepo (error, re-pick). Calls `addProject` on confirm.

**Step 1: Create StepAddProject.tsx**

```tsx
// apps/desktop/src/components/onboarding/StepAddProject.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore, type Project, type Repo } from '../../store/projectStore';

interface RepoInfo {
  name: string;
  repo_root: string;
  remote_url?: string;
  provider?: string;
}

type ScanResult =
  | { type: 'single_repo'; name: string; repo_root: string; remote_url?: string; provider?: string }
  | { type: 'multi_repo'; repos: RepoInfo[]; suggested_name: string }
  | { type: 'no_repo' };

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export function StepAddProject({ onNext, onSkip }: Props) {
  const { addProject } = useProjectStore();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [projectName, setProjectName] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const handlePick = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Select project folder' });
    if (!selected) return;
    const result = await invoke<ScanResult>('scan_folder', { path: selected as string });
    setScanResult(result);
    if (result.type === 'single_repo') {
      setProjectName(result.name);
      setSelectedRepos(new Set([result.repo_root]));
    } else if (result.type === 'multi_repo') {
      setProjectName(result.suggested_name);
      setSelectedRepos(new Set(result.repos.map((r) => r.repo_root)));
    }
  };

  const toggleRepo = (repoRoot: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoRoot)) next.delete(repoRoot);
      else next.add(repoRoot);
      return next;
    });
  };

  const handleSave = async () => {
    if (!projectName.trim() || selectedRepos.size === 0) return;
    setSaving(true);

    let repos: Repo[] = [];
    if (scanResult?.type === 'single_repo') {
      repos = [{
        id: crypto.randomUUID(),
        name: scanResult.name,
        repoRoot: scanResult.repo_root,
        remoteUrl: scanResult.remote_url,
        provider: (scanResult.provider ?? 'github') as Repo['provider'],
      }];
    } else if (scanResult?.type === 'multi_repo') {
      repos = scanResult.repos
        .filter((r) => selectedRepos.has(r.repo_root))
        .map((r) => ({
          id: crypto.randomUUID(),
          name: r.name,
          repoRoot: r.repo_root,
          remoteUrl: r.remote_url,
          provider: (r.provider ?? 'github') as Repo['provider'],
        }));
    }

    const project: Project = { id: crypto.randomUUID(), name: projectName.trim(), repos };
    await addProject(project);
    setSaving(false);
    onNext();
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Add a project</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        A project is a workspace — it can hold one repo or several (like a separate API and web frontend).
      </p>

      <button
        onClick={handlePick}
        className="w-full bg-neutral-800 border border-neutral-600 border-dashed rounded-lg
                   px-4 py-3 text-sm text-neutral-400 hover:text-neutral-200
                   hover:border-neutral-500 transition-colors text-left mb-4"
      >
        {scanResult ? '↺ Pick a different folder' : '+ Select project folder'}
      </button>

      {scanResult?.type === 'no_repo' && (
        <p className="text-red-400 text-xs mb-4">
          No Git repository found here. Pick a folder that contains a .git directory,
          or a parent folder with Git repos inside it.
        </p>
      )}

      {scanResult && scanResult.type !== 'no_repo' && (
        <>
          {scanResult.type === 'multi_repo' && (
            <div className="mb-4">
              <p className="text-neutral-400 text-xs mb-2">
                Found {scanResult.repos.length} repositories — select which to include:
              </p>
              {scanResult.repos.map((r) => (
                <label key={r.repo_root}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(r.repo_root)}
                    onChange={() => toggleRepo(r.repo_root)}
                    className="accent-indigo-500"
                  />
                  <div>
                    <p className="text-neutral-200 text-sm">{r.name}</p>
                    {r.remote_url && (
                      <p className="text-neutral-500 text-xs truncate">{r.remote_url}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {scanResult.type === 'single_repo' && scanResult.remote_url && (
            <p className="text-neutral-500 text-xs mb-4">{scanResult.remote_url}</p>
          )}

          <label htmlFor="project-name" className="block text-neutral-400 text-xs mb-1">
            Project name
          </label>
          <input
            id="project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                       text-sm text-white focus:outline-none focus:border-indigo-500 mb-4"
          />
        </>
      )}

      <div className="flex gap-2 justify-between mt-2">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !scanResult || scanResult.type === 'no_repo' || selectedRepos.size === 0 || !projectName.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Wire step 2 into OnboardingWizard.tsx**

Read `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`. Replace the `{step === 2}` placeholder:

```tsx
import { StepAddProject } from './StepAddProject';
// ...
{step === 2 && (
  <StepAddProject
    onNext={() => setStep(3)}
    onSkip={() => setStep(3)}
  />
)}
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/onboarding/StepAddProject.tsx \
        apps/desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "feat(react): onboarding Step 2 — smart folder scanner with multi-repo support"
```

---

### Task 8: `OnboardingWizard` — Step 3: Create agent + complete

**Files:**
- Create: `apps/desktop/src/components/onboarding/StepCreateAgent.tsx`
- Modify: `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`

**Context:** Step 3 embeds the agent creation form inline (same fields as `CreateAgentModal` but without the modal chrome). On submit it invokes `create_agent`, refreshes the agent store, calls `onComplete` to finish the wizard and mark onboarding done.

**Step 1: Create StepCreateAgent.tsx**

```tsx
// apps/desktop/src/components/onboarding/StepCreateAgent.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../store/agentStore';

const ROLES = [
  { value: 'fullstack-engineer', label: 'Full-stack engineer', description: 'Works across frontend and backend' },
  { value: 'backend-engineer',   label: 'Backend engineer',   description: 'APIs, databases, services' },
  { value: 'frontend-engineer',  label: 'Frontend engineer',  description: 'UI, components, styling' },
  { value: 'devops',             label: 'DevOps',             description: 'CI/CD, infra, deployment' },
] as const;

const PERSONALITIES = [
  { value: 'pragmatic',   label: 'Pragmatic',   description: 'Gets things done, minimal ceremony' },
  { value: 'meticulous',  label: 'Meticulous',  description: 'Thorough, careful, well-documented' },
  { value: 'creative',    label: 'Creative',    description: 'Novel approaches, thinks outside the box' },
  { value: 'systematic',  label: 'Systematic',  description: 'Structured, consistent, follows patterns' },
] as const;

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function StepCreateAgent({ onComplete, onSkip }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(ROLES[0].value);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0].value);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAgentStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await invoke('create_agent', {
        id: crypto.randomUUID(),
        name: name.trim(),
        role,
        personality,
      });
      await refresh();
      onComplete();
    } catch (e) {
      console.error('failed to create agent:', e);
      setError('Failed to create agent. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg w-full">
      <h2 className="text-neutral-100 text-xl font-semibold mb-2">Create your first agent</h2>
      <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
        Agents are AI workers that read your tickets, write code, and open pull requests.
        Give yours a name, a role, and a personality.
      </p>

      <label htmlFor="agent-name" className="block text-neutral-400 text-xs mb-1">Name</label>
      <input
        id="agent-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !creating && handleCreate()}
        placeholder="e.g. Atlas"
        className="w-full bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                   text-sm text-white placeholder-neutral-500 focus:outline-none
                   focus:border-indigo-500 mb-4"
      />

      <p className="text-neutral-400 text-xs mb-2">Role</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {ROLES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRole(r.value)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              role === r.value
                ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            <p className="font-medium text-xs">{r.label}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{r.description}</p>
          </button>
        ))}
      </div>

      <p className="text-neutral-400 text-xs mb-2">Personality</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {PERSONALITIES.map((p) => (
          <button
            key={p.value}
            onClick={() => setPersonality(p.value)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              personality === p.value
                ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            <p className="font-medium text-xs">{p.label}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{p.description}</p>
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      <div className="flex gap-2 justify-between mt-2">
        <button onClick={onSkip} className="text-sm text-neutral-500 hover:text-neutral-300">
          Skip for now
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg transition-colors"
        >
          {creating ? 'Creating…' : "Let's go →"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Wire step 3 into OnboardingWizard.tsx and connect onComplete**

Read `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`. Replace the step 3 placeholder and connect both skip paths to `onComplete`:

```tsx
import { StepCreateAgent } from './StepCreateAgent';
// ...
{step === 3 && (
  <StepCreateAgent
    onComplete={onComplete}
    onSkip={onComplete}
  />
)}
```

Also connect the skip buttons on steps 1 and 2 — `onSkip` on step 1 should go to step 2 (not complete), `onSkip` on step 2 goes to step 3, `onSkip` on step 3 completes. This is already wired correctly if you kept the `setStep` calls from tasks 6 and 7.

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/onboarding/StepCreateAgent.tsx \
        apps/desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "feat(react): onboarding Step 3 — create first agent, complete wizard"
```

---

### Task 9: Repo picker in `AgentPickerModal`

**Files:**
- Modify: `apps/desktop/src/components/agents/AgentPickerModal.tsx`
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

**Context:** When the active project has more than one repo, `AgentPickerModal` shows a second step after agent selection: "Which repo should this agent work in?". Single-repo projects skip directly to calling `onSelect`. The `onSelect` callback now receives `(agent, repoId)`.

**Step 1: Update AgentPickerModal.tsx**

Read `apps/desktop/src/components/agents/AgentPickerModal.tsx`. Replace entirely with:

```tsx
// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
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
  if (agent.status === 'idle') return 'Available';
  if (agent.status === 'working') return `Busy (will queue)`;
  return agent.status.replace(/_/g, ' ');
}

interface Props {
  onSelect: (agent: Agent, repoId: string) => void;
  onClose: () => void;
}

export function AgentPickerModal({ onSelect, onClose }: Props) {
  const { agents } = useAgentStore();
  const { projects, activeProjectId } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<Agent | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const repos = activeProject?.repos ?? [];
  const isMultiRepo = repos.length > 1;

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  // Step 2: repo picker (only for multi-repo projects)
  if (pendingAgent && isMultiRepo) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-neutral-100 font-semibold text-sm">Which repo?</h2>
            <button onClick={onClose}
              className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
          </div>
          <p className="text-neutral-500 text-xs mb-3">
            Assigning <span className="text-neutral-300">{pendingAgent.name}</span>
          </p>
          {repos.map((repo) => (
            <button
              key={repo.id}
              onClick={() => onSelect(pendingAgent, repo.id)}
              className="w-full flex flex-col items-start px-3 py-2 rounded-lg
                         hover:bg-neutral-800 transition-colors text-left mb-1"
            >
              <p className="text-neutral-200 text-sm">{repo.name}</p>
              {repo.remoteUrl && (
                <p className="text-neutral-500 text-xs truncate">{repo.remoteUrl}</p>
              )}
            </button>
          ))}
          <button
            onClick={() => setPendingAgent(null)}
            className="text-xs text-neutral-500 hover:text-neutral-300 mt-2"
          >
            ← Back to agents
          </button>
        </div>
      </div>
    );
  }

  const idle = agents.filter((a) => a.status === 'idle');
  const busy = agents.filter((a) => a.status !== 'idle');

  const handleAgentClick = (agent: Agent) => {
    if (isMultiRepo) {
      setPendingAgent(agent);
    } else {
      // Single repo — use it directly
      const repoId = repos[0]?.id ?? '';
      onSelect(agent, repoId);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-neutral-100 font-semibold text-sm">Assign agent</h2>
          <button onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
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
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-neutral-600 text-xs mb-1 uppercase tracking-wide">Busy (will queue)</p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
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

function AgentRow({ agent, onSelect }: { agent: Agent; onSelect: (a: Agent) => void }) {
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

**Step 2: Update TicketCard.tsx**

Read `apps/desktop/src/components/board/TicketCard.tsx`. The `handleAgentSelected` signature changes from `(agent: Agent)` to `(agent: Agent, repoId: string)`.

Update the handler and the `assignTicket` call:

```tsx
const handleAgentSelected = async (agent: Agent, repoId: string) => {
  setShowPicker(false);
  const project = useProjectStore.getState().projects.find(
    (p) => p.id === useProjectStore.getState().activeProjectId
  );
  if (!project) return;

  const repo = project.repos.find((r) => r.id === repoId) ?? project.repos[0];
  if (!repo) return;

  const systemPrompt = buildPrompt({ ... }); // unchanged

  const ghToken = useSecretsStore.getState().ghToken ?? '';

  try {
    await invoke<void>('start_agent', {
      payload: {
        agent_id: agent.id,
        ticket_id: ticket.id,
        ticket_slug: ticket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
        prompt: `${ticket.title}\n\n${ticket.description}`,
        system_prompt: systemPrompt,
        repo_root: repo.repoRoot,   // ← real repo root from selected repo
        gh_token: ghToken,
        resume_session_id: null,
      },
    });
    assignTicket(ticket.id, { agentId: agent.id, repoId });
    updateTicketStatus(ticket.id, 'in_progress');
    setActiveTicket(ticket.id);
    onOpenCanvas(ticket.id);
  } catch (err) {
    console.error('failed to start agent:', err);
  }
};
```

Also update the `AgentPickerModal` usage to pass the new two-arg callback:
```tsx
<AgentPickerModal
  onSelect={handleAgentSelected}
  onClose={() => setShowPicker(false)}
/>
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add apps/desktop/src/components/agents/AgentPickerModal.tsx \
        apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(react): repo picker in AgentPickerModal, repoId wired into start_agent"
```

---

### Task 10: Expand `SettingsPanel`

**Files:**
- Modify: `apps/desktop/src/components/layout/SettingsPanel.tsx`

**Context:** Add a "GitHub" section with token status badge (Connected/Not connected), the collapsible PAT instructions from the wizard, a test-connection button, and a Stronghold-fallback warning when `usingFallback` is true.

**Step 1: Update SettingsPanel.tsx**

Read `apps/desktop/src/components/layout/SettingsPanel.tsx`. Replace entirely with:

```tsx
// apps/desktop/src/components/layout/SettingsPanel.tsx
import { useState, useEffect } from 'react';
import { useSecretsStore } from '../../store/secretsStore';

interface Props {
  onClose: () => void;
}

type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; username: string }
  | { state: 'error'; message: string };

export function SettingsPanel({ onClose }: Props) {
  const { ghToken, saveToken, usingFallback } = useSecretsStore();
  const [draft, setDraft] = useState(() => ghToken ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({ state: 'idle' });

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  const handleTest = async () => {
    if (!draft.trim()) return;
    setConnection({ state: 'testing' });
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${draft.trim()}` },
      });
      if (res.ok) {
        const data = await res.json() as { login: string };
        setConnection({ state: 'ok', username: data.login });
      } else {
        const text = await res.text();
        setConnection({ state: 'error', message: `${res.status} — ${text}` });
      }
    } catch {
      setConnection({ state: 'error', message: 'Could not reach GitHub. Check your network.' });
    }
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await saveToken(draft.trim());
      setSaved(true);
    } catch (e) {
      console.error('failed to save GH token:', e);
      setError('Failed to save token. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    >
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-[480px] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 id="settings-title" className="text-neutral-100 font-semibold">Settings</h2>
          <button onClick={onClose} aria-label="Close settings"
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none">×</button>
        </div>

        {/* Stronghold fallback warning */}
        {usingFallback && (
          <div className="bg-amber-950 border border-amber-700 rounded-lg px-3 py-2 mb-4">
            <p className="text-amber-300 text-xs">
              Token stored without encryption — secure storage unavailable on this system.
              Install <span className="font-mono">gnome-keyring</span> for encrypted storage.
            </p>
          </div>
        )}

        {/* GitHub section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-neutral-300 text-sm font-medium">GitHub</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              ghToken ? 'bg-green-950 text-green-400' : 'bg-neutral-800 text-neutral-500'
            }`}>
              {ghToken ? '✓ Connected' : 'Not connected'}
            </span>
          </div>

          <button
            onClick={() => setShowInstructions((v) => !v)}
            className="text-indigo-400 text-xs mb-3 hover:text-indigo-300 flex items-center gap-1"
          >
            {showInstructions ? '▾' : '▸'} How to create a Personal Access Token
          </button>

          {showInstructions && (
            <ol className="text-neutral-400 text-xs space-y-1 mb-3 pl-4 list-decimal leading-relaxed">
              <li>Go to <span className="text-neutral-200">github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</span></li>
              <li>Click <span className="text-neutral-200">Generate new token</span></li>
              <li>Set Resource owner to your account or org</li>
              <li>Select the repositories you'll use</li>
              <li>
                Enable: Contents (R/W), Pull requests (R/W), Commit statuses (R),
                Issues (R), Workflows (R)
              </li>
              <li>
                <span className="text-neutral-200">Org repos:</span> set Resource owner to the org —
                an org owner may need to approve the token
              </li>
            </ol>
          )}

          <label htmlFor="gh-token" className="block text-neutral-400 text-xs mb-1">
            Personal Access Token
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="gh-token"
              type="password"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setConnection({ state: 'idle' }); }}
              placeholder="ghp_... or github_pat_..."
              className="flex-1 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2
                         text-sm text-white placeholder-neutral-500 focus:outline-none
                         focus:border-indigo-500 font-mono"
            />
            <button
              onClick={handleTest}
              disabled={!draft.trim() || connection.state === 'testing'}
              className="text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50
                         text-white px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              {connection.state === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>

          {connection.state === 'ok' && (
            <p className="text-green-400 text-xs mb-2">✓ Connected as @{connection.username}</p>
          )}
          {connection.state === 'error' && (
            <p className="text-red-400 text-xs mb-2">{connection.message}</p>
          )}

          {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end border-t border-neutral-800 pt-4">
          <button onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-200 px-3 py-1.5">
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

**Step 2: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/SettingsPanel.tsx
git commit -m "feat(react): expand Settings panel with token status, instructions, test connection"
```

---

### Task 11: Contextual nudges

**Files:**
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`
- Modify: `apps/desktop/src/components/layout/ProjectSwitcher.tsx`

**Context:** Two nudges: (1) if no GH token saved, disable "Assign agent" with tooltip "Add a GitHub token in Settings first". (2) In `ProjectSwitcher`, if no projects exist after loading, pulse the "+" button with a tooltip "Add your first project".

**Step 1: Update TicketCard.tsx — token nudge**

Read `apps/desktop/src/components/board/TicketCard.tsx`. Add `useSecretsStore` to get `ghToken` (already imported). Update the "Assign agent" button to disable when no token:

```tsx
const { ghToken } = useSecretsStore();

// In JSX — update the disabled condition and title:
<button
  onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
  disabled={!activeProject || !ghToken}
  title={
    !activeProject ? 'Select a project first' :
    !ghToken ? 'Add a GitHub token in Settings first' :
    'Assign an agent'
  }
  className="text-xs text-indigo-400 hover:text-indigo-300 opacity-0
             group-hover:opacity-100 transition-opacity
             disabled:opacity-30 disabled:cursor-not-allowed"
>
  + Assign agent
</button>
```

Note: `useSecretsStore` is already imported — just destructure `ghToken` from it.

**Step 2: Update ProjectSwitcher.tsx — pulse nudge**

Read `apps/desktop/src/components/layout/ProjectSwitcher.tsx`. Add `animate-pulse` to the "+" button when `loaded && projects.length === 0`:

```tsx
<button
  onClick={handleAdd}
  title={projects.length === 0 ? 'Add your first project' : 'Add project'}
  className={`w-9 h-9 rounded-xl bg-neutral-800 text-neutral-400
              hover:bg-neutral-700 hover:text-neutral-200 text-xl
              flex items-center justify-center transition-colors
              ${loaded && projects.length === 0 ? 'animate-pulse ring-2 ring-indigo-500 ring-offset-1 ring-offset-neutral-950' : ''}`}
>
  +
</button>
```

**Step 3: Verify types**

```bash
cd apps/desktop && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Run all Rust tests to confirm nothing regressed**

```bash
cd apps/desktop/src-tauri && cargo test 2>&1 | grep "test result"
```

Expected: `test result: ok. 35 passed`

**Step 5: Commit and push**

```bash
git add apps/desktop/src/components/board/TicketCard.tsx \
        apps/desktop/src/components/layout/ProjectSwitcher.tsx
git commit -m "feat(react): contextual nudges for missing token and no projects"
git push origin main
```
