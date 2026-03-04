# Plan Artifact (M2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The PLAN phase produces a structured JSON artifact; a ghost graph of planned tasks renders on the canvas before BUILD starts; the BUILD agent receives only the plan as its instruction set.

**Architecture:** After a PLAN phase run ends, `TicketCanvas` scans the last `agent_message` node for a JSON fence, parses it as a `PlanArtifact`, stores it via `setPhaseArtifact`, advances the ticket to BUILD, and seeds the canvas with translucent ghost nodes (one per planned task). When BUILD starts, `TicketCard` passes the plan content as the system prompt, replacing the raw ticket description. As the agent edits files, matching ghost nodes light up.

**Tech Stack:** TypeScript + Zustand (canvasStore + ticketStore), React/ReactFlow (PlanTaskNode), Vitest, Rust (context/builder.rs left unchanged — plan injection is TypeScript-side)

---

## Current State (read before starting)

| File | Relevant state |
|---|---|
| `apps/desktop/src/store/ticketStore.ts` | `setPhaseArtifact` and `advanceTicketPhase` are implemented but **never called** — M2 wires them |
| `apps/desktop/src/components/canvas/TicketCanvas.tsx` | `agent-result` handler only checks for end-of-session question — M2 adds artifact capture + phase advance |
| `apps/desktop/src/store/canvasStore.ts` | Nodes laid out at `y=80`, `x = nodes.length * 340` — M2 adds ghost nodes at `y=-180` and adjusts x calc |
| `apps/desktop/src/types/canvas.ts` | `CanvasNodeType` has 10 values — M2 adds `'plan_task'` |
| `apps/desktop/src/components/board/TicketCard.tsx` | `invoke('start_agent')` passes `phase: ticket.activePhase ?? 'build'` — M2 adds `plan_artifact` injection |
| `apps/desktop/src/lib/promptBuilder.ts` | Builds system prompt string from role/personality/project/ticket — M2 adds `planContent?` path |

---

## Task 1: PlanArtifact types and parser

**Files:**
- Create: `apps/desktop/src/types/planArtifact.ts`
- Create: `apps/desktop/src/lib/parsePlanArtifact.ts`
- Create: `apps/desktop/src/lib/parsePlanArtifact.test.ts`

### Step 1: Write the failing tests

```typescript
// apps/desktop/src/lib/parsePlanArtifact.test.ts
import { describe, it, expect } from 'vitest';
import { parsePlanArtifact } from './parsePlanArtifact';
import type { PlanArtifact } from '../types/planArtifact';

const VALID_PLAN: PlanArtifact = {
  ticketId: 'T-87',
  taskGroups: [
    {
      groupId: 'G1',
      agentRole: 'backend_engineer',
      description: 'Add nil guard',
      tasks: [
        {
          id: 'G1-T1',
          action: 'modify',
          file: 'src/services/billing.ts',
          description: 'Add nil guard on subscription',
        },
      ],
      filesTouched: ['src/services/billing.ts'],
    },
  ],
  fileConflictCheck: { conflicts: [], status: 'clean' },
  parallelSafe: true,
};

describe('parsePlanArtifact', () => {
  it('extracts and parses a JSON plan from a code fence', () => {
    const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``;
    const result = parsePlanArtifact(text);
    expect(result).not.toBeNull();
    expect(result?.ticketId).toBe('T-87');
    expect(result?.taskGroups).toHaveLength(1);
    expect(result?.taskGroups[0].tasks[0].file).toBe('src/services/billing.ts');
  });

  it('returns null when no JSON fence is present', () => {
    expect(parsePlanArtifact('no plan here')).toBeNull();
    expect(parsePlanArtifact('')).toBeNull();
  });

  it('returns null when JSON fence does not contain a valid PlanArtifact', () => {
    expect(parsePlanArtifact('```json\n{"foo":"bar"}\n```')).toBeNull();
  });

  it('returns null when JSON in fence is malformed', () => {
    expect(parsePlanArtifact('```json\n{invalid json}\n```')).toBeNull();
  });

  it('handles plan with multiple task groups', () => {
    const plan: PlanArtifact = {
      ...VALID_PLAN,
      taskGroups: [
        VALID_PLAN.taskGroups[0],
        { ...VALID_PLAN.taskGroups[0], groupId: 'G2', tasks: [] },
      ],
    };
    const result = parsePlanArtifact(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``);
    expect(result?.taskGroups).toHaveLength(2);
  });

  it('works when plan JSON is the entire string with no surrounding text', () => {
    const text = `\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``;
    expect(parsePlanArtifact(text)?.ticketId).toBe('T-87');
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/lib/parsePlanArtifact.test.ts
```
Expected: FAIL — "Cannot find module './parsePlanArtifact'"

### Step 3: Create the types file

```typescript
// apps/desktop/src/types/planArtifact.ts

