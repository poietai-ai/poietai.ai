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
}

export function buildPrompt(input: PromptInput): string {
  const criteria = input.ticketAcceptanceCriteria
    .map((c) => `- ${c}`)
    .join('\n');

  return [
    `## Your Role`,
    `You are a ${input.role} on the ${input.projectName} team.`,
    ``,
    `## Project`,
    `${input.projectName} — ${input.projectStack}`,
    input.projectContext,
    ``,
    `## Ticket #${input.ticketNumber}: ${input.ticketTitle}`,
    input.ticketDescription,
    ``,
    `Acceptance criteria:`,
    criteria || `No explicit criteria — use good judgment.`,
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
