# M4: QA Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-trigger a QA review agent after a clean VALIDATE, parse its output, render a `QaResultNode` on the canvas, and block the ticket if critical issues are found.

**Architecture:** Mirrors the M3 VALIDATE pipeline exactly — same `agent-result` auto-trigger pattern, same `worktree_path_override` reuse, same `blockTicket` guard. The QA agent receives plan + diff and outputs `CRITICAL | desc | file:line`, `WARNING | desc | file:line`, `ADVISORY | desc | file:line` lines.

**Tech Stack:** Rust (Tauri 2), React 19, TypeScript, Zustand, Vitest, @xyflow/react, Tailwind CSS 4

**No Rust changes needed.** `get_worktree_diff`, `worktree_path_override`, and `qa` read-only tools were all landed in M3.

---

### Task 1: `parseQaResult` utility (TDD)

**Files:**
- Create: `apps/desktop/src/lib/parseQaResult.ts`
- Create: `apps/desktop/src/lib/parseQaResult.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/desktop/src/lib/parseQaResult.test.ts
import { describe, it, expect } from 'vitest';
import { parseQaResult } from './parseQaResult';

describe('parseQaResult', () => {
  it('returns zero counts for empty input', () => {
    const result = parseQaResult('');
    expect(result).toEqual({ critical: 0, warnings: 0, advisory: 0, lines: [] });
  });

  it('counts a single CRITICAL line', () => {
    const result = parseQaResult('CRITICAL | Missing error handling | src/lib.rs:42');
    expect(result.critical).toBe(1);
    expect(result.warnings).toBe(0);
    expect(result.advisory).toBe(0);
    expect(result.lines[0]).toEqual({
      type: 'critical',
      description: 'Missing error handling',
      location: 'src/lib.rs:42',
    });
  });

  it('counts a single WARNING line', () => {
    const result = parseQaResult('WARNING | Unused import | src/main.ts:5');
    expect(result.warnings).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Unused import',
      location: 'src/main.ts:5',
    });
  });

  it('counts a single ADVISORY line', () => {
    const result = parseQaResult('ADVISORY | Consider extracting helper | src/foo.ts:10');
    expect(result.advisory).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'advisory',
      description: 'Consider extracting helper',
      location: 'src/foo.ts:10',
    });
  });

  it('counts mixed severity lines', () => {
    const text = [
      'CRITICAL | Panic in unwrap | src/lib.rs:99',
      'WARNING | Magic number 42 | src/config.ts:7',
      'ADVISORY | Long function | src/util.ts:3',
      'CRITICAL | SQL injection risk | src/db.rs:14',
    ].join('\n');
    const result = parseQaResult(text);
    expect(result.critical).toBe(2);
    expect(result.warnings).toBe(1);
    expect(result.advisory).toBe(1);
    expect(result.lines).toHaveLength(4);
  });

  it('ignores lines that do not match any prefix', () => {
    const text = 'Some summary text\nCRITICAL | Real issue | src/a.rs:1\nAnother note';
    const result = parseQaResult(text);
    expect(result.critical).toBe(1);
    expect(result.lines).toHaveLength(1);
  });

  it('location is undefined when only two pipe-separated parts', () => {
    const result = parseQaResult('CRITICAL | Missing tests');
    expect(result.lines[0]).toEqual({
      type: 'critical',
      description: 'Missing tests',
      location: undefined,
    });
  });

  it('handles pipe characters in description by using parts[1] as description', () => {
    // Description is always parts[1]; location is parts[2] when present
    const result = parseQaResult('WARNING | Use foo | bar instead | src/x.ts:1');
    expect(result.lines[0].description).toBe('Use foo | bar instead');
    expect(result.lines[0].location).toBe('src/x.ts:1');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && pnpm test -- --run parseQaResult
```

Expected: FAIL — `parseQaResult` not defined.

**Step 3: Write the implementation**

