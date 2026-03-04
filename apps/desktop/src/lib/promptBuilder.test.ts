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

test('prompt includes agent id in communication section', () => {
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
  expect(prompt).toContain('automated agents');
});

test('prompt includes Communication section with MCP tools', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('## Communication');
  expect(prompt).toContain('ask_human');
  expect(prompt).toContain('present_choices');
  expect(prompt).toContain('status_update');
  expect(prompt).toContain('confirm_action');
});

test('prompt includes communication style guidelines', () => {
  const prompt = buildPrompt(base);
  expect(prompt).toContain('Be concise and direct');
  expect(prompt).toContain('Include context in questions');
});

describe('personality-specific interaction coaching', () => {
  test('pragmatic personality coaches targeted questions and fast unblocking', () => {
    const prompt = buildPrompt({ ...base, personality: 'pragmatic' });
    expect(prompt).toContain('Your personality: pragmatic');
    expect(prompt).toContain('targeted question');
    expect(prompt).toContain('unblocked fast');
  });

  test('perfectionist personality coaches validating assumptions and trade-offs', () => {
    const prompt = buildPrompt({ ...base, personality: 'perfectionist' });
    expect(prompt).toContain('Your personality: perfectionist');
    expect(prompt).toContain('multiple valid approaches');
    expect(prompt).toContain('Validate assumptions');
  });

  test('ambitious personality coaches proposing bold ideas and sharing vision', () => {
    const prompt = buildPrompt({ ...base, personality: 'ambitious' });
    expect(prompt).toContain('Your personality: ambitious');
    expect(prompt).toContain('bold ideas');
    expect(prompt).toContain('vision');
  });

  test('conservative personality coaches questioning scope creep and flagging risks', () => {
    const prompt = buildPrompt({ ...base, personality: 'conservative' });
    expect(prompt).toContain('Your personality: conservative');
    expect(prompt).toContain('scope creep');
    expect(prompt).toContain('flag risks');
  });

  test('devils-advocate personality coaches challenging assumptions and edge cases', () => {
    const prompt = buildPrompt({ ...base, personality: 'devils-advocate' });
    expect(prompt).toContain('Your personality: devils-advocate');
    expect(prompt).toContain('challenge assumptions');
    expect(prompt).toContain('edge cases');
  });

  test('unknown personality falls back to natural communication', () => {
    const prompt = buildPrompt({ ...base, personality: 'unknown-type' });
    expect(prompt).toContain('Your personality: unknown-type');
    expect(prompt).toContain('Communicate naturally');
  });
});

describe('phase interaction guidance', () => {
  it('includes high-interaction guidance for BRIEF phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'brief' });
    expect(prompt).toContain('Ask frequently');
  });

  it('includes medium-interaction guidance for DESIGN phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'design' });
    expect(prompt).toContain('architectural');
  });

  it('includes low-interaction guidance for BUILD phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'build' });
    expect(prompt).toContain('sparingly');
  });

  it('includes plan-phase guidance for PLAN phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'plan' });
    expect(prompt).toContain('task breakdown');
  });

  it('includes minimal-interaction guidance for VALIDATE phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'validate' });
    expect(prompt).toContain('Minimal');
  });

  it('includes minimal-interaction guidance for QA phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'qa' });
    expect(prompt).toContain('Minimal');
  });

  it('includes minimal-interaction guidance for SECURITY phase', () => {
    const prompt = buildPrompt({ ...base, phase: 'security' });
    expect(prompt).toContain('Minimal');
  });

  it('omits phase section when phase is undefined', () => {
    const prompt = buildPrompt({ ...base });
    expect(prompt).not.toContain('Phase:');
  });
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
