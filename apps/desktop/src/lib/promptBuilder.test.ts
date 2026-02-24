import { buildPrompt } from './promptBuilder';

const base = {
  agentId: 'agent-abc',
  role: 'backend-engineer',
  personality: 'pragmatic',
  projectName: 'MyApp',
  projectStack: 'Go, PostgreSQL',
  projectContext: '',
  ticketNumber: 1,
  ticketTitle: 'Fix bug',
  ticketDescription: 'The thing is broken.',
  ticketAcceptanceCriteria: [],
};

test('prompt includes agent id in MCP section', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('agent-abc');
  expect(prompt).toContain('ask_human');
});

test('prompt suppresses AskUserQuestion', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('AskUserQuestion');
  expect(prompt).toContain('disabled');
});

test('prompt suppresses skills', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('skills');
  expect(prompt).toContain('automated agent');
});

describe('buildPrompt with planContent', () => {
  it('uses plan as ticket section instead of description when planContent is provided', () => {
    const prompt = buildPrompt({
      role: 'backend-engineer',
      personality: 'pragmatic',
      projectName: 'MyApp',
      projectStack: 'Node.js',
      projectContext: '',
      ticketNumber: 42,
      ticketTitle: 'Fix billing',
      ticketDescription: 'this should not appear',
      ticketAcceptanceCriteria: ['criteria that should not appear'],
      agentId: 'agent-1',
      planContent: '{"taskGroups": [{"groupId": "G1", "tasks": []}]}',
    });

    expect(prompt).toContain('Execution Plan');
    expect(prompt).toContain('taskGroups');
    expect(prompt).not.toContain('this should not appear');
    expect(prompt).not.toContain('criteria that should not appear');
  });

  it('uses ticket description when planContent is not provided', () => {
    const prompt = buildPrompt({
      role: 'backend-engineer',
      personality: 'pragmatic',
      projectName: 'MyApp',
      projectStack: 'Node.js',
      projectContext: '',
      ticketNumber: 42,
      ticketTitle: 'Fix billing',
      ticketDescription: 'the description should appear',
      ticketAcceptanceCriteria: ['criteria should appear'],
      agentId: 'agent-1',
    });

    expect(prompt).toContain('the description should appear');
    expect(prompt).toContain('criteria should appear');
    expect(prompt).not.toContain('Execution Plan');
  });
});