```typescript
// apps/desktop/src/lib/parseQaResult.ts

export type QaLine =
  | { type: 'critical'; description: string; location?: string }
  | { type: 'warning';  description: string; location?: string }
  | { type: 'advisory'; description: string; location?: string };

export interface QaResult {
  critical: number;
  warnings: number;
  advisory: number;
  lines: QaLine[];
}

export function parseQaResult(text: string): QaResult {
  const lines: QaLine[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('CRITICAL |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      // parts[0] = 'CRITICAL', parts[1] = description, parts[2] = location (optional)
      // When there are extra pipes in description (edge case), parts[1] holds description
      // and parts[parts.length - 1] holds location only if there are >= 3 parts AND
      // last part looks like a file:line reference. Keep it simple: parts[1] = desc, parts[2] = location.
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'critical', description, location });
    } else if (trimmed.startsWith('WARNING |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'warning', description, location });
    } else if (trimmed.startsWith('ADVISORY |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'advisory', description, location });
    }
  }

  let critical = 0;
  let warnings = 0;
  let advisory = 0;
  for (const line of lines) {
    if (line.type === 'critical') critical++;
    else if (line.type === 'warning') warnings++;
    else advisory++;
  }

  return { critical, warnings, advisory, lines };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && pnpm test -- --run parseQaResult
```

Expected: 8 tests PASS.

**Step 5: Run full suite to ensure no regressions**

```bash
cd apps/desktop && pnpm test -- --run
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add apps/desktop/src/lib/parseQaResult.ts apps/desktop/src/lib/parseQaResult.test.ts
git commit -m "feat(m4): parseQaResult utility with TDD"
```

---

### Task 2: `QaResultNode` canvas component + type registration

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/nodes/QaResultNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

**Step 1: Add `'qa_result'` to `CanvasNodeType` and `qaSummary` to `CanvasNodeData`**

In `apps/desktop/src/types/canvas.ts`, change:

```typescript
// BEFORE (line ~22):
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
  | 'ci_review'
  | 'plan_task'
  | 'validate_result';
```

```typescript
// AFTER:
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
  | 'ci_review'
  | 'plan_task'
  | 'validate_result'
  | 'qa_result';
```

Also add `qaSummary` to `CanvasNodeData` (after the existing `validateSummary` field):

```typescript
  // M3: validate result summary
  validateSummary?: { verified: number; critical: number; advisory: number };
  // M4: qa result summary
  qaSummary?: { critical: number; warnings: number; advisory: number };
```

**Step 2: Create `QaResultNode.tsx`**

```tsx
// apps/desktop/src/components/canvas/nodes/QaResultNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function QaResultNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const summary = nodeData.qaSummary ?? { critical: 0, warnings: 0, advisory: 0 };
  const hasCritical = summary.critical > 0;
  const hasWarnings = summary.warnings > 0;

  const borderColor = hasCritical
    ? 'bg-red-950 border-red-700 text-red-200'
    : hasWarnings
    ? 'bg-yellow-950 border-yellow-700 text-yellow-200'
    : 'bg-green-950 border-green-700 text-green-200';

  return (
    <div className={['px-4 py-3 rounded-lg border font-mono text-xs w-64 select-none', borderColor].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider mb-2 text-zinc-400">QA Report</div>
      <div className="flex gap-4">
        <div className="text-center">
          <div className={`font-bold text-base ${hasCritical ? 'text-red-400' : 'text-zinc-500'}`}>
            {summary.critical}
          </div>
          <div className="text-zinc-500 text-[10px]">critical</div>
        </div>
        <div className="text-center">
          <div className={`font-bold text-base ${hasWarnings ? 'text-yellow-400' : 'text-zinc-500'}`}>
            {summary.warnings}
          </div>
          <div className="text-zinc-500 text-[10px]">warnings</div>
        </div>
        <div className="text-center">
          <div className="text-zinc-400 font-bold text-base">{summary.advisory}</div>
          <div className="text-zinc-500 text-[10px]">advisory</div>
        </div>
      </div>
      {hasCritical && (
        <div className="mt-2 text-red-400 text-[10px] font-semibold">
          Critical quality issues — ticket blocked
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}
```

**Step 3: Register in `nodes/index.ts`**

```typescript
// BEFORE:
import { ValidateResultNode } from './ValidateResultNode';

export const nodeTypes = {
  // ...
  validate_result: ValidateResultNode,
} as const;

// AFTER:
import { ValidateResultNode } from './ValidateResultNode';
import { QaResultNode } from './QaResultNode';

export const nodeTypes = {
  // ...
  validate_result: ValidateResultNode,
  qa_result: QaResultNode,
} as const;
```

