import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import type { DmMessage, Channel } from '../types/message';

interface MessageStore {
  threads: Record<string, DmMessage[]>;
  channels: Channel[];
  unreadCounts: Record<string, number>;
  activeThread: string | null;
  loaded: boolean;

  loadFromDisk: () => Promise<void>;
  addMessage: (message: DmMessage) => void;
  resolveMessage: (id: string, resolution: string) => void;
  setActiveThread: (threadId: string) => void;
  markRead: (threadId: string) => void;
  addChannel: (channel: Channel) => void;
  totalUnread: () => number;
}

const MSG_PERSIST_DEBOUNCE_MS = 500;

async function getMessageStoreFile() {
  return load('messages.json', { defaults: {}, autoSave: true });
}

let msgPersistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistMessages(get: () => MessageStore) {
  if (msgPersistTimer) clearTimeout(msgPersistTimer);
  msgPersistTimer = setTimeout(async () => {
    try {
      const store = await getMessageStoreFile();
      await store.set('threads', get().threads);
      await store.set('channels', get().channels);
    } catch (e) {
      console.warn('failed to persist messages:', e);
    }
  }, MSG_PERSIST_DEBOUNCE_MS);
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  threads: {},
  channels: [],
  unreadCounts: {},
  activeThread: null,
  loaded: false,

  loadFromDisk: async () => {
    if (get().loaded) return;
    try {
      const store = await getMessageStoreFile();
      const threads = (await store.get<Record<string, DmMessage[]>>('threads')) ?? {};
      const channels = (await store.get<Channel[]>('channels')) ?? [];
      set({ threads, channels, loaded: true });
    } catch (e) {
      console.warn('failed to load messages:', e);
      set({ loaded: true });
    }
  },

  addMessage: (message) => {
    const { threads, unreadCounts, activeThread } = get();
    const threadId = message.threadId;
    const thread = threads[threadId] ?? [];
    const isActive = activeThread === threadId;

    set({
      threads: { ...threads, [threadId]: [...thread, message] },
      unreadCounts: {
        ...unreadCounts,
        [threadId]: isActive ? 0 : (unreadCounts[threadId] ?? 0) + 1,
      },
    });
    debouncedPersistMessages(get);
  },

  resolveMessage: (id, resolution) => {
    const { threads } = get();
    const updated: Record<string, DmMessage[]> = {};
    for (const [tid, msgs] of Object.entries(threads)) {
      updated[tid] = msgs.map((m) =>
        m.id === id ? { ...m, resolved: true, resolution } : m
      );
    }
    set({ threads: updated });
    debouncedPersistMessages(get);
  },

  setActiveThread: (threadId) => {
    set({ activeThread: threadId });
    get().markRead(threadId);
  },

  markRead: (threadId) => {
    const { unreadCounts } = get();
    set({ unreadCounts: { ...unreadCounts, [threadId]: 0 } });
  },

  addChannel: (channel) => {
    set((state) => ({ channels: [...state.channels, channel] }));
    debouncedPersistMessages(get);
  },

  totalUnread: () => {
    return Object.values(get().unreadCounts).reduce((sum, n) => sum + n, 0);
  },
}));
