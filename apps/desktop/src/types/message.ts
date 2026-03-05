export interface Conversation {
  id: string;
  type: 'dm' | 'channel';
  name?: string;                 // channels only
  participants: string[];        // agent IDs (user is always implicit)
  locked: boolean;               // true = 1:1 (can't add members), false = group
  createdAt: number;
  lastMessageAt: number;
}

export interface DmMessage {
  id: string;
  threadId: string;              // Conversation.id
  threadType: 'dm' | 'channel';
  from: string;                  // 'user' | 'system' | 'agent' | <agentId>
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
  parentId?: string;
  replyCount?: number;
  lastReplyAt?: number;
  sessionId?: string;
}

export interface Channel {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
}
