import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { createLayoutState, rebuildLayoutState } from '../lib/canvasLayout';

describe('addStatusUpdateNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1', layoutState: createLayoutState() });
  });

  it('adds a status_update node', () => {
    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Reading files...');
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.nodeType).toBe('status_update');
    expect(nodes[0].data.content).toBe('Reading files...');
  });

  it('uses agentId in node id', () => {
    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Compiling...');
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes[0].id).toContain('agent-1');
  });

  it('creates an edge from the previous non-ghost node', () => {
    // Seed a prior node
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev-node',
          type: 'thought',
          position: { x: 0, y: 80 },
          data: {
            nodeType: 'thought' as const,
            agentId: 'agent-1',
            ticketId: 'ticket-1',
            content: 'thinking...',
            items: [],
          },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });

    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Running tests...');
    const edges = useCanvasStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev-node');
    expect(edges[0].target).toContain('agent-1');
  });

  it('positions node using layout engine', () => {
    // Seed two non-ghost nodes so the new one is placed after them
    const seededNodes = [
      {
        id: 'n1',
        type: 'thought',
        position: { x: 0, y: 80 },
        data: { nodeType: 'thought' as const, agentId: '', ticketId: 'ticket-1', content: '', items: [] },
      },
      {
        id: 'n2',
        type: 'thought',
        position: { x: 424, y: 80 },
        data: { nodeType: 'thought' as const, agentId: '', ticketId: 'ticket-1', content: '', items: [] },
      },
    ];
    useCanvasStore.setState({
      nodes: seededNodes,
      edges: [],
      activeTicketId: 'ticket-1',
      layoutState: rebuildLayoutState(seededNodes),
    });

    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Deploying...');
    const nodes = useCanvasStore.getState().nodes;
    const statusNode = nodes.find((n) => n.data.nodeType === 'status_update');
    expect(statusNode).toBeDefined();
    // n2 at x=424, width=384, gap=40 → next at 848
    expect(statusNode!.position.x).toBe(848);
  });
});
