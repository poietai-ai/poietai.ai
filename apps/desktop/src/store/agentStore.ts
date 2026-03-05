import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';

export type AgentStatus = 'idle' | 'working' | 'waiting_for_user' | 'reviewing' | 'blocked';

export interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  status: AgentStatus;
  current_ticket_id?: string;
  session_id?: string;
  worktree_path?: string;
  pr_number?: number;
  chat_session_id?: string;
  chatting?: boolean;
  initiative?: string | null;
}

type AgentIdentity = Pick<Agent, 'id' | 'name' | 'role' | 'personality' | 'chat_session_id' | 'initiative'>;

let _store: Store | null = null;
async function getStore() {
  if (!_store) _store = await Store.load('agents.json');
  return _store;
}

interface AgentStore {
  agents: Agent[];
  _intervalId: ReturnType<typeof setInterval> | null;

  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  persistAgents: () => Promise<void>;
  restoreAgents: () => Promise<void>;
  updateAgent: (id: string, patch: { name?: string; role?: string; personality?: string; initiative?: string | null }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  _intervalId: null,

  refresh: async () => {
    try {
      const agents = await invoke<Agent[]>('get_all_agents');
      set({ agents });
    } catch (e) {
      console.error('failed to fetch agents:', e);
    }
  },

  startPolling: () => {
    if (get()._intervalId) return;
    get().refresh();
    const id = setInterval(() => get().refresh(), 2000);
    set({ _intervalId: id });
  },

  stopPolling: () => {
    const id = get()._intervalId;
    if (id) clearInterval(id);
    set({ _intervalId: null });
  },

  persistAgents: async () => {
    const store = await getStore();
    const identities: AgentIdentity[] = get().agents.map(
      ({ id, name, role, personality, chat_session_id, initiative }) => ({ id, name, role, personality, chat_session_id, initiative })
    );
    await store.set('agents', identities);
    await store.save();
  },

  restoreAgents: async () => {
    const store = await getStore();
    const saved = (await store.get<AgentIdentity[]>('agents')) ?? [];
    for (const { id, name, role, personality, chat_session_id, initiative } of saved) {
      try {
        await invoke('create_agent', { id, name, role, personality, chatSessionId: chat_session_id ?? null, initiative: initiative ?? null });
      } catch {
        // Already exists in this session — skip.
      }
    }
    await get().refresh();
  },

  updateAgent: async (id, patch) => {
    await invoke('update_agent', {
      id,
      name: patch.name ?? null,
      role: patch.role ?? null,
      personality: patch.personality ?? null,
      initiative: patch.initiative !== undefined ? patch.initiative : null,
    });
    await get().refresh();
    await get().persistAgents();
  },

  deleteAgent: async (id) => {
    await invoke('delete_agent', { id });
    await get().refresh();
    await get().persistAgents();
  },
}));
