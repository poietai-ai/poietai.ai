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
    `## Tool Restrictions`,
    `Do NOT use the \`AskUserQuestion\` tool — it is disabled in headless mode and will always error.`,
    `Do NOT invoke skills (brainstorming, writing-plans, debugging, etc.) — skills are for interactive sessions, not automated agents.`,
    ``,
    `## MCP Tools`,
    `You have an \`ask_human\` tool available via the poietai MCP server.`,
    `Use it when you need clarification that would meaningfully change your approach.`,
    `Always call it with agent_id="${input.agentId}" exactly.`,
  ].join('\n');
}
