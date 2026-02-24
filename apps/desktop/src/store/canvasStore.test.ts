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
