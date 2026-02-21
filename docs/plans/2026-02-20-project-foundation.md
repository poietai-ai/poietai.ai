# Project Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the poietai.ai monorepo with git, pnpm workspaces, a scaffolded Tauri 2 desktop app (React + TypeScript + Vite + Tailwind), and push to the poietai-ai GitHub org.

**Architecture:** pnpm workspaces monorepo with `apps/desktop` (Tauri 2) as the primary application. The Tauri Rust backend handles native OS concerns; the React frontend runs in a WebView. `packages/shared` holds TypeScript types shared across any future apps.

**Tech Stack:** Tauri 2, React 18, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, Zustand, pnpm workspaces, Rust (Cargo)

---

## Pre-Flight Checklist

Before starting, verify these manually:

1. **Create GitHub org** — Go to https://github.com/organizations/plan and create `poietai-ai`. (Can't be done via CLI.) This only needs to happen once.
2. **Verify WebView2 / WebKitGTK** — On WSL2 you'll run `cargo tauri dev` which opens a window via the Windows-side WebView2. Confirm you have a display available or plan to test via `cargo build` only.

---

## Task 1: Git Init + Monorepo Root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.npmrc`

**Step 1: Initialize git**

```bash
cd /home/keenan/github/poietai.ai
git init
git branch -M main
```

Expected: `Initialized empty Git repository in .../poietai.ai/.git/`

**Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Step 3: Create root `package.json`**

```json
{
  "name": "poietai",
  "private": true,
  "version": "0.0.1",
  "description": "A software team at your fingertips.",
  "scripts": {
    "desktop": "pnpm --filter @poietai/desktop tauri dev",
    "desktop:build": "pnpm --filter @poietai/desktop tauri build",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "engines": {
    "node": ">=22",
    "pnpm": ">=10"
  }
}
```

**Step 4: Create `.npmrc`**

```
auto-install-peers=true
shamefully-hoist=false
```

**Step 5: Create `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
target/

# Tauri
apps/desktop/src-tauri/target/

# Env
.env
.env.local
.env.*.local

# Editor
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
```

**Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .npmrc
git commit -m "chore: initialize monorepo root"
```

---

## Task 2: Create Shared Types Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types/agent.ts`
- Create: `packages/shared/src/types/room.ts`
- Create: `packages/shared/src/types/ticket.ts`

**Step 1: Create package scaffold**

```bash
mkdir -p packages/shared/src/types
```

**Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "@poietai/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**Step 4: Create `packages/shared/src/types/agent.ts`**

These are the core domain types — keep them close to the vision doc.

```typescript
export type AgentRole =
  | 'product-manager'
  | 'frontend-engineer'
  | 'backend-engineer'
  | 'fullstack-engineer'
  | 'staff-engineer'
  | 'designer'
  | 'qa'
  | 'devops'
  | 'technical-writer'
  | 'security'
  | 'custom';

export type AgentPersonality =
  | 'pragmatic'
  | 'perfectionist'
  | 'ambitious'
  | 'conservative'
  | 'devils-advocate';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'reviewing' | 'waiting';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  personality: AgentPersonality;
  status: AgentStatus;
  avatar?: string;
  systemPrompt?: string;
  createdAt: string;
}
```

**Step 5: Create `packages/shared/src/types/room.ts`**

```typescript
export type RoomType = 'brainstorm' | 'design-review' | 'standup' | 'war-room';

export type RoomStatus = 'active' | 'archived';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  status: RoomStatus;
  agentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  authorId: string; // agent id or 'user'
  content: string;
  createdAt: string;
}
```

**Step 6: Create `packages/shared/src/types/ticket.ts`**

```typescript
export type TicketStatus =
  | 'backlog'
  | 'refined'
  | 'assigned'
  | 'in-progress'
  | 'in-review'
  | 'approved'
  | 'shipped';

export type TicketComplexity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: TicketComplexity;
  status: TicketStatus;
  assigneeId?: string; // agent id
  roomId?: string;     // originating room
  createdAt: string;
  updatedAt: string;
}
```

**Step 7: Create `packages/shared/src/index.ts`**

```typescript
export * from './types/agent';
export * from './types/room';
export * from './types/ticket';
```

**Step 8: Commit**

```bash
git add packages/
git commit -m "feat: add @poietai/shared domain types"
```

---

## Task 3: Install Tauri CLI

**Step 1: Install tauri-cli via cargo**

```bash
cargo install tauri-cli --version "^2"
```

Expected: Takes 2-5 minutes. Ends with `Installed package 'tauri-cli v2.x.x'`.

**Step 2: Verify**

```bash
cargo tauri --version
```

Expected: `tauri-cli 2.x.x`

---

## Task 4: Scaffold Desktop App

**Step 1: Create apps directory and scaffold**

```bash
mkdir -p apps
cd apps
cargo tauri init
```

When prompted:
- App name: `Nexus`
- Window title: `Nexus`
- Web assets relative path: `../dist`
- Dev server URL: `http://localhost:5173`
- Frontend dev command: `pnpm dev`
- Frontend build command: `pnpm build`

This creates `apps/desktop/` with the Rust src-tauri backend.

