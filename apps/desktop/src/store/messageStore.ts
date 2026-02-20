import { create } from 'zustand';
import type { Message } from '../types/message';

interface MessageStore {
  threads: Record<string, Message[]>;
  unreadCounts: Record<string, number>;
  activeThread: string | null;

  addMessage: (message: Message) => void;
  setActiveThread: (agentId: string) => void;
  markRead: (agentId: string) => void;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  threads: {},
  unreadCounts: {},
  activeThread: null,

  addMessage: (message) => {
    const { threads, unreadCounts, activeThread } = get();
    const thread = threads[message.agentId] ?? [];
    const isActive = activeThread === message.agentId;

    set({
      threads: {
        ...threads,
        [message.agentId]: [...thread, message],
      },
      unreadCounts: {
        ...unreadCounts,
        [message.agentId]: isActive ? 0 : (unreadCounts[message.agentId] ?? 0) + 1,
      },
    });
  },

  setActiveThread: (agentId) => {
    set({ activeThread: agentId });
    get().markRead(agentId);
  },

  markRead: (agentId) => {
    const { unreadCounts } = get();
    set({ unreadCounts: { ...unreadCounts, [agentId]: 0 } });
  },
}));
