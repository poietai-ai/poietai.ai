# M5: Security Phase + Review Synthesis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-trigger a Security review agent after a clean QA pass, parse its OWASP-focused output, and render a Review Synthesis node that aggregates Validate + QA + Security verdicts into a single ship-readiness verdict.

**Architecture:** Mirrors M3/M4 exactly for the Security phase (same auto-trigger pattern, same `worktree_path_override` reuse, same `blockTicket` guard). After Security completes, a `ReviewSynthesisNode` is added that reads already-computed summaries from the canvas nodes (no re-parsing), showing a ship-readiness verdict. No Rust changes needed — `get_worktree_diff`, `worktree_path_override`, and `security` read-only tools were all landed in M3.

**Security output format is unique:** CRITICAL has 4 pipe-parts (`CRITICAL | <OWASP category> | <description> | <file:line>`) while WARNING has 3 parts (`WARNING | <description> | <file:line>`). There is no ADVISORY level in security.

**Tech Stack:** Rust (Tauri 2), React 19, TypeScript, Zustand, Vitest, @xyflow/react, Tailwind CSS 4

---

### Task 1: `parseSecurityResult` utility (TDD)

**Files:**
- Create: `apps/desktop/src/lib/parseSecurityResult.ts`
- Create: `apps/desktop/src/lib/parseSecurityResult.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/desktop/src/lib/parseSecurityResult.test.ts
import { describe, it, expect } from 'vitest';
import { parseSecurityResult } from './parseSecurityResult';

describe('parseSecurityResult', () => {
  it('returns zero counts for empty input', () => {
    const result = parseSecurityResult('');
    expect(result).toEqual({ critical: 0, warnings: 0, lines: [] });
  });

  it('parses a CRITICAL line with category and location', () => {
    const result = parseSecurityResult(
      'CRITICAL | OWASP A03:Injection | Unsanitized user input | src/db.rs:42'
    );
    expect(result.critical).toBe(1);
    expect(result.warnings).toBe(0);
    expect(result.lines[0]).toEqual({
      type: 'critical',
      category: 'OWASP A03:Injection',
      description: 'Unsanitized user input',
      location: 'src/db.rs:42',
    });
  });

  it('parses a WARNING line with description and location', () => {
    const result = parseSecurityResult(
      'WARNING | Outdated dependency lodash | package.json:1'
    );
    expect(result.warnings).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Outdated dependency lodash',
      location: 'package.json:1',
    });
  });

  it('location is undefined for CRITICAL with only 3 parts', () => {
    const result = parseSecurityResult('CRITICAL | OWASP A01:BrokenAccess | Missing auth check');
    expect(result.lines[0]).toEqual({
      type: 'critical',
      category: 'OWASP A01:BrokenAccess',
      description: 'Missing auth check',
      location: undefined,
    });
  });

  it('location is undefined for WARNING with only 2 parts', () => {
    const result = parseSecurityResult('WARNING | Hardcoded secret');
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Hardcoded secret',
      location: undefined,
    });
  });

  it('counts mixed lines correctly', () => {
    const text = [
      'CRITICAL | OWASP A03:Injection | SQL injection | src/db.rs:10',
      'WARNING | Weak hash algorithm | src/auth.rs:5',
      'CRITICAL | OWASP A07:AuthFailure | No rate limiting | src/api.rs:33',
      'WARNING | CORS wildcard | src/server.rs:2',
    ].join('\n');
    const result = parseSecurityResult(text);
    expect(result.critical).toBe(2);
    expect(result.warnings).toBe(2);
    expect(result.lines).toHaveLength(4);
  });

  it('ignores lines that do not match any prefix', () => {
    const text = 'Security summary:\nCRITICAL | OWASP A01 | Issue | src/a.rs:1\nNo other issues.';
    const result = parseSecurityResult(text);
    expect(result.critical).toBe(1);
    expect(result.lines).toHaveLength(1);
  });

  it('location is undefined for CRITICAL when parts[3] is empty (trailing pipe)', () => {
    const result = parseSecurityResult('CRITICAL | OWASP A02 | Sensitive data exposure |');
    expect(result.lines[0].location).toBeUndefined();
  });
});
```

