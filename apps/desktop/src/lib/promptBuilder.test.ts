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
