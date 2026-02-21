# Onboarding, Workspace & Provider Architecture Design

**Goal:** Guide non-developer users from a blank app to their first agent-assigned ticket through a welcome wizard, while establishing a flexible project-as-workspace data model that supports multiple repos per project and multiple Git providers.

**Architecture:** Five coordinated changes — welcome wizard, smart folder scanner (Rust), project-as-workspace data model, repo picker in agent assignment, and expanded Settings panel with provider-keyed token storage and Stronghold fallback. All are additive; the parking-lot items (auto-assignment, multi-agent collaboration) are explicitly deferred.

**Tech Stack:** Tauri 2, React 19, Zustand, TypeScript, `tauri-plugin-stronghold` (token vault), `tauri-plugin-fs` (Stronghold fallback config file), `tauri-plugin-dialog` (folder picker).

---

## Parking Lot (deferred — separate design sessions)

- **Auto-assignment** — idle agents poll for and claim backlog tickets automatically
- **Multi-agent collaboration** — multiple agents working the same ticket (same or different repos), agent-to-agent handoff and coordination
- **Additional providers** — GitLab, Bitbucket, Azure DevOps auth flows (data model supports them today; UI is GitHub-only)

---

## 1. Welcome Wizard

### Trigger

Shown **once** — when the app has no saved projects and no saved token. After the wizard completes (or is dismissed), it never appears again. A flag `onboardingComplete: boolean` is stored via `tauri-plugin-store` in `app_config_dir()/settings.json`.

### Layout

Replaces the main content area (not a modal overlay) so it feels like a landing page. The sidebar and project switcher are hidden during the wizard. A progress indicator shows the current step (1 of 3).

### Step 1 — Connect GitHub

**Header:** "Connect your GitHub account"

**Body (plain language, no jargon):**
> poietai uses your GitHub account to read repositories, push branches, and open pull requests on your behalf. You'll need a Personal Access Token — a password-like key you generate on GitHub.

**Instructions (numbered, inline):**
1. Go to **github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **"Generate new token"**
3. Set **Resource owner** to your account (or your org — see note below)
4. Set **Repository access** to the specific repos you'll use
5. Under **Permissions**, enable:
   - `Contents` — Read and write
   - `Pull requests` — Read and write
   - `Commit statuses` — Read
   - `Issues` — Read
   - `Workflows` — Read
6. Copy the token and paste it below

**Org note (collapsible):**
> If your repo belongs to an organisation, set the Resource owner to that org. The org owner may need to approve the token — check GitHub Settings → Personal access tokens inside the org.

**Token input:** masked field (`type="password"`) with a **"Test connection"** button. On success: green checkmark + "Connected as @username". On failure: red error with the specific message from the GitHub API.

**Fallback banner (shown if Stronghold save fails):**
> Your token couldn't be stored securely (this is common on Linux without a keychain daemon). It's been saved to a local config file instead. [Learn more]

**Navigation:** "Skip for now" (dismisses wizard, shows contextual nudge later) | "Next →"

---

### Step 2 — Add your first project

**Header:** "Add a project"

**Body:**
> A project is a workspace — it can contain one repository or several (for example, a separate API and web frontend).

**Folder picker button** → opens native dialog → triggers `scan_folder` Rust command.

**Three outcomes from the scan:**

**A — Single valid repo**
```
✓ Found: roof-report-pro-api
  github.com/rrp/roof-report-pro-api

Project name: [roof-report-pro-api    ]
              └ editable, defaults to folder name
```

**B — Parent folder with multiple git repos (one level deep)**
```
We found 2 repositories in this folder.
Select which to include in this project:

☑ roof-report-pro-api    github.com/rrp/roof-report-pro-api
☑ roof-report-pro-web    github.com/rrp/roof-report-pro-web

Project name: [Roof Report Pro    ]
              └ defaults to parent folder name
```
User can select one or both. Each selected repo becomes a `Repo` entry on the project.

**C — No git repo found**
```
⚠ No Git repository found here.
  Pick a folder that contains a .git directory,
  or a parent folder with Git repos inside it.
```
Folder picker re-enabled. No next button until a valid folder is selected.

**Navigation:** "← Back" | "Next →"

---

### Step 3 — Create your first agent

**Header:** "Create your first agent"

**Body:**
> Agents are AI workers. Give yours a name, a role, and a personality — these shape how it thinks and writes code.

Same form as `CreateAgentModal` (name, role dropdown, personality dropdown) but embedded in the wizard layout with more breathing room and a brief description of each role and personality option.

**Navigation:** "← Back" | "Let's go →" (completes wizard, sets `onboardingComplete: true`, shows main app)

---

## 2. Smart Folder Scanner (Rust)

A new Tauri command `scan_folder(path: String) -> Result<FolderScanResult, String>`.

