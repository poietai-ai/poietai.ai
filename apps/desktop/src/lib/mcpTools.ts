export interface McpToolDef {
  name: string;
  description: string;
  slashCommand: boolean; // true = show in / autocomplete
}

export const MCP_TOOLS: McpToolDef[] = [
  { name: 'list_tickets', description: 'Query the ticket board', slashCommand: true },
  { name: 'get_ticket_details', description: 'Full details for a ticket', slashCommand: true },
  { name: 'ask_human', description: 'Ask the user a question', slashCommand: true },
  { name: 'status_update', description: 'Request a status update', slashCommand: true },
  { name: 'present_choices', description: 'Present options to the user', slashCommand: false },
  { name: 'confirm_action', description: 'Request approval for an action', slashCommand: false },
  { name: 'update_ticket', description: 'Update a ticket\'s fields', slashCommand: true },
  { name: 'create_ticket', description: 'Create a new ticket', slashCommand: true },
  { name: 'complete_phase', description: 'Signal phase completion', slashCommand: false },
  { name: 'claim_ticket', description: 'Claim and start working on a ticket', slashCommand: false },
  { name: 'relay_answer', description: 'Relay user answer to your coding session', slashCommand: false },
  { name: 'message_agent', description: 'Send a message to another agent', slashCommand: false },
];
