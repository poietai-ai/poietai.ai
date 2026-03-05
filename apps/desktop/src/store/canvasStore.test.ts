import { act } from 'react';
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

test('second node is placed with correct gap after first', () => {
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
  useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n2'));
  const { nodes } = useCanvasStore.getState();
  // thought node is 384px wide + 40px gap = 424px
  expect(nodes[1].position).toEqual({ x: 424, y: 80 });
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

describe('addValidateResultNode', () => {
  it('adds a validate_result node at the correct position', () => {
    useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
    useCanvasStore.getState().addValidateResultNode({ verified: 3, critical: 0, advisory: 1 });
    const { nodes } = useCanvasStore.getState();
    const validateNode = nodes.find((n) => n.type === 'validate_result');
    expect(validateNode).toBeDefined();
    expect(validateNode?.position.y).toBe(80);
    expect(validateNode?.position.x).toBe(424); // thought(384) + gap(40)
    expect(validateNode?.data.validateSummary).toEqual({ verified: 3, critical: 0, advisory: 1 });
  });

  it('connects validate_result node to the previous node with an edge', () => {
    useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
    useCanvasStore.getState().addValidateResultNode({ verified: 1, critical: 1, advisory: 0 });
    const { edges } = useCanvasStore.getState();
    expect(edges.some((e) => e.target.startsWith('validate-result-'))).toBe(true);
  });

  it('works when canvas is empty (no previous node)', () => {
    useCanvasStore.getState().addValidateResultNode({ verified: 0, critical: 0, advisory: 0 });
    const { nodes, edges } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('validate_result');
    expect(edges).toHaveLength(0);
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

describe('addQaResultNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a qa_result node to an empty canvas', () => {
    const summary = { critical: 1, warnings: 2, advisory: 3 };
    useCanvasStore.getState().addQaResultNode(summary);
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('qa_result');
    expect(nodes[0].data.nodeType).toBe('qa_result');
    expect(nodes[0].data.qaSummary).toEqual(summary);
    expect(nodes[0].data.ticketId).toBe('ticket-1');
  });

  it('adds an edge from the last non-ghost node', () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'agent_message',
          position: { x: 0, y: 80 },
          data: { nodeType: 'agent_message', agentId: 'a1', ticketId: 'ticket-1', content: 'hello' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    useCanvasStore.getState().addQaResultNode({ critical: 0, warnings: 0, advisory: 0 });
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});

describe('addSecurityResultNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a security_result node to an empty canvas', () => {
    const summary = { critical: 1, warnings: 2 };
    act(() => useCanvasStore.getState().addSecurityResultNode(summary));
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('security_result');
    expect(nodes[0].data.nodeType).toBe('security_result');
    expect(nodes[0].data.securitySummary).toEqual(summary);
    expect(nodes[0].data.ticketId).toBe('ticket-1');
  });

  it('adds an edge from the last non-ghost node', () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'agent_message',
          position: { x: 0, y: 80 },
          data: { nodeType: 'agent_message', agentId: 'a1', ticketId: 'ticket-1', content: 'hi' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    act(() => useCanvasStore.getState().addSecurityResultNode({ critical: 0, warnings: 0 }));
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});

describe('addReviewSynthesisNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a review_synthesis node with synthesisSummary', () => {
    const summary = {
      validate: { critical: 0, verified: 5 },
      qa: { critical: 0, warnings: 1, advisory: 2 },
      security: { critical: 0, warnings: 0 },
    };
    act(() => useCanvasStore.getState().addReviewSynthesisNode(summary));
    const { nodes } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('review_synthesis');
    expect(nodes[0].data.synthesisSummary).toEqual(summary);
  });

  it('adds an edge from the last non-ghost node', () => {
    useCanvasStore.setState({
      nodes: [
        {
          id: 'prev',
          type: 'security_result',
          position: { x: 0, y: 80 },
          data: { nodeType: 'security_result', agentId: '', ticketId: 'ticket-1', content: '' },
        },
      ],
      edges: [],
      activeTicketId: 'ticket-1',
    });
    act(() => useCanvasStore.getState().addReviewSynthesisNode({
      validate: { critical: 0, verified: 0 },
      qa: { critical: 0, warnings: 0, advisory: 0 },
      security: { critical: 0, warnings: 0 },
    }));
    const { edges } = useCanvasStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('prev');
  });
});