export interface PlanTestCase {
  name: string;
  setup: string;
  input: string;
  assertion: string;
}

export interface PlanTask {
  id: string;
  action: 'create' | 'modify' | 'delete';
  file: string;
  description: string;
  patternReference?: string;
  codeExample?: string;
  testCases?: PlanTestCase[];
}

export interface PlanTaskGroup {
  groupId: string;
  agentRole: string;
  description: string;
  tasks: PlanTask[];
  filesTouched: string[];
}

export interface PlanArtifact {
  ticketId: string;
  planVersion?: number;
  designRef?: string;
  taskGroups: PlanTaskGroup[];
  fileConflictCheck: {
    conflicts: string[];
    status: 'clean' | 'conflict';
  };
  parallelSafe: boolean;
}
```

### Step 4: Create the parser

```typescript
// apps/desktop/src/lib/parsePlanArtifact.ts
import type { PlanArtifact } from '../types/planArtifact';

/**
 * Extracts the first ```json ... ``` fence from text and parses it as a PlanArtifact.
 * Returns null if no fence is found, JSON is invalid, or the shape is not a PlanArtifact.
 */
export function parsePlanArtifact(text: string): PlanArtifact | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    return isPlanArtifact(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlanArtifact(obj: unknown): obj is PlanArtifact {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.ticketId === 'string' &&
    Array.isArray(p.taskGroups) &&
    typeof p.fileConflictCheck === 'object' &&
    p.fileConflictCheck !== null &&
    typeof p.parallelSafe === 'boolean'
  );
}
```

### Step 5: Run tests to verify they pass

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/lib/parsePlanArtifact.test.ts
```
Expected: 6 tests, all green

### Step 6: Commit

```bash
git add apps/desktop/src/types/planArtifact.ts apps/desktop/src/lib/parsePlanArtifact.ts apps/desktop/src/lib/parsePlanArtifact.test.ts
git commit -m "feat(desktop): PlanArtifact types and JSON fence parser"
```

---

## Task 2: PlanTaskNode canvas component

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/nodes/PlanTaskNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

### Step 1: Read the current canvas types file

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/types/canvas.ts
```

### Step 2: Add `'plan_task'` to CanvasNodeType and new fields to CanvasNodeData

In `canvas.ts`, find `CanvasNodeType` and add `| 'plan_task'` to the union.

Find `CanvasNodeData` and add these optional fields at the end:

```typescript
// Added for ghost graph (M2)
isGhost?: boolean;      // true = plan task not yet executed
activated?: boolean;    // true = agent has touched this file
taskId?: string;        // matches PlanTask.id
action?: 'create' | 'modify' | 'delete';
```

### Step 3: Verify TypeScript still passes

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm tsc --noEmit
```
Expected: 0 errors

### Step 4: Create PlanTaskNode component

```tsx
// apps/desktop/src/components/canvas/nodes/PlanTaskNode.tsx
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

const ACTION_COLORS = {
  create: 'text-emerald-400',
  modify: 'text-violet-400',
  delete: 'text-red-400',
} as const;

export function PlanTaskNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const activated = nodeData.activated ?? false;
  const action = (nodeData.action ?? 'modify') as keyof typeof ACTION_COLORS;
  const filePath = String(nodeData.filePath ?? '');
  // Show just the filename, not the full path
  const fileName = filePath.split('/').at(-1) ?? filePath;

  return (
    <div
      className={[
        'px-3 py-2 rounded-lg border font-mono text-xs w-52 transition-all duration-300 select-none',
        activated
          ? 'bg-zinc-800 border-violet-600 text-zinc-200'
          : 'bg-zinc-950 border-zinc-700 border-dashed text-zinc-500 opacity-50',
      ].join(' ')}
    >
      <div className={`text-[10px] uppercase tracking-wider mb-1 ${ACTION_COLORS[action]}`}>
        {action}
      </div>
      <div className="truncate font-semibold">{fileName}</div>
      <div className="truncate text-zinc-500 mt-0.5 text-[10px]">
        {String(nodeData.content).slice(0, 55)}
      </div>
    </div>
  );
}
```

