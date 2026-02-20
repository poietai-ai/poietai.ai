export interface Message {
  id: string;
  from: 'agent' | 'user';
  agentId: string;
  agentName: string;
  content: string;
  timestamp: string;
  ticketId?: string;
  canvasNodeId?: string;
}
