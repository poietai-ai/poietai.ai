import { create } from 'zustand';

interface NavigationStore {
  activeView: string;
  selectedTicketId: string | null;
  setActiveView: (view: string) => void;
  setSelectedTicketId: (ticketId: string) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  activeView: 'dashboard',
  selectedTicketId: null,
  setActiveView: (view) => set({ activeView: view }),
  setSelectedTicketId: (ticketId) => set({ activeView: 'graph', selectedTicketId: ticketId }),
}));
