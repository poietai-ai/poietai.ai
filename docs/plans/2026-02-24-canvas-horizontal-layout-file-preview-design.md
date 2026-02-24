# Canvas Board: Horizontal Layout + File Content Preview

**Date:** 2026-02-24
**Status:** Approved

## Problem

The TicketCanvas board is static and hard to use:
1. Nodes can't be dragged — `ReactFlow` has no `onNodesChange` handler so position changes are lost.
2. When a node expands its content, overlaps occur because layout is a vertical stack with fixed 130px gaps.
3. File read nodes show only the file path — no way to see what the agent actually read.

## Solution

### 1. Horizontal Layout

Switch from vertical stacking (`x: 300, y: index * 130`) to horizontal stacking (`x: index * 340, y: 80`). Nodes grow downward when expanded; neighbors are unaffected.

All node handles flip from `Position.Top/Bottom` → `Position.Left/Right`. Edges become horizontal connectors.

### 2. Dragging

Add `onNodesChange` to `canvasStore` using ReactFlow's `applyNodeChanges`. Wire it into `ReactFlow` as `onNodesChange={onNodesChange}`.

### 3. File Content Preview (file_read only)

`tool_result` events arrive after each `tool_use` and contain the actual tool output — for file reads, the file content string. Currently these events are discarded (`nodeTypeFromEvent` returns `null`).

**Plan:**
- When a `tool_result` arrives, find the matching `file_read` node by `node.id === event.tool_use_id` and attach `fileContent` to its data.
- Add `fileContent?: string` to `CanvasNodeData`.
- In `FileNode`, when `data.nodeType === 'file_read'` and `fileContent` is present, show a "view content" toggle that reveals a scrollable `<pre>` code block (max-height: 300px, overflow-y: auto).

## Files Changed

| File | Change |
|------|--------|
| `types/canvas.ts` | Add `fileContent?: string` to `CanvasNodeData` |
| `store/canvasStore.ts` | Horizontal positioning, `onNodesChange` action, `tool_result` → `fileContent` patching |
| `components/canvas/TicketCanvas.tsx` | Wire `onNodesChange` into `ReactFlow` |
| `components/canvas/nodes/ThoughtNode.tsx` | Handles: Top/Bottom → Left/Right |
| `components/canvas/nodes/FileNode.tsx` | Handles: Top/Bottom → Left/Right; file content expand |
| `components/canvas/nodes/BashNode.tsx` | Handles: Top/Bottom → Left/Right |
| `components/canvas/nodes/AwaitingNode.tsx` | Handles: Top/Bottom → Left/Right |

## Out of Scope

- Auto-layout with dagre (not needed for horizontal flow)
- Edit/Write content display (read-only requested)
- Bash command output display
