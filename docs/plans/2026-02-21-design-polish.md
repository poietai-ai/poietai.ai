# Design Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the app's visual identity — swap neutral→zinc, indigo→violet, replace emoji with Lucide icons, and flip the canvas to light mode.

**Architecture:** Surgical class swaps only (Approach A). No new components, no CSS variable migration. Touch 15 files: `index.css`, 2 layout components, `TicketCanvas`, 3 canvas nodes, 4 shell components, 3 panel components, and `DmList`.

**Tech Stack:** React 19 + Tailwind CSS 4 + Lucide React (already installed via shadcn)

---

## Task 1: index.css — antialiased + violet primary

**Files:**
- Modify: `apps/desktop/src/index.css`

**Step 1: Add `antialiased` to body**

In the `@layer base` block, change:
```css
  body {
    @apply bg-background text-foreground;
    }
```
to:
```css
  body {
    @apply bg-background text-foreground antialiased;
    }
```

**Step 2: Update dark mode `--primary` and `--ring` to violet**

In the `.dark` block, change:
```css
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
```
to:
```css
    --primary: oklch(0.558 0.218 293);
    --primary-foreground: oklch(0.985 0 0);
```

And change:
```css
    --ring: oklch(0.556 0 0);
```
to:
```css
    --ring: oklch(0.606 0.25 292);
```

Also update `--sidebar-primary` in the `.dark` block:
```css
    --sidebar-primary: oklch(0.488 0.243 264.376);
```
to:
```css
    --sidebar-primary: oklch(0.558 0.218 293);
```

**Step 3: Verify build passes**

Run: `pnpm --filter @poietai/desktop build`
Expected: `✓ built in ~2s` with no errors

**Step 4: Commit**

```bash
git add apps/desktop/src/index.css
git commit -m "style: add antialiased body, update shadcn primary/ring to violet"
```

---

## Task 2: Sidebar.tsx — Lucide icons + zinc/violet

**Files:**
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx`

**Step 1: Replace entire file**

```tsx
import {
  LayoutDashboard, Hash, Columns3, GitBranch, Inbox, Settings2,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', Icon: LayoutDashboard, id: 'dashboard' },
  { label: 'Rooms',     Icon: Hash,            id: 'rooms'     },
  { label: 'Board',     Icon: Columns3,        id: 'board'     },
  { label: 'Graph',     Icon: GitBranch,       id: 'graph'     },
  { label: 'Messages',  Icon: Inbox,           id: 'messages'  },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSettings: () => void;
}