**Step 2: Run tests — verify they FAIL**

```bash
cd apps/desktop && pnpm test -- --run parseSecurityResult
```

Expected: FAIL — `parseSecurityResult` not defined.

**Step 3: Create the implementation**

```typescript
// apps/desktop/src/lib/parseSecurityResult.ts

export type SecurityLine =
  | { type: 'critical'; category: string; description: string; location?: string }
  | { type: 'warning'; description: string; location?: string };

export interface SecurityResult {
  critical: number;
  warnings: number;
  lines: SecurityLine[];
}

export function parseSecurityResult(text: string): SecurityResult {
  const lines: SecurityLine[] = [];
  let critical = 0;
  let warnings = 0;

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('CRITICAL |')) {
      // Format: CRITICAL | <category> | <description> | <file:line>
      const parts = trimmed.split('|').map((p) => p.trim());
      const category = parts[1] ?? '';
      const description = parts[2] ?? '';
      const location = parts.length >= 4 && parts[3] !== '' ? parts[3] : undefined;
      lines.push({ type: 'critical', category, description, location });
      critical++;
    } else if (trimmed.startsWith('WARNING |')) {
      // Format: WARNING | <description> | <file:line>
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 && parts[2] !== '' ? parts[2] : undefined;
      lines.push({ type: 'warning', description, location });
      warnings++;
    }
  }

  return { critical, warnings, lines };
}
```

**Step 4: Run tests — verify they PASS**

```bash
cd apps/desktop && pnpm test -- --run parseSecurityResult
```

Expected: 8 tests PASS.

**Step 5: Run full suite**

```bash
cd apps/desktop && pnpm test -- --run
```

Expected: all tests PASS (62 existing + 8 new = 70).

**Step 6: Commit**

```bash
git add apps/desktop/src/lib/parseSecurityResult.ts apps/desktop/src/lib/parseSecurityResult.test.ts
git commit -m "feat(m5): parseSecurityResult utility with TDD"
```

---

### Task 2: `SecurityResultNode` + `'security_result'` type

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/nodes/SecurityResultNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

**Step 1: Update `src/types/canvas.ts`**

Add `'security_result'` to `CanvasNodeType` after `'qa_result'`:
```typescript
  | 'qa_result'
  | 'security_result'
```

Add `securitySummary` to `CanvasNodeData` after `qaSummary`:
```typescript
  qaSummary?: { critical: number; warnings: number; advisory: number };
  securitySummary?: { critical: number; warnings: number };
```

**Step 2: Create `SecurityResultNode.tsx`**

```tsx
// apps/desktop/src/components/canvas/nodes/SecurityResultNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function SecurityResultNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const summary = nodeData.securitySummary ?? { critical: 0, warnings: 0 };
  const hasCritical = summary.critical > 0;

  const colorClass = hasCritical
    ? 'bg-red-950 border-red-700 text-red-200'
    : 'bg-green-950 border-green-700 text-green-200';

  return (
    <div className={['px-4 py-3 rounded-lg border font-mono text-xs w-64 select-none', colorClass].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider mb-2 text-zinc-400">Security Report</div>
      <div className="flex gap-4">
        <div className="text-center">
          <div className={`font-bold text-base ${hasCritical ? 'text-red-400' : 'text-zinc-500'}`}>
            {summary.critical}
          </div>
          <div className="text-zinc-500 text-[10px]">critical</div>
        </div>
        <div className="text-center">
          <div className={`font-bold text-base ${summary.warnings > 0 ? 'text-yellow-400' : 'text-zinc-500'}`}>
            {summary.warnings}
          </div>
          <div className="text-zinc-500 text-[10px]">warnings</div>
        </div>
      </div>
      {hasCritical && (
        <div className="mt-2 text-red-400 text-[10px] font-semibold">
          Critical vulnerabilities — ticket blocked
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}
```

**Step 3: Register in `nodes/index.ts`**

