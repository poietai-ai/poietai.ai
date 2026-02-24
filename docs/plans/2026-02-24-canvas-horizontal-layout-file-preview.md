# Canvas Board: Horizontal Layout + File Content Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch the canvas from a vertical node stack to a horizontal one, enable node dragging, and show file content inside file_read nodes.

**Architecture:** Nodes are positioned left-to-right (`x = index * 340, y = 80`) so expanding content grows downward without overlapping neighbors. ReactFlow's `applyNodeChanges` is wired through the store to enable dragging. `tool_result` events (currently discarded) are processed to attach file content to the preceding `file_read` node.

**Tech Stack:** React 19, @xyflow/react, Zustand, Tailwind CSS 4, Vitest

---

### Task 1: Add `fileContent` to `CanvasNodeData`

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`

No test needed — this is a type-only change.

**Step 1: Add the field**

In `CanvasNodeData`, add `fileContent?: string` after the `items` field:

```ts
export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: CanvasNodeType;
  agentId: string;
  ticketId: string;
  content: string;
  filePath?: string;
  items?: string[];
  fileContent?: string;   // ← add this line
  diff?: string;
  sessionId?: string;
  approved?: boolean;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/types/canvas.ts
git commit -m "feat(canvas): add fileContent field to CanvasNodeData"
```

---

### Task 2: Store — horizontal layout + `onNodesChange`

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Test: `apps/desktop/src/store/canvasStore.test.ts` (new file)

**Step 1: Write the failing test**

Create `apps/desktop/src/store/canvasStore.test.ts`:

```ts
import { useCanvasStore } from './canvasStore';

// Reset store between tests
beforeEach(() => {
  useCanvasStore.getState().clearCanvas();
  // Also reset activeTicketId so addNodeFromEvent works
  useCanvasStore.setState({ activeTicketId: 'ticket-1' });
});

const thoughtEvent = (id: string) => ({
  node_id: id,
  agent_id: 'agent-1',
  ticket_id: 'ticket-1',
  event: { type: 'thinking' as const, thinking: 'hmm' },
});

test('first node is placed at x=0, y=80', () => {
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
  const { nodes } = useCanvasStore.getState();
  expect(nodes[0].position).toEqual({ x: 0, y: 80 });
});

test('second node is placed at x=340, y=80', () => {
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n2'));
  const { nodes } = useCanvasStore.getState();
  expect(nodes[1].position).toEqual({ x: 340, y: 80 });
});

test('onNodesChange updates node positions', () => {
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
  useCanvasStore.getState().onNodesChange([
    { type: 'position', id: 'n1', position: { x: 50, y: 90 } },
  ]);
  const { nodes } = useCanvasStore.getState();
  expect(nodes[0].position).toEqual({ x: 50, y: 90 });
});
```

**Step 2: Run to verify failure**

```bash
cd apps/desktop && pnpm test -- --reporter=verbose src/store/canvasStore.test.ts
```

Expected: `FAIL` — `onNodesChange is not a function` and wrong x/y positions.

**Step 3: Update `canvasStore.ts`**

1. Add import at top:
```ts
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
```

2. Add `onNodesChange` to the `CanvasStore` interface:
```ts
onNodesChange: (changes: NodeChange[]) => void;
```

3. Replace the layout constant and `newNode` position inside `addNodeFromEvent`:
```ts
// Replace:
const NODE_VERTICAL_SPACING = 130;
// With:
const NODE_HORIZONTAL_SPACING = 340;
```

```ts
// Replace in addNodeFromEvent:
const yPosition = nodes.length * NODE_VERTICAL_SPACING;
// ...
position: { x: 300, y: yPosition },
// With:
const xPosition = nodes.length * NODE_HORIZONTAL_SPACING;
// ...
position: { x: xPosition, y: 80 },
```

4. Add `onNodesChange` implementation to the store object (after `clearAwaiting`):
```ts
onNodesChange: (changes) => {
  set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }));
},
```

**Step 4: Run to verify pass**

```bash
cd apps/desktop && pnpm test -- --reporter=verbose src/store/canvasStore.test.ts
```

Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat(canvas): horizontal layout and dragging via onNodesChange"
```

---

### Task 3: Store — attach file content from `tool_result` events

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/src/store/canvasStore.test.ts`

**Step 1: Write the failing test**

Add to `canvasStore.test.ts`:

```ts
const fileReadEvent = (id: string, filePath: string) => ({
  node_id: id,
  agent_id: 'agent-1',
  ticket_id: 'ticket-1',
  event: {
    type: 'tool_use' as const,
    id,
    tool_name: 'Read',
    tool_input: { file_path: filePath },
  },
});