**Step 4: Typecheck**

```bash
cd apps/desktop && pnpm typecheck
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add apps/desktop/src/types/canvas.ts \
        apps/desktop/src/components/canvas/nodes/QaResultNode.tsx \
        apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat(m4): QaResultNode component + qa_result type registration"
```

---

### Task 3: `addQaResultNode` in canvasStore (TDD)

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/src/store/canvasStore.test.ts`

**Step 1: Write the failing tests**

In `apps/desktop/src/store/canvasStore.test.ts`, add a `describe('addQaResultNode')` block after the existing `addValidateResultNode` tests:

```typescript
describe('addQaResultNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a qa_result node to an empty canvas', () => {
    const summary = { critical: 1, warnings: 2, advisory: 3 };
    act(() => useCanvasStore.getState().addQaResultNode(summary));
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('qa_result');
    expect(nodes[0].data.nodeType).toBe('qa_result');
    expect(nodes[0].data.qaSummary).toEqual(summary);
    expect(nodes[0].data.ticketId).toBe('ticket-1');
  });

  it('adds an edge from the last non-ghost node', () => {
    // Seed a prior node
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'agent_message',
          position: { x: 0, y: 80 },
          data: { nodeType: 'agent_message', agentId: 'a1', ticketId: 'ticket-1', content: 'hello' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    act(() => useCanvasStore.getState().addQaResultNode({ critical: 0, warnings: 0, advisory: 0 }));
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && pnpm test -- --run canvasStore
```

Expected: FAIL — `addQaResultNode is not a function`.

**Step 3: Add interface declaration and implementation to `canvasStore.ts`**

Add to the `CanvasStore` interface (after `addValidateResultNode`):

```typescript
addQaResultNode: (summary: { critical: number; warnings: number; advisory: number }) => void;
```

Add to the store implementation (after `addValidateResultNode`):

```typescript
addQaResultNode: (summary) => {
  const { nodes, edges, activeTicketId } = get();
  const nodeId = `qa-result-${Date.now()}`;
  const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;

  const newNode: Node<CanvasNodeData> = {
    id: nodeId,
    type: 'qa_result' as CanvasNodeType,
    position: { x: xPosition, y: 80 },
    data: {
      nodeType: 'qa_result' as CanvasNodeType,
      agentId: '',
      ticketId: activeTicketId ?? '',
      content: '',
      qaSummary: summary,
      items: [],
    },
  };

  const newEdges = [...edges];
  if (nodes.length > 0) {
    const prevNode = [...nodes].reverse().find((n) => !n.data.isGhost) ?? nodes[nodes.length - 1];
    newEdges.push({
      id: `${prevNode.id}->${nodeId}`,
      source: prevNode.id,
      target: nodeId,
      type: 'smoothstep',
      style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
    });
  }

  set({ nodes: [...nodes, newNode], edges: newEdges });
},
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/desktop && pnpm test -- --run canvasStore
```

Expected: all canvasStore tests PASS.

**Step 5: Run full test suite**

```bash
cd apps/desktop && pnpm test -- --run
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat(m4): addQaResultNode in canvasStore with TDD"
```

---

### Task 4: Auto-trigger QA in TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Add `parseQaResult` import**

Add to imports at top of file (after `parseValidateResult`):

```typescript
import { parseQaResult } from '../../lib/parseQaResult';
```

**Step 2: Add QA artifact capture in the `completedPhase` block**

Inside the `agent-result` handler, after the `if (completedPhase === 'validate')` block, add:

```typescript
// If QA just completed: parse result + add summary node + maybe block
if (completedPhase === 'qa') {
  const result = parseQaResult(content);
  useCanvasStore.getState().addQaResultNode(result);
  if (result.critical > 0) {
    useTicketStore.getState().blockTicket(ticket_id);
    wasBlocked = true;
  }
}
```

The full updated section (for reference — the block structure):

```typescript
if (lastTextNode) {
  const content = String(lastTextNode.data.content);
  useTicketStore.getState().setPhaseArtifact(ticket_id, {
    phase: completedPhase,
    content,
    createdAt: new Date().toISOString(),
    agentId: agent_id,
  });

  // If VALIDATE just completed: parse result + add summary node + maybe block
  if (completedPhase === 'validate') {
    const result = parseValidateResult(content);
    useCanvasStore.getState().addValidateResultNode(result);
    if (result.critical > 0) {
      useTicketStore.getState().blockTicket(ticket_id);
      wasBlocked = true;
    }
  }

  // If QA just completed: parse result + add summary node + maybe block
  if (completedPhase === 'qa') {
    const result = parseQaResult(content);
    useCanvasStore.getState().addQaResultNode(result);
    if (result.critical > 0) {
      useTicketStore.getState().blockTicket(ticket_id);
      wasBlocked = true;
    }
  }
}
```

**Step 3: Add QA auto-trigger block after the VALIDATE auto-trigger block**

After the closing `}` of the VALIDATE auto-trigger block (`if (updatedTicket?.activePhase === 'validate') { ... }`), add:

```typescript
// After advance: check if we've entered QA — auto-trigger
if (updatedTicket?.activePhase === 'qa') {
  const planArtifact = updatedTicket.artifacts.plan;
  if (planArtifact) {
    try {
      // Get build agent's worktree info
      await useAgentStore.getState().refresh();
      const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      const worktreePath = buildAgent?.worktree_path;

      // Get git diff from the build worktree
      const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

      // Get repo info from ticket assignment
      const assignment = updatedTicket.assignments[0];
      const project = useProjectStore
        .getState()
        .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
      const repo =
        project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
      const ghToken = useSecretsStore.getState().ghToken ?? '';

      if (!repo) {
        console.warn('[TicketCanvas] No repo found — cannot auto-trigger QA');
        return;
      }

      // Build QA prompt: plan + diff
      const qaPrompt = [
        'Review the following code changes for quality issues.',
        '',
        '## Approved Plan',
        planArtifact.content,
        '',
        '## Git Diff (code changes to review)',
        diff || '(no diff available)',
      ].join('\n');

      const systemPrompt = buildPrompt({
        agentId: agent_id,
        role: buildAgent?.role ?? 'qa',
        personality: buildAgent?.personality ?? 'pragmatic',
        projectName: project?.name ?? '',
        projectStack: 'Rust, React 19, Tauri 2, TypeScript',
        projectContext: '',
        ticketNumber: 0,
        ticketTitle: updatedTicket.title,
        ticketDescription: updatedTicket.description,
        ticketAcceptanceCriteria: updatedTicket.acceptanceCriteria,
      });

      await invoke<void>('start_agent', {
        payload: {
          // Reuse the BUILD agent's id — QA runs as the same agent identity via phase prompt
          agent_id,
          ticket_id,
          ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
          prompt: qaPrompt,
          system_prompt: systemPrompt,
          repo_root: repo.repoRoot,
          gh_token: ghToken,
          resume_session_id: null,
          phase: 'qa',
          worktree_path_override: worktreePath ?? null,
        },
      });
    } catch (err) {
      console.error('[TicketCanvas] Failed to auto-trigger QA:', err);
    }
  }
}
```

**Step 4: Typecheck**

```bash
cd apps/desktop && pnpm typecheck
```

Expected: 0 errors.

**Step 5: Run full test suite**

```bash
cd apps/desktop && pnpm test -- --run
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat(m4): auto-trigger QA agent + capture artifact + block on critical"
```

---

## Verification Checklist

After all tasks complete, verify:

1. `pnpm test -- --run` in `apps/desktop` → all tests pass (was 51 before M4, expect ~61 after)
2. `pnpm typecheck` in `apps/desktop` → 0 errors
3. `parseQaResult` exported from `src/lib/parseQaResult.ts`
4. `QaResultNode` exported and registered under `qa_result` in `nodes/index.ts`
5. `addQaResultNode` in `CanvasStore` interface and implementation
6. `TicketCanvas.tsx` handles `completedPhase === 'qa'` (parse + node + block)
7. `TicketCanvas.tsx` auto-triggers `start_agent` when `updatedTicket.activePhase === 'qa'`