Add:
```typescript
import { SecurityResultNode } from './SecurityResultNode';

export const nodeTypes = {
  // ... existing entries ...
  qa_result: QaResultNode,
  security_result: SecurityResultNode,
} as const;
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

Expected: all tests PASS (no regressions).

**Step 6: Commit**

```bash
git add apps/desktop/src/types/canvas.ts \
        apps/desktop/src/components/canvas/nodes/SecurityResultNode.tsx \
        apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat(m5): SecurityResultNode component + security_result type"
```

---

### Task 3: `ReviewSynthesisNode` + `'review_synthesis'` type

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/nodes/ReviewSynthesisNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

**Step 1: Update `src/types/canvas.ts`**

Add `'review_synthesis'` to `CanvasNodeType` after `'security_result'`:
```typescript
  | 'security_result'
  | 'review_synthesis'
```

Add `synthesisSummary` to `CanvasNodeData` after `securitySummary`:
```typescript
  securitySummary?: { critical: number; warnings: number };
  synthesisSummary?: {
    validate: { critical: number; verified: number };
    qa: { critical: number; warnings: number; advisory: number };
    security: { critical: number; warnings: number };
  };
```

**Step 2: Create `ReviewSynthesisNode.tsx`**

```tsx
// apps/desktop/src/components/canvas/nodes/ReviewSynthesisNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function ReviewSynthesisNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const s = nodeData.synthesisSummary ?? {
    validate: { critical: 0, verified: 0 },
    qa: { critical: 0, warnings: 0, advisory: 0 },
    security: { critical: 0, warnings: 0 },
  };

  const totalCritical = s.validate.critical + s.qa.critical + s.security.critical;
  const isReady = totalCritical === 0;

  return (
    <div className={[
      'px-4 py-3 rounded-lg border font-mono text-xs w-72 select-none',
      isReady
        ? 'bg-green-950 border-green-600 text-green-100'
        : 'bg-red-950 border-red-700 text-red-200',
    ].join(' ')}>
      <div className="text-[10px] uppercase tracking-wider mb-3 text-zinc-400">Ship Readiness</div>

      {/* Three review rows */}
      <div className="space-y-1.5 mb-3">
        <ReviewRow
          label="VALIDATE"
          ok={s.validate.critical === 0}
          detail={s.validate.critical === 0
            ? `${s.validate.verified} verified`
            : `${s.validate.critical} critical`}
        />
        <ReviewRow
          label="QA"
          ok={s.qa.critical === 0}
          detail={s.qa.critical === 0
            ? `${s.qa.warnings}w ${s.qa.advisory}a`
            : `${s.qa.critical} critical`}
        />
        <ReviewRow
          label="SECURITY"
          ok={s.security.critical === 0}
          detail={s.security.critical === 0
            ? `${s.security.warnings} warnings`
            : `${s.security.critical} critical`}
        />
      </div>

      {/* Verdict */}
      <div className={[
        'text-[11px] font-bold uppercase tracking-wide pt-2 border-t',
        isReady ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400',
      ].join(' ')}>
        {isReady ? 'Ready to ship' : `Blocked — ${totalCritical} critical issue${totalCritical !== 1 ? 's' : ''}`}
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
    </div>
  );
}

function ReviewRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-semibold w-16 flex-shrink-0 ${ok ? 'text-green-400' : 'text-red-400'}`}>
        {label}
      </span>
      <span className={`text-[10px] ${ok ? 'text-zinc-400' : 'text-red-300'}`}>
        {ok ? '✓' : '✗'} {detail}
      </span>
    </div>
  );
}
```

**Step 3: Register in `nodes/index.ts`**

```typescript
import { ReviewSynthesisNode } from './ReviewSynthesisNode';

export const nodeTypes = {
  // ... existing ...
  security_result: SecurityResultNode,
  review_synthesis: ReviewSynthesisNode,
} as const;
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
git add apps/desktop/src/types/canvas.ts \
        apps/desktop/src/components/canvas/nodes/ReviewSynthesisNode.tsx \
        apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat(m5): ReviewSynthesisNode + review_synthesis type"
```

---

