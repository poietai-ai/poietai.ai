import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

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
}

interface AgentStore {
  agents: Agent[];
  _intervalId: ReturnType<typeof setInterval> | null;

  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
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
}));
