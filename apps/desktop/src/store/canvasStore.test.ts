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
