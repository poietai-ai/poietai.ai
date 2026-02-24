import { useCanvasStore } from './canvasStore';
import type { PlanArtifact } from '../types/planArtifact';

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
  kind: { type: 'thinking' as const, thinking: 'hmm' },
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
  kind: {
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
  kind: {
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

// Helper — a minimal valid PlanArtifact
function makePlan(tasks: Array<{ id: string; file: string }>): PlanArtifact {
  return {
    ticketId: 'ticket-1',
    taskGroups: [
      {
        groupId: 'G1',
        agentRole: 'engineer',
        description: 'test group',
        tasks: tasks.map((t) => ({
          id: t.id,
          action: 'modify' as const,
          file: t.file,
          description: `edit ${t.file}`,
        })),
        filesTouched: tasks.map((t) => t.file),
      },
    ],
    fileConflictCheck: { conflicts: [], status: 'clean' },
    parallelSafe: true,
  };
}

describe('initGhostGraph', () => {
  it('adds one ghost plan_task node per task in the plan', () => {
    const plan = makePlan([
      { id: 'T1', file: 'src/foo.ts' },
      { id: 'T2', file: 'src/bar.ts' },
    ]);
    useCanvasStore.getState().initGhostGraph(plan);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe('plan_task');
    expect(nodes[0].data.isGhost).toBe(true);
    expect(nodes[0].data.activated).toBe(false);
    expect(nodes[0].data.filePath).toBe('src/foo.ts');
    expect(nodes[1].data.filePath).toBe('src/bar.ts');
  });

  it('ghost nodes are positioned at y=-180, spread on x axis', () => {
    const plan = makePlan([
      { id: 'T1', file: 'a.ts' },
      { id: 'T2', file: 'b.ts' },
    ]);
    useCanvasStore.getState().initGhostGraph(plan);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes[0].position.y).toBe(-180);
    expect(nodes[1].position.y).toBe(-180);
    expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
  });

  it('execution nodes are placed at y=80 even when ghost nodes exist', () => {
    const plan = makePlan([{ id: 'T1', file: 'a.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: { type: 'thinking', thinking: 'hello' },
    });

    const execNode = useCanvasStore.getState().nodes.find(
      (n) => n.data.nodeType === 'thought'
    );
    expect(execNode?.position.y).toBe(80);
    // Ghost nodes don't push execution nodes to the right
    expect(execNode?.position.x).toBe(0);
  });
});

describe('ghost node activation on file edit', () => {
  it('activates a ghost node when a matching file is edited', () => {
    const plan = makePlan([{ id: 'T1', file: 'src/foo.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: {
        type: 'tool_use',
        id: 'tu-1',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/worktree/src/foo.ts',
          old_string: 'a',
          new_string: 'b',
        },
      },
    });

    const planNode = useCanvasStore
      .getState()
      .nodes.find((n) => n.data.taskId === 'T1');
    expect(planNode?.data.activated).toBe(true);
    expect(planNode?.data.isGhost).toBe(false);
  });

  it('does not activate ghost nodes for unrelated files', () => {
    const plan = makePlan([{ id: 'T1', file: 'src/foo.ts' }]);
    useCanvasStore.getState().initGhostGraph(plan);

    useCanvasStore.getState().addNodeFromEvent({
      ticket_id: 'ticket-1',
      agent_id: 'agent-1',
      kind: {
        type: 'tool_use',
        id: 'tu-1',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/worktree/src/bar.ts',
          old_string: 'a',
          new_string: 'b',
        },
      },
    });

    const planNode = useCanvasStore
      .getState()
      .nodes.find((n) => n.data.taskId === 'T1');
    expect(planNode?.data.activated).toBe(false);
    expect(planNode?.data.isGhost).toBe(true);
  });
});