const toolResultEvent = (toolUseId: string, content: unknown) => ({
  node_id: `result-${toolUseId}`,
  agent_id: 'agent-1',
  ticket_id: 'ticket-1',
  event: {
    type: 'tool_result' as const,
    tool_use_id: toolUseId,
    content,
  },
});

test('tool_result string content attaches to matching file_read node', () => {
  useCanvasStore.getState().addNodeFromEvent(fileReadEvent('n1', '/src/foo.ts'));
  useCanvasStore.getState().addNodeFromEvent(toolResultEvent('n1', 'export const x = 1;'));
  const { nodes } = useCanvasStore.getState();
  expect(nodes).toHaveLength(1); // no extra node created for tool_result
  expect(nodes[0].data.fileContent).toBe('export const x = 1;');
});

test('tool_result array content attaches text to file_read node', () => {
  useCanvasStore.getState().addNodeFromEvent(fileReadEvent('n2', '/src/bar.ts'));
  useCanvasStore.getState().addNodeFromEvent(
    toolResultEvent('n2', [{ type: 'text', text: 'const y = 2;' }])
  );
  const { nodes } = useCanvasStore.getState();
  expect(nodes[0].data.fileContent).toBe('const y = 2;');
});

test('tool_result for non-file-read node is ignored', () => {
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n3'));
  useCanvasStore.getState().addNodeFromEvent(toolResultEvent('n3', 'some output'));
  const { nodes } = useCanvasStore.getState();
  expect(nodes[0].data.fileContent).toBeUndefined();
});
```

**Step 2: Run to verify failure**

```bash
cd apps/desktop && pnpm test -- --reporter=verbose src/store/canvasStore.test.ts
```

Expected: 3 new tests FAIL — tool_result events currently discard or create no node, `fileContent` is never set.

**Step 3: Implement tool_result processing in `canvasStore.ts`**

Add a helper to extract text from `tool_result` content:

```ts
function textFromToolResult(content: unknown): string | undefined {
  if (typeof content === 'string') return content || undefined;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type: string; text: string } =>
        typeof c === 'object' && c !== null && (c as Record<string, unknown>)['type'] === 'text'
      )
      .map((c) => c.text);
    return texts.join('\n') || undefined;
  }
  return undefined;
}
```

In `addNodeFromEvent`, before the `nodeType` null-check early return, add a branch for `tool_result`:

```ts
// Handle tool_result — patch fileContent onto matching file_read node
if (payload.event.type === 'tool_result') {
  const { tool_use_id, content } = payload.event;
  const text = textFromToolResult(content);
  if (!text) return;
  const targetIndex = nodes.findIndex(
    (n) => n.id === tool_use_id && n.data.nodeType === 'file_read'
  );
  if (targetIndex === -1) return;
  const updated = {
    ...nodes[targetIndex],
    data: { ...nodes[targetIndex].data, fileContent: text },
  };
  set({ nodes: [...nodes.slice(0, targetIndex), updated, ...nodes.slice(targetIndex + 1)] });
  return;
}
```

This goes *before* the `const nodeType = nodeTypeFromEvent(payload.event)` line.

**Step 4: Run to verify pass**

```bash
cd apps/desktop && pnpm test -- --reporter=verbose src/store/canvasStore.test.ts
```

Expected: all 6 tests PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat(canvas): attach file content from tool_result events to file_read nodes"
```

---

### Task 4: Wire `onNodesChange` into ReactFlow

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Update the store destructure and ReactFlow props**

In `TicketCanvas.tsx`, add `onNodesChange` to the `useCanvasStore()` destructure:

```ts
const {
  nodes, edges,
  setActiveTicket, addNodeFromEvent,
  onNodesChange,   // ← add this
  awaitingQuestion, awaitingSessionId,
  setAwaiting, clearAwaiting,
} = useCanvasStore();
```

Add the prop to the `<ReactFlow>` element:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  onNodesChange={onNodesChange}   // ← add this
  fitView
  colorMode="light"
  proOptions={{ hideAttribution: true }}
>
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat(canvas): enable node dragging"
```

---

### Task 5: Flip handles to Left/Right in all node components

All four node components have `Handle type="target" position={Position.Top}` and `Handle type="source" position={Position.Bottom}`. Change both to Left/Right.

**Files:**
- Modify: `apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/FileNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/BashNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/AwaitingNode.tsx`

**Step 1: ThoughtNode.tsx**

```tsx
// Replace:
<Handle type="target" position={Position.Top} className="!bg-violet-400" />
// With:
<Handle type="target" position={Position.Left} className="!bg-violet-400" />

