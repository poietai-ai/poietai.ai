import { create } from 'zustand';
import { readProjectStore, writeProjectStore } from '../lib/projectFileIO';
import { getActiveProjectRoot } from './projectStore';
import type { DmMessage, Channel, Conversation } from '../types/message';

interface MessageStore {
  threads: Record<string, DmMessage[]>;
  channels: Channel[];
  unreadCounts: Record<string, number>;
  activeThread: string | null;
  openThreadParentId: string | null;
  loaded: boolean;
  conversations: Conversation[];

  loadFromDisk: () => Promise<void>;
  addConversation: (conversation: Conversation) => void;
  findOrCreateDm: (participants: string[]) => Conversation;
  updateConversation: (id: string, patch: Partial<Pick<Conversation, 'name' | 'participants' | 'lastMessageAt'>>) => void;
  migrateToConversations: () => void;
  addMessage: (message: DmMessage) => void;
  resolveMessage: (id: string, resolution: string) => void;
  setActiveThread: (threadId: string) => void;
  setOpenThread: (parentId: string | null) => void;
  markRead: (threadId: string) => void;
  addChannel: (channel: Channel) => void;
  updateChannel: (id: string, patch: Partial<Pick<Channel, 'name' | 'agentIds'>>) => void;
  removeMessagesByTicketId: (ticketId: string) => void;
  totalUnread: () => number;
  resetForProjectSwitch: () => void;
}

const MSG_PERSIST_DEBOUNCE_MS = 500;

let msgPersistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistMessages(get: () => MessageStore) {
  if (msgPersistTimer) clearTimeout(msgPersistTimer);
  msgPersistTimer = setTimeout(async () => {
    const root = getActiveProjectRoot();
    if (!root) return;
    try {
      await writeProjectStore(root, 'messages.json', {
        threads: get().threads,
        channels: get().channels,
        conversations: get().conversations,
      });
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
  openThreadParentId: null,
  loaded: false,
  conversations: [],

  loadFromDisk: async () => {
    if (get().loaded) return;
    try {
      const root = getActiveProjectRoot();
      if (!root) {
        set({ threads: {}, channels: [], conversations: [], loaded: true });
        return;
      }
      const saved = await readProjectStore<{
        threads: Record<string, DmMessage[]>;
        channels: Channel[];
        conversations?: Conversation[];
      }>(root, 'messages.json');
      const threads = saved?.threads ?? {};
      const channels = saved?.channels ?? [];
      const conversations = saved?.conversations ?? [];
      set({ threads, channels, conversations, loaded: true });
    } catch (e) {
      console.warn('failed to load messages:', e);
      set({ loaded: true });
    }
  },

  addMessage: (message) => {
    const { threads, unreadCounts, activeThread, conversations } = get();
    const threadId = message.threadId;
    let thread = [...(threads[threadId] ?? [])];
    const isActive = activeThread === threadId;

    // If this is a reply, update the parent's replyCount and lastReplyAt
    if (message.parentId) {
      thread = thread.map((m) =>
        m.id === message.parentId
          ? { ...m, replyCount: (m.replyCount ?? 0) + 1, lastReplyAt: message.timestamp }
          : m
      );
    }

    const updatedConversations = conversations.map((c) =>
      c.id === threadId ? { ...c, lastMessageAt: message.timestamp } : c
    );

    set({
      threads: { ...threads, [threadId]: [...thread, message] },
      unreadCounts: {
        ...unreadCounts,
        [threadId]: isActive ? 0 : (unreadCounts[threadId] ?? 0) + 1,
      },
      conversations: updatedConversations,
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
    set({ activeThread: threadId, openThreadParentId: null });
    get().markRead(threadId);
  },

  setOpenThread: (parentId) => {
    set({ openThreadParentId: parentId });
  },

  markRead: (threadId) => {
    const { unreadCounts } = get();
    set({ unreadCounts: { ...unreadCounts, [threadId]: 0 } });
  },

  addChannel: (channel) => {
    set((state) => ({ channels: [...state.channels, channel] }));
    debouncedPersistMessages(get);
  },

  updateChannel: (id, patch) => {
    set((state) => ({
      channels: state.channels.map((ch) => (ch.id === id ? { ...ch, ...patch } : ch)),
    }));
    debouncedPersistMessages(get);
  },

  addConversation: (conversation) => {
    set((state) => ({ conversations: [...state.conversations, conversation] }));
    debouncedPersistMessages(get);
  },

  findOrCreateDm: (participants) => {
    const sorted = [...participants].sort();
    const existing = get().conversations.find(
      (c) => c.type === 'dm' && c.locked &&
        c.participants.length === sorted.length &&
        [...c.participants].sort().every((p, i) => p === sorted[i])
    );
    if (existing) return existing;

    const conv: Conversation = {
      id: `dm-${sorted.join('-')}`,
      type: 'dm',
      participants: sorted,
      locked: true,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    get().addConversation(conv);
    return conv;
  },

  updateConversation: (id, patch) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    }));
    debouncedPersistMessages(get);
  },

  migrateToConversations: () => {
    const { threads, channels, conversations } = get();
    if (conversations.length > 0) return;

    const newConvs: Conversation[] = [];
    const channelIds = new Set(channels.map((c) => c.id));

    for (const threadId of Object.keys(threads)) {
      if (channelIds.has(threadId)) continue;
      const msgs = threads[threadId];
      const lastMsg = msgs[msgs.length - 1];
      newConvs.push({
        id: threadId,
        type: 'dm',
        participants: [threadId],
        locked: true,
        createdAt: msgs[0]?.timestamp ?? Date.now(),
        lastMessageAt: lastMsg?.timestamp ?? Date.now(),
      });
    }

    for (const ch of channels) {
      newConvs.push({
        id: ch.id,
        type: 'channel',
        name: ch.name,
        participants: ch.agentIds,
        locked: false,
        createdAt: ch.createdAt,
        lastMessageAt: threads[ch.id]?.slice(-1)[0]?.timestamp ?? ch.createdAt,
      });
    }

    set({ conversations: newConvs });
    debouncedPersistMessages(get);
  },

  removeMessagesByTicketId: (ticketId) => {
    const { threads } = get();
    const updated: Record<string, DmMessage[]> = {};
    for (const [tid, msgs] of Object.entries(threads)) {
      const filtered = msgs.filter((m) => m.ticketId !== ticketId);
      if (filtered.length > 0) updated[tid] = filtered;
    }
    set({ threads: updated, openThreadParentId: null });
    debouncedPersistMessages(get);
  },

  totalUnread: () => {
    return Object.values(get().unreadCounts).reduce((sum, n) => sum + n, 0);
  },

  resetForProjectSwitch: () => {
    if (msgPersistTimer) { clearTimeout(msgPersistTimer); msgPersistTimer = null; }
    set({ threads: {}, channels: [], conversations: [], unreadCounts: {}, activeThread: null, openThreadParentId: null, loaded: false });
  },
}));

/** Top-level messages only (no replies). */
export function getTopLevelMessages(messages: DmMessage[]): DmMessage[] {
  return messages.filter((m) => !m.parentId);
}

/** All replies for a given parent message. */
export function getRepliesForParent(messages: DmMessage[], parentId: string): DmMessage[] {
  return messages.filter((m) => m.parentId === parentId);
}
