import { describe, it, expect, beforeEach } from 'vitest';
import { useTicketStore } from './ticketStore';

beforeEach(() => {
  useTicketStore.setState({ tickets: [] });
});

describe('addTicket', () => {
  it('computes phases from complexity and sets activePhase to first phase', () => {
    useTicketStore.getState().addTicket({
      title: 'Fix bug', description: 'desc', complexity: 2, acceptanceCriteria: [],
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.phases).toEqual(['plan', 'build', 'validate', 'ship']);
    expect(t.activePhase).toBe('plan');
    expect(t.artifacts).toEqual({});
    expect(t.status).toBe('backlog');
  });

  it('medium complexity ticket starts at brief phase', () => {
    useTicketStore.getState().addTicket({
      title: 'Feature', description: '', complexity: 5, acceptanceCriteria: [],
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.phases).toEqual(['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship']);
    expect(t.activePhase).toBe('brief');
  });

  it('assigns a unique id and sets status to backlog', () => {
    useTicketStore.getState().addTicket({ title: 'A', description: '', complexity: 1, acceptanceCriteria: [] });
    useTicketStore.getState().addTicket({ title: 'B', description: '', complexity: 1, acceptanceCriteria: [] });
    const tickets = useTicketStore.getState().tickets;
    expect(tickets).toHaveLength(2);
    expect(tickets[0].id).not.toBe(tickets[1].id);
    expect(tickets[0].status).toBe('backlog');
  });
});

describe('advanceTicketPhase', () => {
  it('moves activePhase to the next phase in the pipeline', () => {
    useTicketStore.getState().addTicket({ title: 'T', description: '', complexity: 2, acceptanceCriteria: [] });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().advanceTicketPhase(id); // plan → build
    expect(useTicketStore.getState().tickets[0].activePhase).toBe('build');
  });

  it('sets status to shipped when activePhase reaches ship', () => {
    useTicketStore.getState().addTicket({ title: 'T', description: '', complexity: 2, acceptanceCriteria: [] });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().advanceTicketPhase(id); // plan → build
    useTicketStore.getState().advanceTicketPhase(id); // build → validate
    useTicketStore.getState().advanceTicketPhase(id); // validate → ship
    const t = useTicketStore.getState().tickets[0];
    expect(t.activePhase).toBe('ship');
    expect(t.status).toBe('shipped');
  });

  it('does nothing if ticket does not exist', () => {
    expect(() => {
      useTicketStore.getState().advanceTicketPhase('nonexistent');
    }).not.toThrow();
  });
});

describe('setPhaseArtifact', () => {
  it('stores artifact under the correct phase key', () => {
    useTicketStore.getState().addTicket({ title: 'T', description: '', complexity: 2, acceptanceCriteria: [] });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().setPhaseArtifact(id, {
      phase: 'plan',
      content: '{"tasks":[]}',
      createdAt: '2026-02-24T00:00:00Z',
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.artifacts.plan?.content).toBe('{"tasks":[]}');
    expect(t.artifacts.plan?.phase).toBe('plan');
  });

  it('preserves existing artifacts when adding a new one', () => {
    useTicketStore.getState().addTicket({ title: 'T', description: '', complexity: 5, acceptanceCriteria: [] });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().setPhaseArtifact(id, { phase: 'brief', content: 'brief content', createdAt: '2026-02-24T00:00:00Z' });
    useTicketStore.getState().setPhaseArtifact(id, { phase: 'design', content: 'design content', createdAt: '2026-02-24T00:00:00Z' });
    const t = useTicketStore.getState().tickets[0];
    expect(t.artifacts.brief?.content).toBe('brief content');
    expect(t.artifacts.design?.content).toBe('design content');
  });
});
