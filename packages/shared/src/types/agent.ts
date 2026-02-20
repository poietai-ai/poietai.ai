export type AgentRole =
  | 'product-manager'
  | 'frontend-engineer'
  | 'backend-engineer'
  | 'fullstack-engineer'
  | 'staff-engineer'
  | 'designer'
  | 'qa'
  | 'devops'
  | 'technical-writer'
  | 'security'
  | 'custom';

export type AgentPersonality =
  | 'pragmatic'
  | 'perfectionist'
  | 'ambitious'
  | 'conservative'
  | 'devils-advocate';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'reviewing' | 'waiting';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  personality: AgentPersonality;
  status: AgentStatus;
  avatar?: string;
  systemPrompt?: string;
  createdAt: string;
}