// Replace:
<Handle type="source" position={Position.Bottom} className="!bg-violet-400" />
// With:
<Handle type="source" position={Position.Right} className="!bg-violet-400" />
```

**Step 2: FileNode.tsx**

```tsx
// Replace:
<Handle type="target" position={Position.Top} />
// With:
<Handle type="target" position={Position.Left} />

// Replace:
<Handle type="source" position={Position.Bottom} />
// With:
<Handle type="source" position={Position.Right} />
```

**Step 3: BashNode.tsx** — same pattern as FileNode (no className on handles).

**Step 4: AwaitingNode.tsx**

```tsx
// Replace:
<Handle type="target" position={Position.Top} />
// With:
<Handle type="target" position={Position.Left} />

// Replace:
<Handle type="source" position={Position.Bottom} />
// With:
<Handle type="source" position={Position.Right} />
```

**Step 5: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/
git commit -m "feat(canvas): flip node handles to left/right for horizontal flow"
```

---

### Task 6: File content preview in FileNode

**Files:**
- Modify: `apps/desktop/src/components/canvas/nodes/FileNode.tsx`

**Step 1: Add content expand state and UI**

Replace the full `FileNode` component with this updated version:

```tsx
import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText, FilePen, FilePlus2, ChevronDown, ChevronUp, Code } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

const NODE_STYLES = {
  file_read:  { Icon: FileText,  bar: 'border-l-blue-500',    iconCls: 'text-blue-600',    verb: 'Read'   },
  file_edit:  { Icon: FilePen,   bar: 'border-l-green-500',   iconCls: 'text-green-600',   verb: 'Edited' },
  file_write: { Icon: FilePlus2, bar: 'border-l-emerald-500', iconCls: 'text-emerald-600', verb: 'Wrote'  },
} as const;

function shortPath(p: string) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

export function FileNode({ data }: NodeProps<CanvasNode>) {
  const [listExpanded, setListExpanded] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const style = NODE_STYLES[data.nodeType as keyof typeof NODE_STYLES] ?? NODE_STYLES.file_read;
  const items = (data.items as string[] | undefined) ?? (data.filePath ? [data.filePath] : []);
  const count = items.length;
  const fileContent = data.fileContent as string | undefined;
  const { Icon } = style;

  return (
    <div className={`bg-white border border-zinc-200 border-l-4 ${style.bar}
                     rounded-lg p-3 min-w-48 max-w-xs shadow-sm`}>
      <Handle type="target" position={Position.Left} />

      {/* Header row */}
      <button
        type="button"
        onClick={() => count > 1 && setListExpanded(!listExpanded)}
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
            {listExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </button>

      {/* Multi-file list */}
      {listExpanded && (
        <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto border-t border-zinc-100 pt-2">
          {items.map((item, i) => (
            <li key={i} className="text-zinc-500 text-xs font-mono truncate">
              {shortPath(item)}
            </li>
          ))}
        </ul>
      )}

      {/* File content toggle — only for file_read when content is available */}
      {data.nodeType === 'file_read' && fileContent && (
        <>
          <button
            type="button"
            onClick={() => setContentExpanded(!contentExpanded)}
            className="flex items-center gap-0.5 text-blue-500 hover:text-blue-600 text-xs mt-2"
          >
            <Code size={11} />
            <span className="ml-1">{contentExpanded ? 'hide content' : 'view content'}</span>
            {contentExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {contentExpanded && (
            <pre className="mt-2 text-zinc-600 text-xs font-mono leading-relaxed
                            max-h-72 overflow-y-auto bg-zinc-50 border border-zinc-100
                            rounded p-2 whitespace-pre-wrap break-all">
              {fileContent}
            </pre>
          )}
        </>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/FileNode.tsx
git commit -m "feat(canvas): show file content in file_read nodes"
```

---

### Task 7: Smoke test in the running app

**Step 1: Start the desktop app**

```bash
cd apps/desktop && pnpm tauri dev
```

**Step 2: Run an agent on a ticket**

Open a ticket, start an agent. Verify:
- [ ] Nodes appear left-to-right, not top-to-bottom
- [ ] Nodes can be dragged to new positions
- [ ] File read nodes show a "view content" link after the agent reads a file
- [ ] Clicking "view content" reveals the file text in a scrollable code block
- [ ] Thought nodes expand/collapse without overlapping adjacent nodes

**Step 3: Run full test suite**

```bash
cd apps/desktop && pnpm test
```

Expected: all tests pass.
