import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { CanvasNodeData, CanvasNodePayload, CanvasNodeType, AgentEventKind } from '../types/canvas';

interface CanvasStore {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  activeTicketId: string | null;
  awaitingQuestion: string | null;
  awaitingSessionId: string | null;

  setActiveTicket: (ticketId: string) => void;
  addNodeFromEvent: (payload: CanvasNodePayload) => void;
  setAwaiting: (question: string, sessionId: string) => void;
  clearAwaiting: () => void;
  clearCanvas: () => void;
}

// Vertical gap between canvas nodes in pixels.
const NODE_VERTICAL_SPACING = 130;

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
    // Only add nodes when a ticket canvas is active and the event matches it
    if (payload.ticket_id !== activeTicketId) return;

    const nodeType = nodeTypeFromEvent(payload.event);
    if (!nodeType) return;

    const content = contentFromEvent(payload.event);
    const filePath = filePathFromEvent(payload.event);
    const yPosition = nodes.length * NODE_VERTICAL_SPACING;

    const newNode: Node<CanvasNodeData> = {
      id: payload.node_id,
      type: nodeType,
      position: { x: 300, y: yPosition },
      data: {
        nodeType,
        agentId: payload.agent_id,
        ticketId: payload.ticket_id,
        content,
        filePath,
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

  clearCanvas: () => {
    set({ nodes: [], edges: [] });
  },
}));
