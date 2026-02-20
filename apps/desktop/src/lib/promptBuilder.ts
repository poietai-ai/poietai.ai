// Thin TypeScript mirror of the Rust context builder.
// Used for quick prompt assembly from the React layer without an invoke round-trip.

interface PromptInput {
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
  ].join('\n');
}
