import { create } from 'zustand';

export type TicketStatus =
  | 'backlog' | 'refined' | 'assigned'
  | 'in_progress' | 'in_review' | 'shipped';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: number; // 1-10
  status: TicketStatus;
  assignedAgentId?: string;
  acceptanceCriteria: string[];
}

interface TicketStore {
  tickets: Ticket[];
  selectedTicketId: string | null;

  addTicket: (ticket: Ticket) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => void;
  assignTicket: (ticketId: string, agentId: string) => void;
  selectTicket: (id: string | null) => void;
}

// Seed with a demo ticket so the board isn't empty on first launch
const DEMO_TICKETS: Ticket[] = [
  {
    id: 'ticket-1',
    title: 'Fix nil guard in billing service',
    description: 'The subscription pointer is not checked before token deduction. Under certain conditions this can panic at runtime.',
    complexity: 3,
    status: 'refined',
    acceptanceCriteria: [
      'Subscription is guarded before token deduction',
      'Existing billing tests still pass',
      'New test covers the nil/missing case',
    ],
  },
  {
    id: 'ticket-2',
    title: 'Add loading state to dashboard metrics',
    description: 'Dashboard metrics flash undefined while fetching. Show a skeleton loader instead.',
    complexity: 2,
    status: 'backlog',
    acceptanceCriteria: [
      'Skeleton loader shows during fetch',
      'No layout shift when data loads',
    ],
  },
];

export const useTicketStore = create<TicketStore>((set) => ({
  tickets: DEMO_TICKETS,
  selectedTicketId: null,

  addTicket: (ticket) => set((s) => ({ tickets: [...s.tickets, ticket] })),

  updateTicketStatus: (id, status) =>
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status } : t)),
    })),

  assignTicket: (ticketId, agentId) =>
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId ? { ...t, assignedAgentId: agentId, status: 'assigned' as TicketStatus } : t
      ),
    })),

  selectTicket: (id) => set({ selectedTicketId: id }),
}));
