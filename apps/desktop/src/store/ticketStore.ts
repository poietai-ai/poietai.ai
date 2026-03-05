// apps/desktop/src/store/ticketStore.ts
import { create } from 'zustand';
import { readProjectStore, writeProjectStore } from '../lib/projectFileIO';
import { getActiveProjectRoot } from './projectStore';
import { phasesForComplexity, nextPhase } from '../lib/phaseRouter';
import { useCanvasStore } from './canvasStore';
import { useMessageStore } from './messageStore';

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
  number: number;
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
  nextTicketNumber: number;
  selectedTicketId: string | null;
  loaded: boolean;
  isLoading: boolean;

  loadFromDisk: () => Promise<void>;
  addTicket: (input: { title: string; description: string; complexity: number; acceptanceCriteria: string[] }) => void;
  updateTicketStatus: (id: string, status: TicketStatus) => TicketStatus | undefined;
  assignTicket: (ticketId: string, assignment: Assignment) => void;
  selectTicket: (id: string | null) => void;
  advanceTicketPhase: (id: string) => void;
  setPhaseArtifact: (id: string, artifact: Artifact) => void;
  blockTicket: (id: string) => void;
  resetTicket: (id: string) => void;
  deleteTicket: (id: string) => void;
  resetForProjectSwitch: () => void;
}

async function clearPersistedCanvas(ticketId: string) {
  try {
    const root = getActiveProjectRoot();
    if (!root) return;
    const all = await readProjectStore<Record<string, unknown>>(root, 'canvas.json');
    if (!all) return;
    delete all[ticketId];
    await writeProjectStore(root, 'canvas.json', all);
  } catch (e) {
    console.warn('failed to clear persisted canvas:', e);
  }
}

async function persistTickets(get: () => TicketStore) {
  const root = getActiveProjectRoot();
  if (!root) return;
  try {
    await writeProjectStore(root, 'tickets.json', {
      tickets: get().tickets,
      selectedTicketId: get().selectedTicketId,
      nextTicketNumber: get().nextTicketNumber,
    });
  } catch (e) {
    console.warn('failed to persist tickets:', e);
  }
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: [],
  nextTicketNumber: 1,
  selectedTicketId: null,
  loaded: false,
  isLoading: false,

  loadFromDisk: async () => {
    if (get().loaded || get().isLoading) return;
    set({ isLoading: true });
    try {
      const root = getActiveProjectRoot();
      if (!root) {
        set({ tickets: [], nextTicketNumber: 1, selectedTicketId: null, loaded: true, isLoading: false });
        return;
      }
      const saved = await readProjectStore<{
        tickets: Ticket[];
        selectedTicketId: string | null;
        nextTicketNumber: number;
      }>(root, 'tickets.json');

      const tickets = saved?.tickets ?? [];
      const selectedTicketId = saved?.selectedTicketId ?? null;
      let nextTicketNumber = saved?.nextTicketNumber ?? 0;

      // Migrate legacy tickets that lack a number field
      let migrated = false;
      const migratedTickets = tickets.map((t: Ticket, i: number) => {
        if (typeof t.number !== 'number') {
          migrated = true;
          return { ...t, number: i + 1 };
        }
        return t;
      });
      if (nextTicketNumber === 0 || migrated) {
        nextTicketNumber = migratedTickets.length > 0
          ? Math.max(...migratedTickets.map((t: Ticket) => t.number)) + 1
          : 1;
      }
      set({ tickets: migratedTickets, selectedTicketId, nextTicketNumber, loaded: true, isLoading: false });
    } catch (e) {
      console.warn('failed to load tickets:', e);
      set({ tickets: [], nextTicketNumber: 1, loaded: true, isLoading: false });
    }
  },

  addTicket: (input) => {
    set((state) => {
      const phases = phasesForComplexity(input.complexity) as TicketPhase[];
      const ticket: Ticket = {
        id: crypto.randomUUID(),
        number: state.nextTicketNumber,
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
      return { tickets: [...state.tickets, ticket], nextTicketNumber: state.nextTicketNumber + 1 };
    });
    persistTickets(get);
  },

  updateTicketStatus: (id, status) => {
    const oldStatus = get().tickets.find((t) => t.id === id)?.status;
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status } : t)),
    }));
    persistTickets(get);
    return oldStatus;
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

  resetTicket: (id) => {
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          status: 'backlog' as TicketStatus,
          assignments: [],
          activePhase: t.phases[0],
          artifacts: {},
        };
      }),
    }));
    persistTickets(get);
    // Clear canvas nodes for this ticket (in-memory + persisted)
    const canvas = useCanvasStore.getState();
    if (canvas.activeTicketId === id) canvas.clearCanvas();
    clearPersistedCanvas(id);
    // Clear messages tagged with this ticket
    useMessageStore.getState().removeMessagesByTicketId(id);
  },

  deleteTicket: (id) => {
    set((s) => ({
      tickets: s.tickets.filter((t) => t.id !== id),
      selectedTicketId: s.selectedTicketId === id ? null : s.selectedTicketId,
    }));
    persistTickets(get);
    // Clear canvas nodes for this ticket (in-memory + persisted)
    const canvas = useCanvasStore.getState();
    if (canvas.activeTicketId === id) canvas.clearCanvas();
    clearPersistedCanvas(id);
  },

  resetForProjectSwitch: () => {
    set({ tickets: [], nextTicketNumber: 1, selectedTicketId: null, loaded: false, isLoading: false });
  },
}));
