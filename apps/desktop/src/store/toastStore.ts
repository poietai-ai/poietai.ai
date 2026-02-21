import { create } from 'zustand';

export interface AgentToast {
  /** Using agent_id as the key so we replace rather than stack toasts for the same agent. */
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  isQuestion: boolean;
  ticketId: string;
  createdAt: number;
}

interface ToastStore {
  toasts: AgentToast[];
  showToast: (toast: Omit<AgentToast, 'createdAt'>) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  showToast: (toast) => {
    // Replace any existing toast for this agent (one per agent at a time)
    const existing = get().toasts.filter((t) => t.id !== toast.id);
    set({ toasts: [...existing, { ...toast, createdAt: Date.now() }] });
  },

  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
