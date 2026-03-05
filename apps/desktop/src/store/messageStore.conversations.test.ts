import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock projectFileIO before importing store
vi.mock('../lib/projectFileIO', () => ({
  readProjectStore: vi.fn().mockResolvedValue(null),
  writeProjectStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./projectStore', () => ({
  getActiveProjectRoot: vi.fn(() => '/mock/root'),
}));

import { useMessageStore } from './messageStore';
import type { Conversation } from '../types/message';

describe('messageStore conversations', () => {
  beforeEach(() => {
    useMessageStore.setState({
      threads: {},
      channels: [],
      conversations: [],
      unreadCounts: {},
      activeThread: null,
      openThreadParentId: null,
      loaded: false,
    });
  });

  it('addConversation adds and persists a conversation', () => {
    const conv: Conversation = {
      id: 'conv-1',
      type: 'dm',
      participants: ['agent-a', 'agent-b'],
      locked: true,
      createdAt: 1000,
      lastMessageAt: 1000,
    };
    useMessageStore.getState().addConversation(conv);
    expect(useMessageStore.getState().conversations).toHaveLength(1);
    expect(useMessageStore.getState().conversations[0].id).toBe('conv-1');
  });

  it('findOrCreateDm finds existing conversation', () => {
    const conv: Conversation = {
      id: 'dm-ab',
      type: 'dm',
      participants: ['agent-a', 'agent-b'],
      locked: true,
      createdAt: 1000,
      lastMessageAt: 1000,
    };
    useMessageStore.getState().addConversation(conv);
    const found = useMessageStore.getState().findOrCreateDm(['agent-a', 'agent-b']);
    expect(found.id).toBe('dm-ab');
  });

  it('findOrCreateDm creates new locked DM when not found', () => {
    const conv = useMessageStore.getState().findOrCreateDm(['agent-x', 'agent-y']);
    expect(conv.locked).toBe(true);
    expect(conv.participants).toEqual(['agent-x', 'agent-y']);
    expect(useMessageStore.getState().conversations).toHaveLength(1);
  });

  it('updateConversation patches fields', () => {
    useMessageStore.getState().addConversation({
      id: 'conv-1', type: 'dm', participants: ['a'], locked: false,
      createdAt: 1000, lastMessageAt: 1000,
    });
    useMessageStore.getState().updateConversation('conv-1', { lastMessageAt: 2000 });
    expect(useMessageStore.getState().conversations[0].lastMessageAt).toBe(2000);
  });

  it('addMessage updates conversation lastMessageAt', () => {
    useMessageStore.getState().addConversation({
      id: 'conv-1', type: 'dm', participants: ['agent-a'],
      locked: true, createdAt: 1000, lastMessageAt: 1000,
    });
    useMessageStore.getState().addMessage({
      id: 'msg-1', threadId: 'conv-1', threadType: 'dm',
      from: 'user', agentId: '', agentName: 'You',
      content: 'hello', type: 'text', timestamp: 5000,
    });
    expect(useMessageStore.getState().conversations[0].lastMessageAt).toBe(5000);
  });

  it('migrateToConversations creates conversations from legacy threads', () => {
    // Simulate legacy state: threads keyed by agentId, no conversations
    useMessageStore.setState({
      threads: {
        'agent-a': [{ id: 'm1', threadId: 'agent-a', threadType: 'dm' as const, from: 'agent', agentId: 'agent-a', agentName: 'A', content: 'hi', type: 'text' as const, timestamp: 1000 }],
      },
      channels: [{ id: 'ch-1', name: 'general', agentIds: ['agent-a'], createdAt: 500 }],
      conversations: [],
      unreadCounts: {},
      activeThread: null,
      openThreadParentId: null,
      loaded: true,
    });
    useMessageStore.getState().migrateToConversations();
    const convs = useMessageStore.getState().conversations;
    // Should create one for the DM thread and one for the channel
    expect(convs.length).toBe(2);
    const dmConv = convs.find((c) => c.id === 'agent-a');
    expect(dmConv?.locked).toBe(true);
    expect(dmConv?.participants).toEqual(['agent-a']);
    const chConv = convs.find((c) => c.id === 'ch-1');
    expect(chConv?.type).toBe('channel');
    expect(chConv?.name).toBe('general');
  });
});
