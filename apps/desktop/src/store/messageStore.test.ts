import { beforeEach, describe, expect, it } from 'vitest';
import { useMessageStore, getTopLevelMessages, getRepliesForParent } from './messageStore';
import type { DmMessage, Channel } from '../types/message';

function makeDm(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    threadId: 'agent-1',
    threadType: 'dm',
    from: 'agent',
    agentId: 'agent-1',
    agentName: 'Ada',
    content: 'Hello',
    type: 'text',
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  useMessageStore.setState({
    threads: {},
    channels: [],
    unreadCounts: {},
    activeThread: null,
    openThreadParentId: null,
    loaded: false,
  });
});

describe('addMessage', () => {
  it('creates a thread and appends the message', () => {
    const msg = makeDm();
    useMessageStore.getState().addMessage(msg);
    const thread = useMessageStore.getState().threads['agent-1'];
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('Hello');
  });

  it('increments unread when thread is not active', () => {
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(1);
  });

  it('does not increment unread when thread is active', () => {
    useMessageStore.getState().setActiveThread('agent-1');
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });

  it('appends to existing thread', () => {
    useMessageStore.getState().addMessage(makeDm({ content: 'first' }));
    useMessageStore.getState().addMessage(makeDm({ content: 'second' }));
    expect(useMessageStore.getState().threads['agent-1']).toHaveLength(2);
  });
});

describe('setActiveThread', () => {
  it('sets activeThread and clears unread', () => {
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(1);
    useMessageStore.getState().setActiveThread('agent-1');
    expect(useMessageStore.getState().activeThread).toBe('agent-1');
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });
});

describe('markRead', () => {
  it('zeroes unread for the given threadId', () => {
    useMessageStore.getState().addMessage(makeDm());
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(2);
    useMessageStore.getState().markRead('agent-1');
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });
});

describe('totalUnread', () => {
  it('sums unread across all threads', () => {
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-1', agentId: 'agent-1' }));
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-2', agentId: 'agent-2' }));
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-2', agentId: 'agent-2' }));
    expect(useMessageStore.getState().totalUnread()).toBe(3);
  });

  it('returns 0 when all read', () => {
    expect(useMessageStore.getState().totalUnread()).toBe(0);
  });
});

describe('channels', () => {
  it('addChannel appends to channels list', () => {
    const ch: Channel = { id: 'ch-1', name: 'auth-redesign', agentIds: ['agent-1'], createdAt: Date.now() };
    useMessageStore.getState().addChannel(ch);
    expect(useMessageStore.getState().channels).toHaveLength(1);
    expect(useMessageStore.getState().channels[0].name).toBe('auth-redesign');
  });

  it('channel messages go to channel thread', () => {
    const ch: Channel = { id: 'ch-1', name: 'perf', agentIds: ['agent-1'], createdAt: Date.now() };
    useMessageStore.getState().addChannel(ch);
    useMessageStore.getState().addMessage(makeDm({ threadId: 'ch-1', threadType: 'channel' }));
    expect(useMessageStore.getState().threads['ch-1']).toHaveLength(1);
  });
});

describe('resolveMessage', () => {
  it('marks a message as resolved with resolution text', () => {
    const msg = makeDm({ type: 'question', resolved: false });
    useMessageStore.getState().addMessage(msg);
    useMessageStore.getState().resolveMessage(msg.id, 'Yes, do it');
    const thread = useMessageStore.getState().threads['agent-1'];
    expect(thread[0].resolved).toBe(true);
    expect(thread[0].resolution).toBe('Yes, do it');
  });
});

describe('threading', () => {
  it('addMessage with parentId increments parent replyCount and sets lastReplyAt', () => {
    const parent = makeDm({ id: 'parent-1', content: 'question?' });
    useMessageStore.getState().addMessage(parent);

    const reply = makeDm({ id: 'reply-1', parentId: 'parent-1', content: 'answer', timestamp: 2000 });
    useMessageStore.getState().addMessage(reply);

    const thread = useMessageStore.getState().threads['agent-1'];
    const updatedParent = thread.find((m) => m.id === 'parent-1')!;
    expect(updatedParent.replyCount).toBe(1);
    expect(updatedParent.lastReplyAt).toBe(2000);
  });

  it('increments replyCount on multiple replies', () => {
    const parent = makeDm({ id: 'parent-2' });
    useMessageStore.getState().addMessage(parent);
    useMessageStore.getState().addMessage(makeDm({ id: 'r1', parentId: 'parent-2', timestamp: 3000 }));
    useMessageStore.getState().addMessage(makeDm({ id: 'r2', parentId: 'parent-2', timestamp: 4000 }));

    const thread = useMessageStore.getState().threads['agent-1'];
    const updatedParent = thread.find((m) => m.id === 'parent-2')!;
    expect(updatedParent.replyCount).toBe(2);
    expect(updatedParent.lastReplyAt).toBe(4000);
  });

  it('getTopLevelMessages filters out messages with parentId', () => {
    const msgs: DmMessage[] = [
      makeDm({ id: 'a' }),
      makeDm({ id: 'b', parentId: 'a' }),
      makeDm({ id: 'c' }),
    ];
    const topLevel = getTopLevelMessages(msgs);
    expect(topLevel).toHaveLength(2);
    expect(topLevel.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('getRepliesForParent returns only matching replies', () => {
    const msgs: DmMessage[] = [
      makeDm({ id: 'p1' }),
      makeDm({ id: 'r1', parentId: 'p1' }),
      makeDm({ id: 'r2', parentId: 'p1' }),
      makeDm({ id: 'r3', parentId: 'p2' }),
    ];
    const replies = getRepliesForParent(msgs, 'p1');
    expect(replies).toHaveLength(2);
    expect(replies.map((m) => m.id)).toEqual(['r1', 'r2']);
  });

  it('setOpenThread sets and clears openThreadParentId', () => {
    useMessageStore.getState().setOpenThread('msg-123');
    expect(useMessageStore.getState().openThreadParentId).toBe('msg-123');
    useMessageStore.getState().setOpenThread(null);
    expect(useMessageStore.getState().openThreadParentId).toBeNull();
  });

  it('setActiveThread clears openThreadParentId', () => {
    useMessageStore.getState().setOpenThread('msg-123');
    useMessageStore.getState().setActiveThread('agent-1');
    expect(useMessageStore.getState().openThreadParentId).toBeNull();
  });
});

describe('removeMessagesByTicketId', () => {
  it('removes messages with matching ticketId from all threads', () => {
    useMessageStore.getState().addMessage(makeDm({ id: 'm1', ticketId: 'ticket-1' }));
    useMessageStore.getState().addMessage(makeDm({ id: 'm2', ticketId: 'ticket-2' }));
    useMessageStore.getState().addMessage(makeDm({ id: 'm3', ticketId: 'ticket-1' }));
    useMessageStore.getState().removeMessagesByTicketId('ticket-1');
    const thread = useMessageStore.getState().threads['agent-1'];
    expect(thread).toHaveLength(1);
    expect(thread[0].id).toBe('m2');
  });

  it('removes empty threads after filtering', () => {
    useMessageStore.getState().addMessage(makeDm({ id: 'm1', threadId: 'agent-x', ticketId: 'ticket-1' }));
    useMessageStore.getState().removeMessagesByTicketId('ticket-1');
    expect(useMessageStore.getState().threads['agent-x']).toBeUndefined();
  });
});
