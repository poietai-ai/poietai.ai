import { create } from 'zustand';

export interface ConversationMessage {
  id: string;
  ticketId: string;
  agentId: string;
  agentName: string;
  type: 'agent_question' | 'agent_choices' | 'agent_status' | 'agent_confirm' | 'user_reply';
  content: string;
  choices?: { label: string; description: string }[];
  actionDetails?: string;
  timestamp: number;
  resolved: boolean;
  resolution?: string;
}

interface AddMessageInput {
  ticketId: string;
  agentId: string;
  agentName: string;
  type: ConversationMessage['type'];
  content: string;
  choices?: { label: string; description: string }[];
  actionDetails?: string;
}

interface ConversationStore {
  messages: ConversationMessage[];
  addMessage: (input: AddMessageInput) => string;
  resolveMessage: (id: string, resolution: string) => void;
  messagesForTicket: (ticketId: string) => ConversationMessage[];
  unresolvedForTicket: (ticketId: string) => ConversationMessage[];
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  messages: [],

  addMessage: (input) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isAutoResolved = input.type === 'agent_status';
    const msg: ConversationMessage = {
      id,
      ...input,
      timestamp: Date.now(),
      resolved: isAutoResolved,
      resolution: isAutoResolved ? input.content : undefined,
    };
    set((state) => ({ messages: [...state.messages, msg] }));
    return id;
  },

  resolveMessage: (id, resolution) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, resolved: true, resolution } : m
      ),
    }));
  },

  messagesForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId);
  },

  unresolvedForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId && !m.resolved);
  },
}));
