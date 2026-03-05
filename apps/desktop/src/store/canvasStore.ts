import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { readProjectStore, writeProjectStore } from '../lib/projectFileIO';
import { getActiveProjectRoot } from './projectStore';
import type { CanvasNodeData, CanvasNodePayload, CanvasNodeType, CanvasPhase, AgentEventKind } from '../types/canvas';
import type { PlanArtifact } from '../types/planArtifact';
import type { LayoutState } from '../lib/canvasLayout';
import {
  createLayoutState,
  placeNode,
  placeFanOut as layoutFanOut,
  placeFanIn as layoutFanIn,
  rebuildLayoutState,
  inferPhase,
  generatePhaseBoxes,
} from '../lib/canvasLayout';
import { useTicketStore } from './ticketStore';

interface CanvasStore {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  activeTicketId: string | null;
  awaitingQuestion: string | null;
  awaitingSessionId: string | null;
  laneAssignments: Record<string, number>;
  layoutState: LayoutState;

  setActiveTicket: (ticketId: string) => void;
  addNodeFromEvent: (payload: CanvasNodePayload) => void;
  initGhostGraph: (planArtifact: PlanArtifact) => void;
  addValidateResultNode: (summary: { verified: number; critical: number; advisory: number }) => void;
  addQaResultNode: (summary: { critical: number; warnings: number; advisory: number }) => void;
  addSecurityResultNode: (summary: { critical: number; warnings: number }) => void;
  addReviewSynthesisNode: (summary: {
    validate: { critical: number; verified: number };
    qa: { critical: number; warnings: number; advisory: number };
    security: { critical: number; warnings: number };
  }) => void;
  addStatusUpdateNode: (agentId: string, message: string) => void;
  addFanOutNode: (ticketId: string, groups: { group_id: string; agent_role: string }[]) => void;
  addFanInNode: (ticketId: string, mergeStatus: string) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  setAwaiting: (question: string, sessionId: string) => void;
  clearAwaiting: () => void;
  relayoutAllNodes: () => void;
  clearCanvas: () => void;
  resetForProjectSwitch: () => void;
}

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

/** Look up the active phase for a ticket from ticketStore. */
function getTicketPhase(ticketId: string): CanvasPhase | undefined {
  const ticket = useTicketStore.getState().tickets.find((t) => t.id === ticketId);
  return ticket?.activePhase as CanvasPhase | undefined;
}

const CANVAS_PERSIST_DEBOUNCE_MS = 1000;

type CanvasData = Record<string, { nodes: Node<CanvasNodeData>[]; edges: Edge[]; layoutState?: LayoutState }>;

/** Strip ReactFlow runtime fields — keep only what we need to restore. */
function serializeNodes(nodes: Node<CanvasNodeData>[]): Array<{ id: string; type: string; position: { x: number; y: number }; data: CanvasNodeData }> {
  return nodes.map(({ id, type, position, data }) => ({ id, type: type ?? 'default', position, data }));
}

let canvasPersistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistCanvas(get: () => CanvasStore) {
  if (canvasPersistTimer) clearTimeout(canvasPersistTimer);
  canvasPersistTimer = setTimeout(async () => {
    const { activeTicketId, nodes, edges, layoutState } = get();
    if (!activeTicketId) return;
    const root = getActiveProjectRoot();
    if (!root) return;
    try {
      const all = (await readProjectStore<CanvasData>(root, 'canvas.json')) ?? {};
      all[activeTicketId] = { nodes: serializeNodes(nodes) as Node<CanvasNodeData>[], edges, layoutState };
      await writeProjectStore(root, 'canvas.json', all);
    } catch (e) {
      console.warn('failed to persist canvas:', e);
    }
  }, CANVAS_PERSIST_DEBOUNCE_MS);
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  activeTicketId: null,
  awaitingQuestion: null,
  awaitingSessionId: null,
  laneAssignments: {},
  layoutState: createLayoutState(),

  setActiveTicket: (ticketId) => {
    const { activeTicketId, nodes, edges, layoutState } = get();
    // If already viewing this ticket, no-op — avoids clearing in-memory nodes
    if (ticketId === activeTicketId) return;
    const root = getActiveProjectRoot();
    // Save current ticket's canvas immediately (not debounced)
    if (activeTicketId && nodes.length > 0 && root) {
      readProjectStore<CanvasData>(root, 'canvas.json')
        .then((all) => {
          const updated = all ?? {};
          updated[activeTicketId] = { nodes: serializeNodes(nodes) as Node<CanvasNodeData>[], edges, layoutState };
          return writeProjectStore(root, 'canvas.json', updated);
        })
        .catch((e) => console.warn('failed to save canvas on switch:', e));
    }
    // Clear canvas and set new ticket
    set({ activeTicketId: ticketId, nodes: [], edges: [], laneAssignments: {}, layoutState: createLayoutState() });
    // Load new ticket's canvas
    if (root) {
      readProjectStore<CanvasData>(root, 'canvas.json')
        .then((all) => {
          const saved = all?.[ticketId];
          if (saved && get().activeTicketId === ticketId) {
            // Restore layoutState or rebuild from old data
            const restoredLayout = saved.layoutState ?? rebuildLayoutState(saved.nodes);
            set({ nodes: saved.nodes, edges: saved.edges, layoutState: restoredLayout });
          }
        })
        .catch((e) => console.warn('failed to load canvas:', e));
    }
  },

  initGhostGraph: (planArtifact) => {
    set((state) => {
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
          phase: 'plan' as CanvasPhase,
        },
      }));
      return { nodes: [...ghostNodes, ...state.nodes] };
    });
    debouncedPersistCanvas(get);
  },

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
      debouncedPersistCanvas(get);
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
        debouncedPersistCanvas(get);
        return;
      }
    }

    // Lane-aware positioning via layout engine
    const groupId = payload.group_id;
    const { layoutState } = get();
    const laneId = (groupId && groupId in layoutState.nextX) ? groupId : '';
    const placed = placeNode(layoutState, laneId, mappedType, content);

    const items = GROUPABLE.includes(mappedType) ? [label] : undefined;

    const phase = getTicketPhase(payload.ticket_id) ?? inferPhase(mappedType);

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: mappedType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: mappedType,
        agentId: payload.agent_id,
        ticketId: payload.ticket_id,
        content,
        filePath,
        items,
        groupId,
        phase,
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
    debouncedPersistCanvas(get);
  },

  addValidateResultNode: (summary) => {
    const { nodes, edges, activeTicketId, layoutState } = get();
    const nodeId = `validate-result-${Date.now()}`;
    const placed = placeNode(layoutState, '', 'validate_result');

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'validate_result' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'validate_result' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        validateSummary: summary,
        items: [],
        phase: 'validate' as CanvasPhase,
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
    debouncedPersistCanvas(get);
  },

  addQaResultNode: (summary) => {
    const { nodes, edges, activeTicketId, layoutState } = get();
    const nodeId = `qa-result-${Date.now()}`;
    const placed = placeNode(layoutState, '', 'qa_result');

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'qa_result' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'qa_result' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        qaSummary: summary,
        items: [],
        phase: 'qa' as CanvasPhase,
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
    debouncedPersistCanvas(get);
  },

  addSecurityResultNode: (summary) => {
    const { nodes, edges, activeTicketId, layoutState } = get();
    const nodeId = `security-result-${Date.now()}`;
    const placed = placeNode(layoutState, '', 'security_result');
    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'security_result' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'security_result' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        securitySummary: summary,
        items: [],
        phase: 'security' as CanvasPhase,
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
    debouncedPersistCanvas(get);
  },

  addReviewSynthesisNode: (summary) => {
    const { nodes, edges, activeTicketId, layoutState } = get();
    const nodeId = `review-synthesis-${Date.now()}`;
    const placed = placeNode(layoutState, '', 'review_synthesis');
    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'review_synthesis' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'review_synthesis' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        synthesisSummary: summary,
        items: [],
        phase: 'ship' as CanvasPhase,
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
    debouncedPersistCanvas(get);
  },

  addStatusUpdateNode: (agentId, message) => {
    const { nodes, edges, activeTicketId, layoutState } = get();
    const nodeId = `status-${agentId}-${Date.now()}`;
    const placed = placeNode(layoutState, '', 'status_update', message);
    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'status_update' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'status_update' as CanvasNodeType,
        agentId,
        ticketId: activeTicketId ?? '',
        content: message,
        items: [],
        phase: (activeTicketId ? getTicketPhase(activeTicketId) : undefined) ?? inferPhase('status_update'),
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
    debouncedPersistCanvas(get);
  },

  addFanOutNode: (ticketId, groups) => {
    const { nodes, edges, layoutState } = get();

    // Build lane assignments: each group gets an index (0, 1, 2...)
    const newLaneAssignments: Record<string, number> = {};
    groups.forEach((g, idx) => {
      newLaneAssignments[g.group_id] = idx;
    });

    const placed = layoutFanOut(layoutState, groups);
    const nodeId = `fan-out-${Date.now()}`;
    const content = groups.map((g) => `${g.group_id}: ${g.agent_role}`).join('\n');

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'fan_out' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'fan_out' as CanvasNodeType,
        agentId: '',
        ticketId,
        content,
        groups,
        items: [],
        phase: 'build' as CanvasPhase,
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

    set({ nodes: [...nodes, newNode], edges: newEdges, laneAssignments: newLaneAssignments });
    debouncedPersistCanvas(get);
  },

  addFanInNode: (ticketId, mergeStatus) => {
    const { nodes, edges, laneAssignments, layoutState } = get();

    const groupIds = Object.keys(laneAssignments);
    const placed = layoutFanIn(layoutState, groupIds);
    const nodeId = `fan-in-${Date.now()}`;

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'fan_in' as CanvasNodeType,
      position: { x: placed.x, y: placed.y },
      data: {
        nodeType: 'fan_in' as CanvasNodeType,
        agentId: '',
        ticketId,
        content: mergeStatus,
        mergeStatus,
        items: [],
        phase: 'build' as CanvasPhase,
      },
    };

    const newEdges = [...edges];

    // Connect last node in EACH lane to the fan-in node
    const connectedSources = new Set<string>();
    for (const gid of groupIds) {
      const lastInLane = [...nodes].reverse().find(
        (n) => !n.data.isGhost && n.data.groupId === gid
      );
      if (lastInLane && !connectedSources.has(lastInLane.id)) {
        connectedSources.add(lastInLane.id);
        newEdges.push({
          id: `${lastInLane.id}->${nodeId}`,
          source: lastInLane.id,
          target: nodeId,
          type: 'smoothstep',
          style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
        });
      }
    }

    // Also connect from the last non-ghost default-lane node if not already connected
    if (connectedSources.size === 0 && nodes.length > 0) {
      const prevNode = [...nodes].reverse().find((n) => !n.data.isGhost) ?? nodes[nodes.length - 1];
      newEdges.push({
        id: `${prevNode.id}->${nodeId}`,
        source: prevNode.id,
        target: nodeId,
        type: 'smoothstep',
        style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
      });
    }

    set({ nodes: [...nodes, newNode], edges: newEdges, laneAssignments: {} });
    debouncedPersistCanvas(get);
  },

  relayoutAllNodes: () => {
    const { nodes, edges } = get();

    // 1. Filter out old phase boxes
    const withoutBoxes = nodes.filter((n) => !n.data.isPhaseBox);

    // 2. Separate ghosts from work nodes
    const ghosts = withoutBoxes.filter((n) => n.data.isGhost);
    const workNodes = withoutBoxes.filter((n) => !n.data.isGhost);

    // 3. Fresh layout state
    const layout = createLayoutState();

    // 4. Walk work nodes in array order and re-position
    const relocated: Node<CanvasNodeData>[] = [];
    for (const node of workNodes) {
      const nodeType = node.data.nodeType;
      const content = node.data.content;
      const items = node.data.items;
      const phase = node.data.phase ?? inferPhase(nodeType);

      let placed;
      if (nodeType === 'fan_out' && node.data.groups) {
        placed = layoutFanOut(layout, node.data.groups as { group_id: string; agent_role: string }[]);
      } else if (nodeType === 'fan_in') {
        const activeGroupIds = layout.laneOrder.filter((id) => id !== '');
        placed = layoutFanIn(layout, activeGroupIds);
      } else {
        const laneId = (node.data.groupId && node.data.groupId in layout.nextX)
          ? node.data.groupId as string
          : '';
        placed = placeNode(layout, laneId, nodeType, content, items);
      }

      relocated.push({
        ...node,
        position: { x: placed.x, y: placed.y },
        data: { ...node.data, phase },
      });
    }

    // 5. Re-position ghost nodes at y=-180
    const repositionedGhosts = ghosts.map((n, idx) => ({
      ...n,
      position: { x: idx * 240, y: -180 },
    }));

    // 6. Generate phase boxes
    const phaseBoxes = generatePhaseBoxes(relocated);

    // 7. Rebuild edges between work nodes (preserve order)
    const newEdges: Edge[] = [];
    for (let i = 1; i < relocated.length; i++) {
      const prev = relocated[i - 1];
      const curr = relocated[i];
      // If current is fan_in, connect from last node in each lane
      if (curr.data.nodeType === 'fan_in') {
        // Find matching edges from original that target this node
        const originalIncoming = edges.filter((e) => e.target === curr.id);
        for (const oe of originalIncoming) {
          const sourceExists = relocated.some((n) => n.id === oe.source);
          if (sourceExists) {
            newEdges.push(oe);
          }
        }
        if (!newEdges.some((e) => e.target === curr.id)) {
          newEdges.push({
            id: `${prev.id}->${curr.id}`,
            source: prev.id,
            target: curr.id,
            type: 'smoothstep',
            style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
          });
        }
      } else {
        newEdges.push({
          id: `${prev.id}->${curr.id}`,
          source: prev.id,
          target: curr.id,
          type: 'smoothstep',
          style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
        });
      }
    }

    set({
      nodes: [...phaseBoxes, ...repositionedGhosts, ...relocated],
      edges: newEdges,
      layoutState: layout,
    });
    debouncedPersistCanvas(get);
  },

  setAwaiting: (question, sessionId) => {
    set({ awaitingQuestion: question, awaitingSessionId: sessionId });
  },

  clearAwaiting: () => {
    set({ awaitingQuestion: null, awaitingSessionId: null });
  },

  onNodesChange: (changes) => {
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) as Node<CanvasNodeData>[] }));
    debouncedPersistCanvas(get);
  },

  clearCanvas: () => {
    set({ nodes: [], edges: [], laneAssignments: {}, layoutState: createLayoutState() });
    debouncedPersistCanvas(get);
  },

  resetForProjectSwitch: () => {
    if (canvasPersistTimer) { clearTimeout(canvasPersistTimer); canvasPersistTimer = null; }
    set({ nodes: [], edges: [], activeTicketId: null, awaitingQuestion: null, awaitingSessionId: null, laneAssignments: {}, layoutState: createLayoutState() });
  },
}));