```rust
pub enum FolderScanResult {
    SingleRepo {
        name: String,
        repo_root: String,
        remote_url: Option<String>,
        provider: Option<String>, // "github" | "gitlab" | "bitbucket" | null
    },
    MultiRepo {
        repos: Vec<RepoInfo>,
        suggested_name: String, // parent folder name
    },
    NoRepo,
}

pub struct RepoInfo {
    name: String,       // subdirectory name
    repo_root: String,  // absolute path
    remote_url: Option<String>,
    provider: Option<String>,
}
```

**Implementation:**
1. Check if `path/.git` exists → `SingleRepo` (run `git remote get-url origin` for remote)
2. Else scan immediate subdirectories (one level only) for `.git` → `MultiRepo` if any found
3. Else → `NoRepo`

**Provider detection** from remote URL:
- `github.com` → `"github"`
- `gitlab.com` → `"gitlab"`
- `bitbucket.org` → `"bitbucket"`
- `dev.azure.com` or `visualstudio.com` → `"azure"`
- unrecognised or missing → `null` (frontend defaults to `"github"` with a note)

---

## 3. Project-as-Workspace Data Model

### Updated TypeScript types

```typescript
export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure';

export interface Repo {
  id: string;         // uuid
  name: string;       // display name, e.g. "api" or "web"
  repoRoot: string;   // absolute path
  remoteUrl?: string;
  provider: GitProvider;
}

export interface Project {
  id: string;
  name: string;
  repos: Repo[];      // one or more — replaces the old single repoRoot
}
```

`projectStore` is updated to persist `repos[]` instead of `repoRoot`. The `ProjectSwitcher` UI is unchanged — it still shows one avatar per project.

### Migration

Existing projects saved as `{ repoRoot: string }` are migrated on `loadFromDisk`: if a project has `repoRoot` but no `repos`, wrap it into `repos: [{ id: uuid, name: basename(repoRoot), repoRoot, provider: 'github' }]`.

---

## 4. Repo Picker in Agent Assignment

`AgentPickerModal` gains a second step shown only when the active project has **more than one repo**.

**Step 1 — Pick agent** (existing UI, unchanged)

**Step 2 — Pick repo** (new, only shown for multi-repo projects)
```
Which repo should this agent work in?

  roof-report-pro-api    github.com/rrp/api
  roof-report-pro-web    github.com/rrp/web
```

Single-repo projects skip step 2 entirely — no extra friction.

### Ticket assignment model

`Ticket.assignedAgentId: string` → `Ticket.assignments: Assignment[]`

```typescript
interface Assignment {
  agentId: string;
  repoId: string;
}
```

`start_agent` receives `repo_root` from the selected `Repo`, not from the project directly.

---

## 5. Settings Panel — Expanded

The Settings panel gains a **GitHub section** with full token guidance (same content as wizard Step 1, condensed). Token status is shown prominently:

- ✓ **Connected** — green badge (no username lookup needed; presence of a non-empty saved token is sufficient)
- ✗ **Not connected** — amber badge with "Add token →" link

**Provider-keyed token storage in Stronghold:**

Keys change from `gh_token` → `token:github`, `token:gitlab`, etc.

`secretsStore` API:
```typescript
getToken(provider: GitProvider): string | null
saveToken(provider: GitProvider, token: string): Promise<void>
```

**Stronghold fallback:**

If `saveToken` throws (Stronghold unavailable — common on WSL2/Linux without a keychain daemon):
1. Save token to `app_config_dir()/tokens.json` (plain JSON, not encrypted)
2. Show persistent warning banner in Settings: *"Token stored without encryption — install gnome-keyring for secure storage."*
3. `loadToken` checks Stronghold first; falls back to `tokens.json` if Stronghold is unavailable

---

## 6. Contextual Nudges

For users who skip the wizard, empty states guide setup inline:

| State | Location | Nudge |
|-------|----------|-------|
| No token | Board — "Assign agent" button | Disabled + tooltip "Add a GitHub token in Settings first" |
| No token | Settings panel | Amber "Not connected" badge |
| No projects | Project switcher | "+" button pulses; tooltip "Add your first project" |
| No agents | AgentPickerModal | Empty state: "No agents yet — create one below" (already exists) |

---

## Error Handling

- **Folder has no git**: `NoRepo` result → inline error, re-enable picker
- **Git remote missing**: `SingleRepo` with `remote_url: null` → show "No remote detected — provider defaulted to GitHub"
- **Token test fails**: show GitHub API error message verbatim (e.g. "Bad credentials", "Token requires approval from org owner")
- **Stronghold save fails**: fall back to `tokens.json` + warning banner
- **Wizard skipped**: contextual nudges cover the remaining gaps

---

## Out of Scope

- GitLab / Bitbucket / Azure auth flows (data model ready; UI deferred)
- Auto-assignment of idle agents to backlog tickets
- Multi-agent collaboration / coordination on a single ticket
- Per-agent git identity (already in place via `start_agent` env vars)
- Ticket splitting (FE + BE sub-tickets)
