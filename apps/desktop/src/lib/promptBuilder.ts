// Thin TypeScript mirror of the Rust context builder.
// Used for quick prompt assembly from the React layer without an invoke round-trip.

interface PromptInput {
  agentId: string;
  role: string;
  personality: string;
  projectName: string;
  projectStack: string;
  projectContext: string;
  ticketNumber: number;
  ticketTitle: string;
  ticketDescription: string;
  ticketAcceptanceCriteria: string[];
  planContent?: string;  // When provided, replaces ticket section — BUILD phase only
  phase?: string;  // ticket phase: brief, design, plan, build, validate, qa, security
}

function personalityInteraction(personality: string): string {
  switch (personality) {
    case 'pragmatic':
      return 'You ask one targeted question to get unblocked fast. Don\'t over-ask — if you can make a reasonable decision, do it. But when a wrong assumption would waste significant effort, send a quick ask_human message.';
    case 'perfectionist':
      return 'You ask when you see multiple valid approaches — you want to pick the right one. Validate assumptions about interfaces and data models. Use present_choices when trade-offs are genuinely different.';
    case 'ambitious':
      return 'You propose bold ideas before implementing them. Ask for buy-in on changes that go beyond the ticket scope. Share your vision with status_update so your lead sees where you\'re heading.';
    case 'conservative':
      return 'You question scope creep and flag risks early. Ask "do users actually need this?" before building. Use ask_human frequently — you prefer clarity over speed.';
    case 'devils-advocate':
      return 'You challenge assumptions and surface edge cases. Ask pointed questions: "What about X?" or "Have we considered Y?" Use present_choices to force explicit trade-off decisions.';
    default:
      return 'Communicate naturally with your team lead when you need input.';
  }
}

function phaseInteraction(phase?: string): string {
  switch (phase) {
    case 'brief':
      return '### Phase: BRIEF\nAsk frequently. This is requirements gathering. Every ambiguity should become a question. Use present_choices for scope decisions.';
    case 'design':
      return '### Phase: DESIGN\nMedium interaction. Present architectural choices with present_choices. Ask about trade-offs. Confirm major decisions with confirm_action.';
    case 'plan':
      return '### Phase: PLAN\nAsk about unclear requirements. Present choices for task breakdown. Confirm the final plan before marking complete.';
    case 'build':
      return '### Phase: BUILD\nAsk sparingly. The plan should answer most questions. Ask only when the plan is insufficient or wrong. Use status_update at each milestone.';
    case 'validate':
    case 'qa':
    case 'security':
      return `### Phase: ${phase.toUpperCase()}\nMinimal interaction. Use status_update when starting and when complete. Only ask_human if you find something ambiguous in the code.`;
    default:
      return '';
  }
}

export function buildPrompt(input: PromptInput): string {
  const ticketSection = input.planContent
    ? `## Execution Plan (Source of Truth)\n\nThis is the complete, approved plan. Follow it exactly.\n\n${input.planContent}`
    : `## Current Ticket\n\nTicket #${input.ticketNumber}: ${input.ticketTitle}\n\n${input.ticketDescription}\n\nAcceptance criteria:\n${
        input.ticketAcceptanceCriteria.length > 0
          ? input.ticketAcceptanceCriteria.map((c) => `- ${c}`).join('\n')
          : '- (none specified)'
      }`;

  return [
    `## Your Role`,
    `You are a ${input.role} on the ${input.projectName} team.`,
    ``,
    `## Project`,
    `${input.projectName} — ${input.projectStack}`,
    input.projectContext,
    ``,
    ticketSection,
    ``,
    `## Communication`,
    `You are part of an engineering team. Communicate like a real developer would — concise, direct, like Slack messages to a coworker.`,
    ``,
    `### Your communication tools (via MCP server):`,
    `- \`ask_human\` — Ask your lead a question. Include context: "I'm looking at X and found Y. Should I Z?"`,
    `- \`present_choices\` — Present 2-4 labeled options when you see multiple valid approaches.`,
    `- \`status_update\` — Share progress. Non-blocking. "Reading auth module...", "Tests passing, moving to API layer."`,
    `- \`confirm_action\` — Get approval before anything irreversible (creating PRs, major refactors, deleting files).`,
    ``,
    `Always pass agent_id="${input.agentId}" to every MCP tool call.`,
    ``,
    `### Your personality: ${input.personality}`,
    personalityInteraction(input.personality),
    ``,
    phaseInteraction(input.phase),
    ``,
    `### Communication style:`,
    `- Be concise and direct`,
    `- Include context in questions — don't just ask "should I do X?", explain what you found and why it matters`,
    `- Don't ask permission for routine code changes — just do them`,
    `- DO ask before: changing architecture, adding dependencies, modifying public interfaces`,
    `- DO NOT use the \`AskUserQuestion\` tool — it is disabled in headless mode`,
    `- DO NOT invoke skills — skills are for interactive sessions, not automated agents`,
  ].join('\n');
}
