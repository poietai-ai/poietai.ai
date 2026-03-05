import { create } from 'zustand';

interface ChatSession {
  pendingUpdates: string[];
}

interface ChatSessionStore {
  sessions: Record<string, ChatSession>;
  /** Queue a context update for the next chat resume. */
  pushUpdate: (agentId: string, update: string) => void;
  /** Flush accumulated updates into a single string and clear the queue. */
  flushUpdates: (agentId: string) => string;
}

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  sessions: {},

  pushUpdate: (agentId, update) => {
    set((state) => {
      const session = state.sessions[agentId] ?? { pendingUpdates: [] };
      return {
        sessions: {
          ...state.sessions,
          [agentId]: {
            pendingUpdates: [...session.pendingUpdates, update],
          },
        },
      };
    });
  },

  flushUpdates: (agentId) => {
    const session = get().sessions[agentId];
    if (!session || session.pendingUpdates.length === 0) return '';

    const text = '## Context Updates Since Last Message\n' +
      session.pendingUpdates.map((u) => `- ${u}`).join('\n');

    set((state) => ({
      sessions: {
        ...state.sessions,
        [agentId]: { pendingUpdates: [] },
      },
    }));

    return text;
  },
}));
