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
}

type AgentIdentity = Pick<Agent, 'id' | 'name' | 'role' | 'personality'>;

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
      ({ id, name, role, personality }) => ({ id, name, role, personality })
    );
    await store.set('agents', identities);
    await store.save();
  },

  restoreAgents: async () => {
    const store = await getStore();
    const saved = (await store.get<AgentIdentity[]>('agents')) ?? [];
    for (const { id, name, role, personality } of saved) {
      try {
        await invoke('create_agent', { id, name, role, personality });
      } catch {
        // Already exists in this session — skip.
      }
    }
    await get().refresh();
  },
}));
