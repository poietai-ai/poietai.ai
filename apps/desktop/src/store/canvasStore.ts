import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import type { CanvasNodeData, CanvasNodePayload, CanvasNodeType, AgentEventKind } from '../types/canvas';

interface CanvasStore {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  activeTicketId: string | null;
  awaitingQuestion: string | null;
  awaitingSessionId: string | null;

  setActiveTicket: (ticketId: string) => void;
  addNodeFromEvent: (payload: CanvasNodePayload) => void;
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

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  activeTicketId: null,
  awaitingQuestion: null,
  awaitingSessionId: null,

  setActiveTicket: (ticketId) => {
    set({ activeTicketId: ticketId, nodes: [], edges: [] });
  },

  addNodeFromEvent: (payload) => {
    const { nodes, edges, activeTicketId } = get();
    if (payload.ticket_id !== activeTicketId) return;

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

    const nodeType = nodeTypeFromEvent(payload.event);
    if (!nodeType) return;

    const content = contentFromEvent(payload.event);
    const filePath = filePathFromEvent(payload.event);
    const label = itemLabelFromEvent(payload.event);

    // Merge consecutive tool nodes of the same type into one grouped node.
    if (GROUPABLE.includes(nodeType) && nodes.length > 0) {
      const last = nodes[nodes.length - 1];
      if (last.data.nodeType === nodeType) {
        const prevItems = (last.data.items as string[] | undefined) ?? [];
        const updatedNode = {
          ...last,
          data: { ...last.data, items: [...prevItems, label] },
        };
        set({ nodes: [...nodes.slice(0, -1), updatedNode] });
        return;
      }
    }

    const xPosition = nodes.length * NODE_HORIZONTAL_SPACING;
    const items = GROUPABLE.includes(nodeType) ? [label] : undefined;

    const newNode: Node<CanvasNodeData> = {
      id: payload.node_id,
      type: nodeType,
      position: { x: xPosition, y: 80 },
      data: {
        nodeType,
        agentId: payload.agent_id,
        ticketId: payload.ticket_id,
        content,
        filePath,
        items,
      },
    };

    const newEdges = [...edges];
    if (nodes.length > 0) {
      const prevNode = nodes[nodes.length - 1];
      newEdges.push({
        id: `${prevNode.id}->${payload.node_id}`,
        source: prevNode.id,
        target: payload.node_id,
        type: 'smoothstep',
        style: { stroke: '#ffffff40', strokeWidth: 2 },
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
