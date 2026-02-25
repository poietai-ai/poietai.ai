import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import type { CanvasNodeData, CanvasNodePayload, CanvasNodeType, AgentEventKind } from '../types/canvas';
import type { PlanArtifact } from '../types/planArtifact';

interface CanvasStore {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  activeTicketId: string | null;
  awaitingQuestion: string | null;
  awaitingSessionId: string | null;

  setActiveTicket: (ticketId: string) => void;
  addNodeFromEvent: (payload: CanvasNodePayload) => void;
  initGhostGraph: (planArtifact: PlanArtifact) => void;
  addValidateResultNode: (summary: { verified: number; critical: number; advisory: number }) => void;
  addQaResultNode: (summary: { critical: number; warnings: number; advisory: number }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  setAwaiting: (question: string, sessionId: string) => void;
  clearAwaiting: () => void;
  clearCanvas: () => void;
}

// Horizontal gap between canvas nodes in pixels.
const NODE_HORIZONTAL_SPACING = 340;

// These node types are merged when consecutive: e.g. 10 Reads in a row → one "Read 10 files" node.
const GROUPABLE: CanvasNodeType[] = ['file_read', 'bash_command', 'file_edit', 'file_write'];

function nodeTypeFromEvent(event: AgentEventKind): CanvasNodeType | null {
  switch (event.type) {
    case 'thinking': return 'thought';
    case 'text': return 'agent_message';
    case 'tool_use':
      switch (event.tool_name) {
        case 'Read': return 'file_read';
        case 'Edit': return 'file_edit';
        case 'Write': return 'file_write';
        default: return 'bash_command';
      }
    case 'tool_result': return null; // internal plumbing, not a canvas node
    case 'result': return null;      // session-end signal, handled by AskUserOverlay
  }
}

function contentFromEvent(event: AgentEventKind): string {
  switch (event.type) {
    case 'thinking': return event.thinking;
    case 'text': return event.text;
    case 'tool_use': return JSON.stringify(event.tool_input, null, 2);
    default: return '';
  }
}

function filePathFromEvent(event: AgentEventKind): string | undefined {
  if (event.type !== 'tool_use') return undefined;
  const raw = event.tool_input['file_path'] ?? event.tool_input['path'];
  return typeof raw === 'string' ? raw : undefined;
}

/** Human-readable label for a tool call — used as the item label in grouped nodes. */
function itemLabelFromEvent(event: AgentEventKind): string {
  if (event.type !== 'tool_use') return '';
  const fp = filePathFromEvent(event);
  if (fp) return fp;
  const cmd = event.tool_input['command'];
  if (typeof cmd === 'string') return cmd;
  const pattern = event.tool_input['pattern'];
  if (typeof pattern === 'string') return pattern;
  return JSON.stringify(event.tool_input).slice(0, 80);
}

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

/** Derive a stable node id from the payload. */
function nodeIdFromPayload(payload: CanvasNodePayload): string {
  if (payload.node_id) return payload.node_id;
  if (payload.kind.type === 'tool_use') return payload.kind.id;
  // Fallback: timestamp-based id
  return `${payload.agent_id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  activeTicketId: null,
  awaitingQuestion: null,
  awaitingSessionId: null,

  setActiveTicket: (ticketId) => {
    set({ activeTicketId: ticketId, nodes: [], edges: [] });
  },

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

  addNodeFromEvent: (payload) => {
    const { nodes, edges, activeTicketId } = get();
    if (payload.ticket_id !== activeTicketId) return;

    // Handle tool_result — patch fileContent onto matching file_read node
    if (payload.kind.type === 'tool_result') {
      const { tool_use_id, content } = payload.kind;
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

    const mappedType = nodeTypeFromEvent(payload.kind);
    if (!mappedType) return;

    const content = contentFromEvent(payload.kind);
    const filePath = filePathFromEvent(payload.kind);
    const label = itemLabelFromEvent(payload.kind);
    const nodeId = nodeIdFromPayload(payload);

    let newNodes: Node<CanvasNodeData>[];
    let newEdges = [...edges];

    // Merge consecutive tool nodes of the same type into one grouped node.
    if (GROUPABLE.includes(mappedType) && nodes.length > 0) {
      // Find last non-ghost node
      const lastNonGhost = [...nodes].reverse().find((n) => !n.data.isGhost);
      if (lastNonGhost && lastNonGhost.data.nodeType === mappedType) {
        const lastIdx = nodes.lastIndexOf(lastNonGhost);
        const prevItems = (lastNonGhost.data.items as string[] | undefined) ?? [];
        const updatedNode = {
          ...lastNonGhost,
          data: { ...lastNonGhost.data, items: [...prevItems, label] },
        };
        newNodes = [...nodes.slice(0, lastIdx), updatedNode, ...nodes.slice(lastIdx + 1)];
        // No new edges needed when merging
        // Still run ghost activation below
        const isFileEdit = mappedType === 'file_edit' || mappedType === 'file_write';
        if (isFileEdit && payload.kind.type === 'tool_use') {
          const editedPath = String(
            (payload.kind.tool_input['file_path'] ?? payload.kind.tool_input['path']) ?? ''
          );
          if (editedPath) {
            newNodes = newNodes.map((n) => {
              if (n.data.isGhost && n.data.filePath) {
                const ghostPath = String(n.data.filePath);
                if (
                  editedPath.endsWith(ghostPath) ||
                  ghostPath.endsWith(editedPath) ||
                  editedPath === ghostPath
                ) {
                  return { ...n, data: { ...n.data, activated: true, isGhost: false } };
                }
              }
              return n;
            });
          }
        }
        set({ nodes: newNodes, edges: newEdges });
        return;
      }
    }

    // Count only non-ghost nodes for execution layout
    const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;
    const items = GROUPABLE.includes(mappedType) ? [label] : undefined;

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: mappedType,
      position: { x: xPosition, y: 80 },
      data: {
        nodeType: mappedType,
        agentId: payload.agent_id,
        ticketId: payload.ticket_id,
        content,
        filePath,
        items,
      },
    };

    if (nodes.length > 0) {
      // Connect from last non-ghost node (or last node if all ghost)
      const prevNode = [...nodes].reverse().find((n) => !n.data.isGhost) ?? nodes[nodes.length - 1];
      newEdges.push({
        id: `${prevNode.id}->${nodeId}`,
        source: prevNode.id,
        target: nodeId,
        type: 'smoothstep',
        style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
      });
    }

    newNodes = [...nodes, newNode];

    // Activate matching ghost nodes when a file is edited or written
    const isFileEdit = mappedType === 'file_edit' || mappedType === 'file_write';
    if (isFileEdit && payload.kind.type === 'tool_use') {
      const editedPath = String(
        (payload.kind.tool_input['file_path'] ?? payload.kind.tool_input['path']) ?? ''
      );
      if (editedPath) {
        newNodes = newNodes.map((n) => {
          if (n.data.isGhost && n.data.filePath) {
            const ghostPath = String(n.data.filePath);
            if (
              editedPath.endsWith(ghostPath) ||
              ghostPath.endsWith(editedPath) ||
              editedPath === ghostPath
            ) {
              return { ...n, data: { ...n.data, activated: true, isGhost: false } };
            }
          }
          return n;
        });
      }
    }

    set({ nodes: newNodes, edges: newEdges });
  },

  addValidateResultNode: (summary) => {
    const { nodes, edges, activeTicketId } = get();
    const nodeId = `validate-result-${Date.now()}`;
    const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'validate_result' as CanvasNodeType,
      position: { x: xPosition, y: 80 },
      data: {
        nodeType: 'validate_result' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        validateSummary: summary,
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

  setAwaiting: (question, sessionId) => {
    set({ awaitingQuestion: question, awaitingSessionId: sessionId });
  },

  clearAwaiting: () => {
    set({ awaitingQuestion: null, awaitingSessionId: null });
  },

  onNodesChange: (changes) => {
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) as Node<CanvasNodeData>[] }));
  },

  clearCanvas: () => {
    set({ nodes: [], edges: [] });
  },
}));