### Step 5: Register PlanTaskNode in the nodeTypes map

In `apps/desktop/src/components/canvas/nodes/index.ts`, add:

```typescript
import { PlanTaskNode } from './PlanTaskNode';

// Add to the nodeTypes object:
plan_task: PlanTaskNode,
```

### Step 6: Run full test suite and TypeScript check

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run
pnpm tsc --noEmit
```
Expected: all tests pass, 0 TypeScript errors

### Step 7: Commit

```bash
git add apps/desktop/src/types/canvas.ts apps/desktop/src/components/canvas/nodes/PlanTaskNode.tsx apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat(canvas): PlanTaskNode — ghost task node, lights up when file is touched"
```

---

## Task 3: Ghost graph in canvasStore

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/src/store/canvasStore.test.ts`

### Step 1: Read both files

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/store/canvasStore.ts
cat /home/keenan/github/poietai.ai/apps/desktop/src/store/canvasStore.test.ts
```

### Step 2: Write failing tests (add to existing test file)

Add these test blocks to `canvasStore.test.ts` (keep all existing tests):

```typescript
import type { PlanArtifact } from '../types/planArtifact';
// Add this import at the top alongside existing imports

// Helper — a minimal valid PlanArtifact
function makePlan(tasks: Array<{ id: string; file: string }>): PlanArtifact {
  return {
    ticketId: 'ticket-1',
    taskGroups: [
      {
        groupId: 'G1',
        agentRole: 'engineer',
        description: 'test group',
        tasks: tasks.map(t => ({
          id: t.id,
          action: 'modify' as const,
          file: t.file,
          description: `edit ${t.file}`,
          filesTouched: [t.file],
        })),
        filesTouched: tasks.map(t => t.file),
      },
    ],
    fileConflictCheck: { conflicts: [], status: 'clean' },
    parallelSafe: true,
  };
}

describe('initGhostGraph', () => {
  it('adds one ghost plan_task node per task in the plan', () => {
    const plan = makePlan([
      { id: 'T1', file: 'src/foo.ts' },
      { id: 'T2', file: 'src/bar.ts' },
    ]);
    useCanvasStore.getState().initGhostGraph(plan);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe('plan_task');
    expect(nodes[0].data.isGhost).toBe(true);
    expect(nodes[0].data.activated).toBe(false);
    expect(nodes[0].data.filePath).toBe('src/foo.ts');
    expect(nodes[1].data.filePath).toBe('src/bar.ts');
  });

  it('ghost nodes are positioned at y=-180, spread on x axis', () => {
    const plan = makePlan([
      { id: 'T1', file: 'a.ts' },
      { id: 'T2', file: 'b.ts' },
    ]);
    useCanvasStore.getState().initGhostGraph(plan);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes[0].position.y).toBe(-180);
    expect(nodes[1].position.y).toBe(-180);
    expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
  });

  it('execution nodes are placed at y=80 even when ghost nodes exist', () => {
    const plan = makePlan([{ id: 'T1', file: 'a.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    // Add an execution node
    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: { type: 'thinking', thinking: 'hello' },
    });

    const execNode = useCanvasStore.getState().nodes.find(n => n.data.nodeType === 'thought');
    expect(execNode?.position.y).toBe(80);
    // x should start at 0, not at 340 (ghost nodes don't offset execution)
    expect(execNode?.position.x).toBe(0);
  });
});

describe('ghost node activation on file edit', () => {
  it('activates a ghost node when a matching file is edited', () => {
    const plan = makePlan([{ id: 'T1', file: 'src/foo.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: {
        type: 'tool_use',
        id: 'tu-1',
        tool_name: 'Edit',
        tool_input: { file_path: '/worktree/src/foo.ts', old_string: 'a', new_string: 'b' },
      },
    });

    const ghostNode = useCanvasStore.getState().nodes.find(n => n.data.isGhost === false && n.data.taskId === 'T1');
    // After activation isGhost becomes false
    const planNode = useCanvasStore.getState().nodes.find(n => n.data.taskId === 'T1');
    expect(planNode?.data.activated).toBe(true);
  });

  it('does not activate ghost nodes for unrelated files', () => {
    const plan = makePlan([{ id: 'T1', file: 'src/foo.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: {
        type: 'tool_use',
        id: 'tu-1',
        tool_name: 'Edit',
        tool_input: { file_path: '/worktree/src/bar.ts', old_string: 'a', new_string: 'b' },
      },
    });

    const planNode = useCanvasStore.getState().nodes.find(n => n.data.taskId === 'T1');
    expect(planNode?.data.activated).toBe(false);
    expect(planNode?.data.isGhost).toBe(true);
  });
});
```

### Step 3: Run tests to confirm new tests fail

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/store/canvasStore.test.ts
```
Expected: FAIL on the new tests (initGhostGraph not defined)

