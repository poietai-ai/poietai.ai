export interface DmMessage {
  id: string;
  threadId: string;            // agentId for DMs, channelId for channels
  threadType: 'dm' | 'channel';
  from: 'agent' | 'user' | 'system';
  agentId: string;
  agentName: string;
  content: string;
  type: 'text' | 'question' | 'choices' | 'status' | 'confirm' | 'reply';
  choices?: { label: string; description: string }[];
  actionDetails?: string;
  ticketId?: string;
  timestamp: number;
  resolved?: boolean;
  resolution?: string;
}

export interface Channel {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
}
