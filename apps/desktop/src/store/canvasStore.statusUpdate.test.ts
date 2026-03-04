import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

describe('addStatusUpdateNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
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

  it('positions node using NODE_HORIZONTAL_SPACING', () => {
    // Seed two non-ghost nodes so the new one is at index 2
    useCanvasStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'thought',
          position: { x: 0, y: 80 },
          data: { nodeType: 'thought' as const, agentId: '', ticketId: 'ticket-1', content: '', items: [] },
        },
        {
          id: 'n2',
          type: 'thought',
          position: { x: 340, y: 80 },
          data: { nodeType: 'thought' as const, agentId: '', ticketId: 'ticket-1', content: '', items: [] },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });

    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Deploying...');
    const nodes = useCanvasStore.getState().nodes;
    const statusNode = nodes.find((n) => n.data.nodeType === 'status_update');
    expect(statusNode).toBeDefined();
    // 2 existing non-ghost nodes * 340 spacing = 680
    expect(statusNode!.position.x).toBe(680);
  });
});