### Step 4: Update canvasStore.ts

Read the file first, then apply these changes:

**Add import at top:**
```typescript
import type { PlanArtifact } from '../types/planArtifact';
```

**Add `initGhostGraph` to the store type:**
```typescript
initGhostGraph: (planArtifact: PlanArtifact) => void;
```

**Implement `initGhostGraph`:**
```typescript
initGhostGraph: (planArtifact) => set((state) => {
  const allTasks = planArtifact.taskGroups.flatMap((g) => g.tasks);
  const ghostNodes: Node<CanvasNodeData>[] = allTasks.map((task, idx) => ({
    id: `ghost-${task.id}`,
    type: 'plan_task' as CanvasNodeType,
    position: { x: idx * 240, y: -180 },
    data: {
      nodeType: 'plan_task' as CanvasNodeType,
      agentId: '',
      ticketId: state.activeTicketId ?? '',
      content: task.description,
      filePath: task.file,
      taskId: task.id,
      isGhost: true,
      activated: false,
      action: task.action,
      items: [],
    },
  }));
  return { nodes: [...ghostNodes, ...state.nodes] };
}),
```

**Fix execution node x-position calculation** (in `addNodeFromEvent`):

Find the line that calculates `x: state.nodes.length * 340` (or similar). Change it to exclude ghost nodes:

```typescript
// Before:
position: { x: state.nodes.length * 340, y: 80 },

// After:
position: {
  x: state.nodes.filter((n) => !n.data.isGhost).length * 340,
  y: 80,
},
```

**Add ghost activation in `addNodeFromEvent`:**