Wait — `cargo tauri init` scaffolds into the current directory. Run it inside `apps/desktop` instead:

```bash
mkdir -p /home/keenan/github/poietai.ai/apps/desktop
cd /home/keenan/github/poietai.ai/apps/desktop
cargo tauri init
```

**Step 2: Scaffold the Vite React TypeScript frontend**

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm create vite . --template react-ts
```

When asked about overwriting, choose to merge/overwrite (the Tauri init and Vite scaffold coexist cleanly).

**Step 3: Update `apps/desktop/package.json` name**

Edit the name field:

```json
{
  "name": "@poietai/desktop",
  "private": true,
  ...
}
```

**Step 4: Add `@poietai/shared` as dependency**

In `apps/desktop/package.json`, add:

```json
{
  "dependencies": {
    "@poietai/shared": "workspace:*",
    ...
  }
}
```

**Step 5: Install dependencies from root**

```bash
cd /home/keenan/github/poietai.ai
pnpm install
```

**Step 6: Commit**

```bash
git add apps/
git commit -m "feat: scaffold Tauri 2 desktop app with Vite React TypeScript"
```

---

## Task 5: Add Tailwind CSS 4

Tailwind 4 uses a CSS-first config (no `tailwind.config.js`).

**Step 1: Install Tailwind and Vite plugin**

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm add -D tailwindcss @tailwindcss/vite
```

**Step 2: Update `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
});
```

**Step 3: Replace `src/index.css` content**

```css
@import "tailwindcss";
```

**Step 4: Verify Tailwind is working**

In `src/App.tsx`, add a Tailwind class temporarily:

```tsx
<h1 className="text-3xl font-bold text-blue-500">Nexus</h1>
```

Run `pnpm dev` from `apps/desktop` and confirm the styled heading appears.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add Tailwind CSS 4 to desktop app"
```

---

## Task 6: App Layout Skeleton

This task builds the core chrome — the persistent sidebar + main area that all features will live inside.

**Files:**
- Create: `apps/desktop/src/components/layout/AppShell.tsx`
- Create: `apps/desktop/src/components/layout/Sidebar.tsx`
- Create: `apps/desktop/src/components/layout/MainArea.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Install Zustand for state management**

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm add zustand
```

**Step 2: Create `src/components/layout/Sidebar.tsx`**

```tsx
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
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
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
    </aside>
  );
}
```

**Step 3: Create `src/components/layout/MainArea.tsx`**

```tsx
interface MainAreaProps {
  activeView: string;
}

const viewLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  rooms: 'Rooms',
  board: 'Board',
  graph: 'Graph',
  messages: 'Messages',
};

export function MainArea({ activeView }: MainAreaProps) {
  return (
    <main className="flex-1 flex flex-col bg-neutral-900 overflow-hidden">
      <header className="px-6 py-4 border-b border-neutral-800">
        <h1 className="text-neutral-100 text-lg font-semibold">
          {viewLabels[activeView] ?? activeView}
        </h1>
      </header>
      <div className="flex-1 flex items-center justify-center text-neutral-600">
        <p>{viewLabels[activeView]} — coming soon</p>
      </div>
    </main>
  );
}
```

**Step 4: Create `src/components/layout/AppShell.tsx`**

```tsx
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MainArea } from './MainArea';

export function AppShell() {
  const [activeView, setActiveView] = useState('dashboard');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <MainArea activeView={activeView} />
    </div>
  );
}
```

**Step 5: Replace `src/App.tsx`**

```tsx
import { AppShell } from './components/layout/AppShell';
import './index.css';

export default function App() {
  return <AppShell />;
}
```

**Step 6: Run and verify**

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm dev
```

Expected: Dark-themed sidebar with N logo on left, main area filling the rest, each nav item clickable and updating the main area title.

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add app shell layout with sidebar navigation"
```

---

## Task 7: Create GitHub Repo and Push

**Pre-condition:** The `poietai-ai` GitHub org must already exist (created in browser — see Pre-Flight).

**Step 1: Create the repository under the org**

```bash
cd /home/keenan/github/poietai.ai
gh repo create poietai-ai/poietai.ai --public --description "A software team at your fingertips." --source . --remote origin
```

**Step 2: Push**

```bash
git push -u origin main
```

**Step 3: Verify**

```bash
gh repo view poietai-ai/poietai.ai
```

Expected: Shows repo description, default branch `main`, recent commits.

---

## Done

At this point you have:
- ✓ pnpm monorepo with `apps/desktop` and `packages/shared`
- ✓ Tauri 2 desktop app scaffolded with React + TypeScript + Vite
- ✓ Tailwind CSS 4 configured
- ✓ Dark-mode app shell with sidebar navigation
- ✓ Core domain types (Agent, Room, Ticket) in shared package
- ✓ Pushed to `github.com/poietai-ai/poietai.ai`

**Next plans (in order of priority):**
1. `2026-02-20-agent-system.md` — Agent store (Zustand), agent cards UI, create/edit agent modal
2. `2026-02-20-rooms.md` — Room list, room creation, message threads
3. `2026-02-20-ticket-board.md` — Kanban board with drag-and-drop, ticket creation