export function Sidebar({ activeView, onNavigate, onSettings }: SidebarProps) {
  return (
    <aside className="w-16 flex flex-col items-center py-4 gap-2 bg-zinc-950 border-r border-zinc-800">
      <div className="mb-4 w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
        <span className="text-white text-xs font-bold">P</span>
      </div>
      {navItems.map(({ label, Icon, id }) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
            activeView === id
              ? 'bg-violet-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
          title={label}
        >
          <Icon size={18} strokeWidth={1.5} />
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSettings}
        title="Settings"
        className="w-10 h-10 rounded-lg flex items-center justify-center
                   text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <Settings2 size={18} strokeWidth={1.5} />
      </button>
    </aside>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/layout/Sidebar.tsx
git commit -m "style: Sidebar — Lucide icons, zinc palette, violet accent"
```

---

## Task 3: ProjectSwitcher.tsx — zinc/violet

**Files:**
- Modify: `apps/desktop/src/components/layout/ProjectSwitcher.tsx`

**Step 1: Apply class swaps**

| Find | Replace |
|---|---|
| `bg-neutral-950` | `bg-zinc-950` |
| `border-neutral-800` | `border-zinc-800` |
| `bg-indigo-600` | `bg-violet-600` |
| `ring-indigo-400` | `ring-violet-400` |
| `ring-offset-neutral-950` | `ring-offset-zinc-950` |
| `bg-neutral-700` | `bg-zinc-700` |
| `text-neutral-300` | `text-zinc-300` |
| `hover:bg-neutral-600` | `hover:bg-zinc-600` |
| `bg-neutral-800` | `bg-zinc-800` |
| `text-neutral-400` | `text-zinc-400` |
| `hover:bg-neutral-700` | `hover:bg-zinc-700` |
| `hover:text-neutral-200` | `hover:text-zinc-200` |
| `ring-indigo-500` | `ring-violet-500` |
| `ring-offset-neutral-950` | `ring-offset-zinc-950` |

**Step 2: Commit**

```bash
git add apps/desktop/src/components/layout/ProjectSwitcher.tsx
git commit -m "style: ProjectSwitcher — zinc palette, violet accent"
```

---

## Task 4: TicketCanvas.tsx — light canvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Flip canvas to light mode**

Change:
```tsx
    <div className="relative w-full h-full bg-neutral-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#333"
        />
```

to:
```tsx
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
```

(`#d4d4d8` = zinc-300, a subtle dot color on the white canvas)

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "style: TicketCanvas — light zinc-50 canvas with zinc-300 dot grid"
```

---

## Task 5: ThoughtNode.tsx — white card + violet accent

**Files:**
- Modify: `apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx`

**Step 1: Replace entire file**

```tsx
import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

function BouncingDots() {
  return (
    <span className="inline-flex gap-0.5 items-end ml-0.5">
      <span className="inline-block animate-bounce [animation-delay:0ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:150ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:300ms]">.</span>
    </span>
  );
}

export function ThoughtNode({ data }: NodeProps<CanvasNode>) {
  const isThinking = data.nodeType === 'thought';
  const [revealed, setRevealed] = useState(!isThinking);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(timer);
  }, [isThinking]);

  const content = data.content as string;
  const isLong = content.length > 160;

  return (
    <div className="bg-white border border-zinc-200 border-l-4 border-l-violet-500
                    rounded-lg p-3 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-violet-400" />
      <div className="flex items-start gap-2">
        <Sparkles size={14} strokeWidth={1.5} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {!revealed ? (
            <p className="text-zinc-400 text-xs italic">
              Thinking<BouncingDots />
            </p>
          ) : (
            <>
              <p className={`text-zinc-700 text-xs leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
                {content}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-0.5 text-violet-500 hover:text-violet-600 text-xs mt-1"
                >
                  {expanded
                    ? <><ChevronUp size={12} /> show less</>
                    : <><ChevronDown size={12} /> show more</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-400" />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx
git commit -m "style: ThoughtNode — white card, violet left bar, Sparkles icon"
```

---

## Task 6: FileNode.tsx — white cards + colored left bars + Lucide icons

**Files:**
- Modify: `apps/desktop/src/components/canvas/nodes/FileNode.tsx`

**Step 1: Replace entire file**

```tsx
import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText, FilePen, FilePlus2, ChevronDown, ChevronUp } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

const NODE_STYLES = {
  file_read:  { Icon: FileText,  bar: 'border-l-blue-500',    iconCls: 'text-blue-600',    verb: 'Read'   },
  file_edit:  { Icon: FilePen,   bar: 'border-l-green-500',   iconCls: 'text-green-600',   verb: 'Edited' },
  file_write: { Icon: FilePlus2, bar: 'border-l-emerald-500', iconCls: 'text-emerald-600', verb: 'Wrote'  },
} as const;

/** Show the last 2 path segments: `/home/.../src/cart.ts` → `src/cart.ts`. */
function shortPath(p: string) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

export function FileNode({ data }: NodeProps<CanvasNode>) {
  const [expanded, setExpanded] = useState(false);
  const style = NODE_STYLES[data.nodeType as keyof typeof NODE_STYLES] ?? NODE_STYLES.file_read;
  const items = (data.items as string[] | undefined) ?? (data.filePath ? [data.filePath] : []);
  const count = items.length;
  const { Icon } = style;

  return (
    <div className={`bg-white border border-zinc-200 border-l-4 ${style.bar}
                     rounded-lg p-3 min-w-48 max-w-xs shadow-sm`}>
      <Handle type="target" position={Position.Top} />

      <button
        type="button"
        onClick={() => count > 1 && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Icon size={14} strokeWidth={1.5} className={`${style.iconCls} flex-shrink-0`} />
        <span className="text-zinc-700 text-xs font-mono flex-1 truncate">
          {count > 1
            ? `${style.verb} ${count} files`
            : shortPath(items[0] ?? 'unknown')
          }
        </span>
        {count > 1 && (
          <span className="text-zinc-400 flex-shrink-0">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-zinc-100 pt-2">
          {items.map((item, i) => (
            <li key={i} className="text-zinc-500 text-xs font-mono truncate">
              {shortPath(item)}
            </li>
          ))}
        </ul>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/FileNode.tsx
git commit -m "style: FileNode — white cards with colored left bars, Lucide icons"
```

---

## Task 7: BashNode.tsx — dark terminal + Lucide icons

**Files:**
- Modify: `apps/desktop/src/components/canvas/nodes/BashNode.tsx`

**Step 1: Replace entire file**

```tsx
import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

function extractCommand(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed['command'] === 'string') return parsed['command'];
  } catch { /* use raw */ }
  return raw;
}

/** Trim command to first line, max 50 chars. */
function shortCmd(s: string) {
  const first = s.split('\n')[0];
  return first.length > 50 ? first.slice(0, 50) + '…' : first;
}

export function BashNode({ data }: NodeProps<CanvasNode>) {
  const [expanded, setExpanded] = useState(false);
  const items = data.items as string[] | undefined;
  const count = items?.length ?? 0;

  const singleCommand = count <= 1
    ? shortCmd(items?.[0] ?? extractCommand(data.content))
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Top} />

      <button
        type="button"
        onClick={() => count > 1 && setExpanded(!expanded)}
        className="flex items-start gap-2 w-full text-left"
      >
        <Terminal size={14} strokeWidth={1.5} className="text-zinc-400 mt-0.5 flex-shrink-0" />
        <code className="text-zinc-100 text-xs font-mono flex-1 truncate">
          {count > 1 ? `${count} commands` : singleCommand}
        </code>
        {count > 1 && (
          <span className="text-zinc-500 flex-shrink-0">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-zinc-700 pt-2">
          {items!.map((item, i) => (
            <li key={i}>
              <code className="text-zinc-300 text-xs font-mono block truncate">
                {shortCmd(item)}
              </code>
            </li>
          ))}
        </ul>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/BashNode.tsx
git commit -m "style: BashNode — zinc-900 terminal card, Terminal icon, ChevronDown/Up"
```

---

## Task 8: AskUserOverlay.tsx — zinc palette

**Files:**
- Modify: `apps/desktop/src/components/canvas/AskUserOverlay.tsx`

**Step 1: Apply class swaps** (amber accents stay, only neutrals change)

| Find | Replace |
|---|---|
| `bg-neutral-900` | `bg-zinc-900` |
| `bg-neutral-800` | `bg-zinc-800` |
| `border-neutral-600` | `border-zinc-600` |
| `text-neutral-300` | `text-zinc-300` |
| `placeholder-neutral-500` | `placeholder-zinc-500` |

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/AskUserOverlay.tsx
git commit -m "style: AskUserOverlay — zinc palette"
```

---

## Task 9: TicketCard.tsx — zinc/violet

**Files:**
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

**Step 1: Apply class swaps**

| Find | Replace |
|---|---|
| `bg-neutral-800` | `bg-zinc-800` |
| `border-neutral-700` | `border-zinc-700` |
| `hover:border-neutral-600` | `hover:border-zinc-600` |
| `text-neutral-100` | `text-zinc-100` |
| `text-neutral-500` | `text-zinc-500` |
| `bg-indigo-700` | `bg-violet-700` |
| `text-indigo-400` | `text-violet-400` |
| `hover:text-indigo-300` | `hover:text-violet-300` |

Also change `text-neutral-100 text-sm` on the title to `text-zinc-100 text-sm font-medium`.

**Step 2: Commit**

```bash
git add apps/desktop/src/components/board/TicketCard.tsx
git commit -m "style: TicketCard — zinc palette, violet accent, font-medium title"
```

---

## Task 10: AgentPickerModal.tsx — zinc/violet + Lucide status icons

**Files:**
- Modify: `apps/desktop/src/components/agents/AgentPickerModal.tsx`

**Step 1: Replace entire file**

```tsx
// apps/desktop/src/components/agents/AgentPickerModal.tsx
import { useState } from 'react';
import { X, Circle, Loader2, MessageCircleQuestion, Eye, CircleAlert } from 'lucide-react';
import { useAgentStore, type Agent } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { CreateAgentModal } from './CreateAgentModal';

function StatusIcon({ status }: { status: Agent['status'] }) {
  switch (status) {
    case 'idle':             return <Circle size={8} className="text-green-500 fill-green-500 flex-shrink-0" />;
    case 'working':          return <Loader2 size={12} className="text-violet-400 animate-spin flex-shrink-0" />;
    case 'waiting_for_user': return <MessageCircleQuestion size={12} className="text-amber-400 flex-shrink-0" />;
    case 'reviewing':        return <Eye size={12} className="text-blue-400 flex-shrink-0" />;
    case 'blocked':          return <CircleAlert size={12} className="text-red-500 flex-shrink-0" />;
    default:                 return <Circle size={8} className="text-zinc-500 fill-zinc-500 flex-shrink-0" />;
  }
}

function statusLabel(agent: Agent): string {
  if (agent.status === 'idle') return 'Available';
  if (agent.status === 'working') return 'Busy (will queue)';
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

  if (activeProject && repos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-100 font-semibold text-sm">Assign agent</h2>
            <button type="button" onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <p className="text-zinc-500 text-xs text-center py-4">
            This project has no repositories. Add one in Settings.
          </p>
        </div>
      </div>
    );
  }

  if (showCreate) {
    return <CreateAgentModal onClose={() => setShowCreate(false)} />;
  }

  if (pendingAgent && isMultiRepo) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-100 font-semibold text-sm">Which repo?</h2>
            <button type="button" onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <p className="text-zinc-500 text-xs mb-3">
            Assigning <span className="text-zinc-300">{pendingAgent.name}</span>
          </p>
          {repos.map((repo) => (
            <button
              type="button"
              key={repo.id}
              onClick={() => onSelect(pendingAgent, repo.id)}
              className="w-full flex flex-col items-start px-3 py-2 rounded-lg
                         hover:bg-zinc-800 transition-colors text-left mb-1"
            >
              <p className="text-zinc-200 text-sm">{repo.name}</p>
              {repo.remoteUrl && (
                <p className="text-zinc-500 text-xs truncate">{repo.remoteUrl}</p>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPendingAgent(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 mt-2"
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
      const repoId = repos[0]?.id ?? '';
      onSelect(agent, repoId);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-72 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-zinc-100 font-semibold text-sm">Assign agent</h2>
          <button type="button" onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {agents.length === 0 && (
          <p className="text-zinc-500 text-xs text-center py-4">
            No agents yet — create one below.
          </p>
        )}

        {idle.length > 0 && (
          <div className="mb-2">
            <p className="text-zinc-600 text-xs mb-1 uppercase tracking-wide">Available</p>
            {idle.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        {busy.length > 0 && (
          <div className="mb-2">
            <p className="text-zinc-600 text-xs mb-1 uppercase tracking-wide">Busy (will queue)</p>
            {busy.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={handleAgentClick} />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full mt-2 text-xs text-violet-400 hover:text-violet-300 py-2
                     border border-dashed border-zinc-700 rounded-lg transition-colors"
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
      type="button"
      onClick={() => onSelect(agent)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                 hover:bg-zinc-800 transition-colors text-left"
    >
      <StatusIcon status={agent.status} />
      <div className="min-w-0">
        <p className="text-zinc-200 text-sm">{agent.name}</p>
        <p className="text-zinc-500 text-xs truncate">{statusLabel(agent)}</p>
      </div>
    </button>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/agents/AgentPickerModal.tsx
git commit -m "style: AgentPickerModal — zinc/violet, Lucide status icons, X close"
```

---

## Task 11: ToastContainer.tsx — zinc/violet + X icon

**Files:**
- Modify: `apps/desktop/src/components/ui/ToastContainer.tsx`

**Step 1: Replace entire file**

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useToastStore, type AgentToast } from '../../store/toastStore';

const AUTO_DISMISS_MS = 6000;

function Toast({ toast, onDismiss }: { toast: AgentToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl p-3 shadow-2xl w-80
                  bg-zinc-800 border transition-all
                  ${toast.isQuestion
                    ? 'border-amber-500/60'
                    : 'border-zinc-600/60'
                  }`}
    >
      <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center
                      text-white text-sm font-bold flex-shrink-0">
        {toast.agentName[0]?.toUpperCase() ?? '?'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <span className="text-white text-sm font-semibold truncate">{toast.agentName}</span>
          {toast.isQuestion && (
            <span className="text-amber-400 text-xs flex-shrink-0">needs your input</span>
          )}
        </div>
        <p className="text-zinc-300 text-xs leading-relaxed line-clamp-2">
          {toast.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="text-zinc-500 hover:text-zinc-300 flex-shrink-0 mt-0.5 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-20 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/ui/ToastContainer.tsx
git commit -m "style: ToastContainer — zinc/violet, X icon"
```

---

## Task 12: SettingsPanel.tsx — zinc/violet + Lucide

**Files:**
- Modify: `apps/desktop/src/components/layout/SettingsPanel.tsx`

**Step 1: Add Lucide imports at top of file**

Add after the existing import:
```tsx
import { X, ChevronDown, ChevronRight } from 'lucide-react';
```

**Step 2: Apply class swaps**

| Find | Replace |
|---|---|
| `bg-neutral-900` | `bg-zinc-900` |
| `border-neutral-700` | `border-zinc-700` |
| `text-neutral-100` | `text-zinc-100` |
| `text-neutral-500 hover:text-neutral-300` | `text-zinc-500 hover:text-zinc-300` |
| `text-neutral-300` | `text-zinc-300` |
| `text-neutral-400` | `text-zinc-400` |
| `text-neutral-200` | `text-zinc-200` |
| `bg-neutral-800` | `bg-zinc-800` |
| `border-neutral-600` | `border-zinc-600` |
| `placeholder-neutral-500` | `placeholder-zinc-500` |
| `focus:border-indigo-500` | `focus:border-violet-500` |
| `bg-neutral-700 hover:bg-neutral-600` | `bg-zinc-700 hover:bg-zinc-600` |
| `border-neutral-800` | `border-zinc-800` |
| `text-indigo-400` | `text-violet-400` |
| `hover:text-indigo-300` | `hover:text-violet-300` |
| `bg-indigo-600 hover:bg-indigo-500` | `bg-violet-600 hover:bg-violet-500` |

**Step 3: Replace unicode symbols with Lucide icons**

Replace the close button `×` text with `<X size={16} />`:
```tsx
<button type="button" onClick={onClose} aria-label="Close settings"
  className="text-zinc-500 hover:text-zinc-300 transition-colors">
  <X size={16} />
</button>
```

Replace the instructions toggle button content:
```tsx
// Change:
{showInstructions ? '▾' : '▸'} How to create a Personal Access Token
// To:
{showInstructions ? <ChevronDown size={12} className="inline" /> : <ChevronRight size={12} className="inline" />} How to create a Personal Access Token
```

**Step 4: Commit**

```bash
git add apps/desktop/src/components/layout/SettingsPanel.tsx
git commit -m "style: SettingsPanel — zinc/violet, Lucide X and chevrons"
```

---

## Task 13: OnboardingWizard.tsx — zinc/violet

**Files:**
- Modify: `apps/desktop/src/components/onboarding/OnboardingWizard.tsx`

**Step 1: Apply class swaps**

| Find | Replace |
|---|---|
| `bg-neutral-950` | `bg-zinc-950` |
| `bg-indigo-600` | `bg-violet-600` |
| `ring-indigo-400` | `ring-violet-400` |
| `ring-offset-neutral-950` | `ring-offset-zinc-950` |
| `bg-neutral-800` | `bg-zinc-800` |
| `text-neutral-500` | `text-zinc-500` |
| `text-neutral-200` | `text-zinc-200` |
| `text-neutral-600` | `text-zinc-600` |
| `bg-neutral-700` | `bg-zinc-700` |

**Step 2: Commit**

```bash
git add apps/desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "style: OnboardingWizard — zinc/violet"
```

---

## Task 14: StepConnectGitHub.tsx — zinc/violet + Lucide

**Files:**
- Modify: `apps/desktop/src/components/onboarding/StepConnectGitHub.tsx`

**Step 1: Add Lucide imports**

Add after the existing import:
```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';
```

**Step 2: Apply class swaps**

| Find | Replace |
|---|---|
| `text-neutral-100` | `text-zinc-100` |
| `text-neutral-400` | `text-zinc-400` |
| `text-neutral-200` | `text-zinc-200` |
| `text-indigo-400` | `text-violet-400` |
| `hover:text-indigo-300` | `hover:text-violet-300` |
| `bg-neutral-800` | `bg-zinc-800` |
| `border-neutral-600` | `border-zinc-600` |
| `placeholder-neutral-500` | `placeholder-zinc-500` |
| `focus:border-indigo-500` | `focus:border-violet-500` |
| `bg-neutral-700 hover:bg-neutral-600` | `bg-zinc-700 hover:bg-zinc-600` |
| `text-neutral-500 hover:text-neutral-300` | `text-zinc-500 hover:text-zinc-300` |
| `bg-indigo-600 hover:bg-indigo-500` | `bg-violet-600 hover:bg-violet-500` |

**Step 3: Replace toggle chevrons**

Change:
```tsx
{showInstructions ? '▾' : '▸'} How to create a token
```
to:
```tsx
{showInstructions ? <ChevronDown size={12} className="inline" /> : <ChevronRight size={12} className="inline" />} How to create a token
```

**Step 4: Commit**

```bash
git add apps/desktop/src/components/onboarding/StepConnectGitHub.tsx
git commit -m "style: StepConnectGitHub — zinc/violet, Lucide chevrons"
```

---

## Task 15: DmList.tsx — zinc/violet

**Files:**
- Modify: `apps/desktop/src/components/messages/DmList.tsx`

**Step 1: Apply class swaps**

| Find | Replace |
|---|---|
| `border-neutral-800` | `border-zinc-800` |
| `text-neutral-400` | `text-zinc-400` |
| `hover:bg-neutral-800` | `hover:bg-zinc-800` |
| `bg-neutral-800 text-white` | `bg-zinc-800 text-white` |
| `bg-indigo-700` | `bg-violet-700` |
| `bg-neutral-600` (message neutral color) | `text-zinc-600` (check context) |
| `bg-neutral-800 text-neutral-100` (agent message bubble) | `bg-zinc-800 text-zinc-100` |
| `bg-indigo-700 text-white` (user message bubble) | `bg-violet-700 text-white` |
| `text-neutral-600` | `text-zinc-600` |

**Step 2: Commit**

```bash
git add apps/desktop/src/components/messages/DmList.tsx
git commit -m "style: DmList — zinc/violet"
```

---

## Task 16: Final build verify

**Step 1: Run build**

```bash
pnpm --filter @poietai/desktop build
```

Expected: `✓ built in ~2s` with no errors.

**Step 2: Verify no remaining `indigo-` or `neutral-` classes in modified files**

```bash
grep -r "indigo-\|neutral-" apps/desktop/src/components/layout/ apps/desktop/src/components/canvas/ apps/desktop/src/components/board/ apps/desktop/src/components/agents/ apps/desktop/src/components/messages/ apps/desktop/src/components/ui/ToastContainer.tsx apps/desktop/src/components/onboarding/
```

Expected: zero matches (or only intentional hits like `bg-indigo-*` that were purposely skipped).

**Step 3: Push**

```bash
git push
```