Find where new execution nodes are assembled into `newNodes` (the array returned at the end of `addNodeFromEvent`'s set callback). After assembling `newNodes`, add:

```typescript
// Activate ghost nodes when a file is edited or written
let finalNodes = newNodes;
if (mappedType === 'file_edit' || mappedType === 'file_write') {
  const toolEvent = payload.kind as Extract<AgentEventKind, { type: 'tool_use' }>;
  const editedPath = String(
    toolEvent.tool_input.file_path ?? toolEvent.tool_input.path ?? ''
  );
  if (editedPath) {
    finalNodes = newNodes.map((n) => {
      if (n.data.isGhost && n.data.filePath) {
        const ghostPath = String(n.data.filePath);
        // Match on suffix — plan uses relative paths, agent uses absolute
        if (editedPath.endsWith(ghostPath) || ghostPath.endsWith(editedPath)) {
          return { ...n, data: { ...n.data, activated: true, isGhost: false } };
        }
      }
      return n;
    });
  }
}
return { nodes: finalNodes, edges: newEdges };
```

IMPORTANT: Also update the groupable-merge path. When a `file_edit`/`file_write` event merges into an existing node (groupable), still check for ghost activation — the file path is still in `tool_input`.

### Step 5: Run all tests to verify they pass

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/store/canvasStore.test.ts
```
Expected: all tests green (old 6 + new ~6 = ~12 tests)

### Step 6: Run full test suite

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run
```
Expected: all passing

### Step 7: Commit

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat(canvasStore): ghost graph — initGhostGraph, ghost activation on file edit"
```

---

## Task 4: Wire agent-result to capture artifact + advance phase

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

### Step 1: Read both files

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/components/canvas/TicketCanvas.tsx
cat /home/keenan/github/poietai.ai/apps/desktop/src/components/board/TicketCard.tsx
```

### Step 2: Update the agent-result handler in TicketCanvas.tsx

Find the `listen<AgentResultPayload>('agent-result', ...)` handler. Add artifact capture and phase advancement before the existing awaiting-check logic.

**Add imports at the top of TicketCanvas.tsx** (if not already present):
```typescript
import { parsePlanArtifact } from '../../lib/parsePlanArtifact';
import { useTicketStore } from '../../store/ticketStore';
```

**Replace the agent-result handler body:**

```typescript
listen<AgentResultPayload>('agent-result', (event) => {
  const { agent_id, ticket_id, session_id } = event.payload;

  // --- Phase lifecycle: capture artifact + advance phase ---
  const ticket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
  if (ticket?.activePhase && ticket.activePhase !== 'ship') {
    const currentNodes = useCanvasStore.getState().nodes;
    const lastTextNode = [...currentNodes]
      .reverse()
      .find((n) => n.data.nodeType === 'agent_message');

    if (lastTextNode) {
      const content = String(lastTextNode.data.content);
      // Store the phase output as an artifact
      useTicketStore.getState().setPhaseArtifact(ticket_id, {
        phase: ticket.activePhase,
        content,
        createdAt: new Date().toISOString(),
        agentId: agent_id,
      });
    }

    // Advance to the next phase
    useTicketStore.getState().advanceTicketPhase(ticket_id);
  }
  // --- End phase lifecycle ---

  // Existing: check for end-of-session question (awaiting resume)
  if (!session_id) return;
  const currentNodes = useCanvasStore.getState().nodes;
  const lastTextNode = [...currentNodes]
    .reverse()
    .find((n) => n.data.nodeType === 'agent_message');
  if (lastTextNode && String(lastTextNode.data.content).trim().endsWith('?')) {
    setAwaiting(String(lastTextNode.data.content), session_id);
  }
}),
```

### Step 3: Update TicketCard.tsx to init ghost graph on BUILD start

In `TicketCard.tsx`, find the block that runs after a successful invoke (where `assignTicket`, `updateTicketStatus`, `setActiveTicket`, `openCanvas` are called).

**Add import at the top:**
```typescript
import { parsePlanArtifact } from '../../lib/parsePlanArtifact';
import { useCanvasStore } from '../../store/canvasStore';
```

**After `setActiveTicket(ticket.id)` and BEFORE `openCanvas()`:**
```typescript
// If entering BUILD phase and a plan exists, seed the ghost graph
if (ticket.activePhase === 'build' && ticket.artifacts.plan) {
  const planArtifact = parsePlanArtifact(ticket.artifacts.plan.content);
  if (planArtifact) {
    useCanvasStore.getState().initGhostGraph(planArtifact);
  }
}
```

This must run AFTER `setActiveTicket` (which clears the canvas) so ghost nodes aren't wiped.

### Step 4: TypeScript check

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm tsc --noEmit
```
Expected: 0 errors. Fix any type errors before continuing.

### Step 5: Run full test suite

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run
```
Expected: all passing

### Step 6: Commit

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(canvas): wire agent-result → capture artifact, advance phase, init ghost graph on BUILD"
```

---

## Task 5: BUILD agent receives only the plan

**Files:**
- Modify: `apps/desktop/src/lib/promptBuilder.ts`
- Modify: `apps/desktop/src/lib/promptBuilder.test.ts`
- Modify: `apps/desktop/src/components/board/TicketCard.tsx`

### Step 1: Read the current promptBuilder files

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/lib/promptBuilder.ts
cat /home/keenan/github/poietai.ai/apps/desktop/src/lib/promptBuilder.test.ts
```

### Step 2: Write failing tests for the planContent path

Add to `promptBuilder.test.ts`:

```typescript
describe('buildPrompt with planContent', () => {
  it('uses plan as ticket section instead of description when planContent is provided', () => {
    const prompt = buildPrompt({
      role: 'backend-engineer',
      personality: 'pragmatic',
      projectName: 'MyApp',
      projectStack: 'Node.js',
      projectContext: '',
      ticketNumber: 42,
      ticketTitle: 'Fix billing',
      ticketDescription: 'this should not appear',
      ticketAcceptanceCriteria: ['criteria that should not appear'],
      agentId: 'agent-1',
      planContent: '{"taskGroups": [{"groupId": "G1", "tasks": []}]}',
    });

    expect(prompt).toContain('Execution Plan');
    expect(prompt).toContain('taskGroups');
    expect(prompt).not.toContain('this should not appear');
    expect(prompt).not.toContain('criteria that should not appear');
  });

  it('uses ticket description when planContent is not provided', () => {
    const prompt = buildPrompt({
      role: 'backend-engineer',
      personality: 'pragmatic',
      projectName: 'MyApp',
      projectStack: 'Node.js',
      projectContext: '',
      ticketNumber: 42,
      ticketTitle: 'Fix billing',
      ticketDescription: 'the description should appear',
      ticketAcceptanceCriteria: ['criteria should appear'],
      agentId: 'agent-1',
    });

    expect(prompt).toContain('the description should appear');
    expect(prompt).toContain('criteria should appear');
    expect(prompt).not.toContain('Execution Plan');
  });
});
```

### Step 3: Run tests to confirm they fail

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/lib/promptBuilder.test.ts
```
Expected: 2 new tests FAIL (planContent not yet supported)

### Step 4: Update promptBuilder.ts

Read the current file first. Then:

**Add `planContent?: string` to the input type** (whatever the input object type is called):
```typescript
planContent?: string;  // If provided, replaces ticket description — BUILD phase only
```

**In the function body, replace the ticket description section:**

Find where the ticket description and acceptance criteria are assembled into the prompt string. Replace with a conditional:

```typescript
const ticketSection = input.planContent
  ? `## Execution Plan (Source of Truth)\n\nThis is the complete, approved plan for this task. Follow it exactly.\n\n${input.planContent}`
  : `## Current Ticket\n\nTicket #${input.ticketNumber}: ${input.ticketTitle}\n\n${input.ticketDescription}\n\nAcceptance criteria:\n${
      input.ticketAcceptanceCriteria.length > 0
        ? input.ticketAcceptanceCriteria.map((c) => `- ${c}`).join('\n')
        : '- (none specified)'
    }`;
```

Use `ticketSection` in place of the previously-hardcoded ticket block in the template string.

### Step 5: Run tests to verify they pass

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run src/lib/promptBuilder.test.ts
```
Expected: all tests green (old 3 + new 2 = 5 tests)

### Step 6: Update TicketCard.tsx to pass planContent for BUILD phase

Read the current `buildPrompt(...)` call in `TicketCard.tsx`. Add `planContent`:

```typescript
const planContent =
  ticket.activePhase === 'build' && ticket.artifacts.plan
    ? ticket.artifacts.plan.content
    : undefined;

const systemPrompt = buildPrompt({
  role: agent.role,
  personality: agent.personality ?? 'pragmatic',
  projectName: project.name,
  projectStack: project.techStack,
  projectContext: '',
  ticketNumber: parseInt(ticket.id.split('-')[1] ?? '0', 10),
  ticketTitle: ticket.title,
  ticketDescription: ticket.description,
  ticketAcceptanceCriteria: ticket.acceptanceCriteria,
  agentId: agent.id,
  planContent,  // undefined for all non-BUILD phases
});
```

### Step 7: Run full test suite and TypeScript check

```bash
cd /home/keenan/github/poietai.ai/apps/desktop
pnpm test -- --run
pnpm tsc --noEmit
```
Expected: all tests pass, 0 TypeScript errors

### Step 8: Commit

```bash
git add apps/desktop/src/lib/promptBuilder.ts apps/desktop/src/lib/promptBuilder.test.ts apps/desktop/src/components/board/TicketCard.tsx
git commit -m "feat(desktop): BUILD agent receives plan artifact as execution context instead of ticket description"
```

---

## M2 Complete — Verification Checklist

Before calling M2 done, verify all of the following:

- [ ] `pnpm test -- --run` — all tests green (target: ~35+ tests)
- [ ] `pnpm tsc --noEmit` — 0 errors
- [ ] `cargo check` in `apps/desktop/src-tauri` — 0 errors
- [ ] `parsePlanArtifact` returns null for invalid input, PlanArtifact for valid JSON fence
- [ ] Ghost nodes render at `y=-180` in the canvas, execution nodes at `y=80`
- [ ] Ghost nodes have dashed border + 50% opacity; activated nodes have solid violet border + full opacity
- [ ] On BUILD phase start, ghost graph is seeded from `ticket.artifacts.plan`
- [ ] When an agent edits a planned file, the corresponding ghost node lights up
- [ ] PLAN phase output is captured as an artifact; ticket advances to BUILD phase
- [ ] BUILD agent system prompt contains "Execution Plan" section, not raw ticket description

---

## Milestone 3 Preview: VALIDATE Phase

After M2 ships:
- After BUILD: launch a fresh agent process with only `plan artifact + current diff` — no build context
- Agent extracts claims from the plan, verifies each against the code
- Returns structured `VERIFIED | MISMATCH` report per claim
- Critical mismatches block the PR; advisory mismatches attach as review comments
- Canvas shows a `VALIDATE` node after the build graph with claim count and status
