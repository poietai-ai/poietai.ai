import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export interface ConversationMessage {
  id: string;
  ticketId: string;
  agentId: string;
  agentName: string;
  type: 'agent_message' | 'agent_question' | 'agent_choices' | 'agent_status' | 'agent_confirm' | 'user_reply';
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
  loaded: boolean;
  addMessage: (input: AddMessageInput) => string;
  resolveMessage: (id: string, resolution: string) => void;
  messagesForTicket: (ticketId: string) => ConversationMessage[];
  unresolvedForTicket: (ticketId: string) => ConversationMessage[];
  loadFromDisk: () => Promise<void>;
}

const CONVO_PERSIST_DEBOUNCE_MS = 500;

async function getConversationStore() {
  return load('conversations.json', { defaults: {}, autoSave: true });
}

let convoPersistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistConversations(get: () => ConversationStore) {
  if (convoPersistTimer) clearTimeout(convoPersistTimer);
  convoPersistTimer = setTimeout(async () => {
    try {
      const store = await getConversationStore();
      const messages = get().messages;
      // Group by ticketId for storage
      const byTicket: Record<string, ConversationMessage[]> = {};
      for (const msg of messages) {
        (byTicket[msg.ticketId] ??= []).push(msg);
      }
      await store.set('conversations', byTicket);
    } catch (e) {
      console.warn('failed to persist conversations:', e);
    }
  }, CONVO_PERSIST_DEBOUNCE_MS);
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  messages: [],
  loaded: false,

  addMessage: (input) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isAutoResolved = input.type === 'agent_status' || input.type === 'agent_message';
    const msg: ConversationMessage = {
      id,
      ...input,
      timestamp: Date.now(),
      resolved: isAutoResolved,
      resolution: isAutoResolved ? input.content : undefined,
    };
    set((state) => ({ messages: [...state.messages, msg] }));
    debouncedPersistConversations(get);
    return id;
  },

  resolveMessage: (id, resolution) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, resolved: true, resolution } : m
      ),
    }));
    debouncedPersistConversations(get);
  },

  messagesForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId);
  },

  unresolvedForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId && !m.resolved);
  },

  loadFromDisk: async () => {
    if (get().loaded) return;
    try {
      const store = await getConversationStore();
      const byTicket = (await store.get<Record<string, ConversationMessage[]>>('conversations')) ?? {};
      const messages = Object.values(byTicket).flat();
      set({ messages, loaded: true });
    } catch (e) {
      console.warn('failed to load conversations:', e);
      set({ loaded: true });
    }
  },
}));
