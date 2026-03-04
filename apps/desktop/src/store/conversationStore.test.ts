import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore } from './conversationStore';

describe('conversationStore', () => {
  beforeEach(() => {
    useConversationStore.setState({ messages: [] });
  });

  it('adds a question message', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_question',
      content: 'Should I use JWT or sessions?',
    });
    const msgs = useConversationStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('agent_question');
    expect(msgs[0].resolved).toBe(false);
  });

  it('auto-resolves status messages', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_status',
      content: 'Reading auth module...',
    });
    const msgs = useConversationStore.getState().messages;
    expect(msgs[0].resolved).toBe(true);
  });

  it('resolves a message', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_question',
      content: 'Which DB?',
    });
    const id = useConversationStore.getState().messages[0].id;
    useConversationStore.getState().resolveMessage(id, 'Use PostgreSQL');
    const msg = useConversationStore.getState().messages[0];
    expect(msg.resolved).toBe(true);
    expect(msg.resolution).toBe('Use PostgreSQL');
  });

  it('gets unresolved messages for a ticket', () => {
    const store = useConversationStore.getState();
    store.addMessage({ ticketId: 't-1', agentId: 'a-1', agentName: 'FE', type: 'agent_question', content: 'Q1' });
    store.addMessage({ ticketId: 't-1', agentId: 'a-1', agentName: 'FE', type: 'agent_status', content: 'Reading...' });
    store.addMessage({ ticketId: 't-2', agentId: 'a-2', agentName: 'BE', type: 'agent_question', content: 'Q2' });

    const unresolved = useConversationStore.getState().unresolvedForTicket('t-1');
    expect(unresolved).toHaveLength(1); // status is auto-resolved, only question counts
  });

  it('gets all messages for a ticket', () => {
    const store = useConversationStore.getState();
    store.addMessage({ ticketId: 't-1', agentId: 'a-1', agentName: 'FE', type: 'agent_question', content: 'Q1' });
    store.addMessage({ ticketId: 't-2', agentId: 'a-2', agentName: 'BE', type: 'agent_question', content: 'Q2' });

    const msgs = useConversationStore.getState().messagesForTicket('t-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Q1');
  });

  it('adds a choices message with choices array', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_choices',
      content: 'Which approach?',
      choices: [
        { label: 'Option A', description: 'Fast but less safe' },
        { label: 'Option B', description: 'Safer but slower' },
      ],
    });
    const msgs = useConversationStore.getState().messages;
    expect(msgs[0].choices).toHaveLength(2);
    expect(msgs[0].resolved).toBe(false);
  });
});