### Task 4: `addSecurityResultNode` + `addReviewSynthesisNode` in canvasStore (TDD)

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/src/store/canvasStore.test.ts`

**Step 1: Write the failing tests**

Add two new `describe` blocks to `canvasStore.test.ts` after the existing `addQaResultNode` tests:

```typescript
describe('addSecurityResultNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a security_result node to an empty canvas', () => {
    const summary = { critical: 1, warnings: 2 };
    act(() => useCanvasStore.getState().addSecurityResultNode(summary));
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('security_result');
    expect(nodes[0].data.nodeType).toBe('security_result');
    expect(nodes[0].data.securitySummary).toEqual(summary);
    expect(nodes[0].data.ticketId).toBe('ticket-1');
  });

  it('adds an edge from the last non-ghost node', () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'agent_message',
          position: { x: 0, y: 80 },
          data: { nodeType: 'agent_message', agentId: 'a1', ticketId: 'ticket-1', content: 'hi' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    act(() => useCanvasStore.getState().addSecurityResultNode({ critical: 0, warnings: 0 }));
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});

describe('addReviewSynthesisNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a review_synthesis node with synthesisSummary', () => {
    const summary = {
      validate: { critical: 0, verified: 5 },
      qa: { critical: 0, warnings: 1, advisory: 2 },
      security: { critical: 0, warnings: 0 },
    };
    act(() => useCanvasStore.getState().addReviewSynthesisNode(summary));
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('review_synthesis');
    expect(nodes[0].data.synthesisSummary).toEqual(summary);
  });

  it('adds an edge from the last non-ghost node', () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'security_result',
          position: { x: 0, y: 80 },
          data: { nodeType: 'security_result', agentId: '', ticketId: 'ticket-1', content: '' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    act(() => useCanvasStore.getState().addReviewSynthesisNode({
      validate: { critical: 0, verified: 0 },
      qa: { critical: 0, warnings: 0, advisory: 0 },
      security: { critical: 0, warnings: 0 },
    }));
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});
```

**Step 2: Run tests — verify they FAIL**

```bash
cd apps/desktop && pnpm test -- --run canvasStore
```

Expected: 4 new tests FAIL.

**Step 3: Add to `CanvasStore` interface in `canvasStore.ts`**

After `addQaResultNode`:
```typescript
addSecurityResultNode: (summary: { critical: number; warnings: number }) => void;
addReviewSynthesisNode: (summary: {
  validate: { critical: number; verified: number };
  qa: { critical: number; warnings: number; advisory: number };
  security: { critical: number; warnings: number };
}) => void;
```

**Step 4: Add implementations (after `addQaResultNode` implementation)**

```typescript
addSecurityResultNode: (summary) => {
  const { nodes, edges, activeTicketId } = get();
  const nodeId = `security-result-${Date.now()}`;
  const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;

  const newNode: Node<CanvasNodeData> = {
    id: nodeId,
    type: 'security_result' as CanvasNodeType,
    position: { x: xPosition, y: 80 },
    data: {
      nodeType: 'security_result' as CanvasNodeType,
      agentId: '',
      ticketId: activeTicketId ?? '',
      content: '',
      securitySummary: summary,
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

addReviewSynthesisNode: (summary) => {
  const { nodes, edges, activeTicketId } = get();
  const nodeId = `review-synthesis-${Date.now()}`;
  const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;

  const newNode: Node<CanvasNodeData> = {
    id: nodeId,
    type: 'review_synthesis' as CanvasNodeType,
    position: { x: xPosition, y: 80 },
    data: {
      nodeType: 'review_synthesis' as CanvasNodeType,
      agentId: '',
      ticketId: activeTicketId ?? '',
      content: '',
      synthesisSummary: summary,
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

**Step 5: Run tests — verify they PASS**

```bash
cd apps/desktop && pnpm test -- --run canvasStore
```

Expected: all canvasStore tests PASS.

**Step 6: Run full suite**

```bash
cd apps/desktop && pnpm test -- --run
```

Expected: all 74 tests PASS (70 + 4 new).

**Step 7: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat(m5): addSecurityResultNode + addReviewSynthesisNode in canvasStore with TDD"
```

---

### Task 5: Auto-trigger SECURITY + Review Synthesis in TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Add `parseSecurityResult` import**

After the `parseQaResult` import:
```typescript
import { parseSecurityResult } from '../../lib/parseSecurityResult';
```

**Step 2: Add Security capture block**

Inside `if (lastTextNode)`, after the QA capture block:

```typescript
// If SECURITY just completed: parse result + summary node + synthesis + maybe block
if (completedPhase === 'security') {
  const secResult = parseSecurityResult(content);
  useCanvasStore.getState().addSecurityResultNode(secResult);

  // Gather summaries from existing canvas nodes for synthesis
  const currentNodes = useCanvasStore.getState().nodes;
  const validateNode = currentNodes.find((n) => n.type === 'validate_result');
  const qaNode = currentNodes.find((n) => n.type === 'qa_result');
  useCanvasStore.getState().addReviewSynthesisNode({
    validate: validateNode?.data.validateSummary ?? { critical: 0, verified: 0 },
    qa: qaNode?.data.qaSummary ?? { critical: 0, warnings: 0, advisory: 0 },
    security: secResult,
  });

  if (secResult.critical > 0) {
    useTicketStore.getState().blockTicket(ticket_id);
    wasBlocked = true;
  }
}
```

**Step 3: Add SECURITY auto-trigger block**

After the QA auto-trigger block (still inside `if (ticket && completedPhase && completedPhase !== 'ship')`):

```typescript
// After advance: check if we've entered SECURITY — auto-trigger
if (updatedTicket?.activePhase === 'security') {
  const planArtifact = updatedTicket.artifacts.plan;
  if (planArtifact) {
    try {
      await useAgentStore.getState().refresh();
      const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
      const worktreePath = buildAgent?.worktree_path;

      const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

      const assignment = updatedTicket.assignments[0];
      const project = useProjectStore
        .getState()
        .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
      const repo =
        project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
      const ghToken = useSecretsStore.getState().ghToken ?? '';

      if (!repo) {
        console.warn('[TicketCanvas] No repo found — cannot auto-trigger SECURITY');
      } else {
        const securityPrompt = [
          'Review the following code changes for security vulnerabilities.',
          '',
          '## Approved Plan',
          planArtifact.content,
          '',
          '## Git Diff (code changes to review)',
          diff || '(no diff available)',
        ].join('\n');

        const systemPrompt = buildPrompt({
          agentId: agent_id,
          role: buildAgent?.role ?? 'security',
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
            // Reuse the BUILD agent's id — SECURITY runs as the same agent identity via phase prompt
            agent_id,
            ticket_id,
            ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
            prompt: securityPrompt,
            system_prompt: systemPrompt,
            repo_root: repo.repoRoot,
            gh_token: ghToken,
            resume_session_id: null,
            phase: 'security',
            worktree_path_override: worktreePath ?? null,
          },
        });
      }
    } catch (err) {
      console.error('[TicketCanvas] Failed to auto-trigger SECURITY:', err);
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

Expected: all 74 tests PASS (no regressions — TicketCanvas has no unit tests).

**Step 6: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat(m5): auto-trigger SECURITY agent + Review Synthesis node"
```

---

## Verification Checklist

After all tasks complete:

1. `pnpm test -- --run` → all tests pass (was 62 before M5, expect 74 after)
2. `pnpm typecheck` → 0 errors
3. `parseSecurityResult` exported from `src/lib/parseSecurityResult.ts`
4. `SecurityResultNode` registered under `security_result` in `nodes/index.ts`
5. `ReviewSynthesisNode` registered under `review_synthesis` in `nodes/index.ts`
6. `addSecurityResultNode` + `addReviewSynthesisNode` in `CanvasStore` interface and implementation
7. `TicketCanvas.tsx` handles `completedPhase === 'security'` (parse + nodes + synthesis + block)
8. `TicketCanvas.tsx` auto-triggers `start_agent` when `updatedTicket.activePhase === 'security'`
9. After SECURITY completes, a `ReviewSynthesisNode` appears showing all 3 review verdicts + ship readiness
