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
];
