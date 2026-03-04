// apps/desktop/src/store/ticketStore.ts
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import { phasesForComplexity, nextPhase } from '../lib/phaseRouter';

export type TicketStatus =
  | 'backlog' | 'refined' | 'assigned'
  | 'in_progress' | 'in_review' | 'shipped' | 'blocked';

export type TicketPhase =
  | 'brief' | 'design' | 'review' | 'plan' | 'build'
  | 'validate' | 'qa' | 'security' | 'ship';

export interface Artifact {
  phase: TicketPhase;
  content: string;
  createdAt: string;
  agentId?: string;
}

export interface Assignment {
  agentId: string;
  repoId: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: number; // 1-10
  status: TicketStatus;
  assignments: Assignment[];
  acceptanceCriteria: string[];
  phases: TicketPhase[];
  activePhase?: TicketPhase;
  artifacts: Partial<Record<TicketPhase, Artifact>>;
}

interface TicketStore {
  tickets: Ticket[];
  selectedTicketId: string | null;
  loaded: boolean;
  isLoading: boolean;

  loadFromDisk: () => Promise<void>;
  addTicket: (input: { title: string; description: string; complexity: number; acceptanceCriteria: string[] }) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => void;
  assignTicket: (ticketId: string, assignment: Assignment) => void;
  selectTicket: (id: string | null) => void;
  advanceTicketPhase: (id: string) => void;
  setPhaseArtifact: (id: string, artifact: Artifact) => void;
  blockTicket: (id: string) => void;
}

const DEMO_TICKETS: Ticket[] = [
  {
    id: 'ticket-1',
    title: 'Fix nil guard in billing service',
    description: 'The subscription pointer is not checked before token deduction. Under certain conditions this can panic at runtime.',
    complexity: 3,
    status: 'refined',
    assignments: [],
    acceptanceCriteria: [
      'Subscription is guarded before token deduction',
      'Existing billing tests still pass',
      'New test covers the nil/missing case',
    ],
    phases: phasesForComplexity(3) as TicketPhase[],
    activePhase: (phasesForComplexity(3) as TicketPhase[])[0],
    artifacts: {},
  },
  {
    id: 'ticket-2',
    title: 'Add loading state to dashboard metrics',
    description: 'Dashboard metrics flash undefined while fetching. Show a skeleton loader instead.',
    complexity: 2,
    status: 'backlog',
    assignments: [],
    acceptanceCriteria: [
      'Skeleton loader shows during fetch',
      'No layout shift when data loads',
    ],
    phases: phasesForComplexity(2) as TicketPhase[],
    activePhase: (phasesForComplexity(2) as TicketPhase[])[0],
    artifacts: {},
  },
];

async function getTicketStore() {
  return load('tickets.json', { defaults: {}, autoSave: true });
}

async function persistTickets(get: () => TicketStore) {
  try {
    const store = await getTicketStore();
    await store.set('tickets', get().tickets);
    await store.set('selectedTicketId', get().selectedTicketId);
  } catch (e) {
    console.warn('failed to persist tickets:', e);
  }
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: [],
  selectedTicketId: null,
  loaded: false,
  isLoading: false,

  loadFromDisk: async () => {
    if (get().loaded || get().isLoading) return;
    set({ isLoading: true });
    try {
      const store = await getTicketStore();
      const tickets = (await store.get<Ticket[]>('tickets')) ?? DEMO_TICKETS;
      const selectedTicketId = (await store.get<string>('selectedTicketId')) ?? null;
      set({ tickets, selectedTicketId, loaded: true, isLoading: false });
    } catch (e) {
      console.warn('failed to load tickets:', e);
      set({ tickets: DEMO_TICKETS, loaded: true, isLoading: false });
    }
  },

  addTicket: (input) => {
    set((state) => {
      const phases = phasesForComplexity(input.complexity) as TicketPhase[];
      const ticket: Ticket = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description,
        complexity: input.complexity,
        status: 'backlog',
        assignments: [],
        acceptanceCriteria: input.acceptanceCriteria,
        phases,
        activePhase: phases[0],
        artifacts: {},
      };
      return { tickets: [...state.tickets, ticket] };
    });
    persistTickets(get);
  },

  updateTicketStatus: (id, status) => {
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status } : t)),
    }));
    persistTickets(get);
  },

  assignTicket: (ticketId, assignment) => {
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId
          ? { ...t, assignments: [...t.assignments, assignment], status: 'assigned' as TicketStatus }
          : t
      ),
    }));
    persistTickets(get);
  },

  selectTicket: (id) => { set({ selectedTicketId: id }); persistTickets(get); },

  advanceTicketPhase: (id) => {
    set((state) => ({
      tickets: state.tickets.map((t) => {
        if (t.id !== id || !t.activePhase) return t;
        const next = nextPhase(t.phases, t.activePhase) as TicketPhase | undefined;
        if (!next) return t;
        return {
          ...t,
          activePhase: next,
          status: next === 'ship' ? 'shipped' : t.status,
        };
      }),
    }));
    persistTickets(get);
  },

  setPhaseArtifact: (id, artifact) => {
    set((state) => ({
      tickets: state.tickets.map((t) =>
        t.id !== id ? t : { ...t, artifacts: { ...t.artifacts, [artifact.phase]: artifact } }
      ),
    }));
    persistTickets(get);
  },

  blockTicket: (id) => {
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status: 'blocked' as TicketStatus } : t)),
    }));
    persistTickets(get);
  },
}));
