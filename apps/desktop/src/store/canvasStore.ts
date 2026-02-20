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
    case 'result': return null;
    default: return null;
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
  const input = event.tool_input as Record<string, string>;
  return input['file_path'] ?? input['path'] ?? undefined;
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
    if (activeTicketId && payload.ticket_id !== activeTicketId) return;

    const nodeType = nodeTypeFromEvent(payload.event);
    if (!nodeType) return;

    const content = contentFromEvent(payload.event);
    const filePath = filePathFromEvent(payload.event);
    const yPosition = nodes.length * 130;

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
