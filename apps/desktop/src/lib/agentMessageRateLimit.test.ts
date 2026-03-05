import { describe, it, expect, beforeEach } from 'vitest';
import { checkAgentMessageRate, checkConversationDepth, resetRateLimits } from './agentMessageRateLimit';

describe('agentMessageRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows messages under the rate limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkAgentMessageRate('conv-1', 'agent-a')).toBe(true);
    }
  });

  it('blocks messages over the rate limit', () => {
    for (let i = 0; i < 10; i++) {
      checkAgentMessageRate('conv-1', 'agent-a');
    }
    expect(checkAgentMessageRate('conv-1', 'agent-a')).toBe(false);
  });

  it('tracks conversations independently', () => {
    for (let i = 0; i < 10; i++) {
      checkAgentMessageRate('conv-1', 'agent-a');
    }
    expect(checkAgentMessageRate('conv-2', 'agent-a')).toBe(true);
  });
});

describe('checkConversationDepth', () => {
  it('returns false when under depth limit', () => {
    const msgs = Array.from({ length: 5 }, () => ({ from: 'agent-a' }));
    expect(checkConversationDepth(msgs)).toBe(false);
  });

  it('returns true when over depth limit', () => {
    const msgs = Array.from({ length: 20 }, () => ({ from: 'agent-a' }));
    expect(checkConversationDepth(msgs)).toBe(true);
  });

  it('resets count on user message', () => {
    const msgs = [
      ...Array.from({ length: 15 }, () => ({ from: 'agent-a' })),
      { from: 'user' },
      ...Array.from({ length: 5 }, () => ({ from: 'agent-b' })),
    ];
    expect(checkConversationDepth(msgs)).toBe(false);
  });

  it('ignores system messages in count', () => {
    const msgs = [
      ...Array.from({ length: 10 }, () => ({ from: 'agent-a' })),
      { from: 'system' },
      ...Array.from({ length: 10 }, () => ({ from: 'agent-b' })),
    ];
    expect(checkConversationDepth(msgs)).toBe(true);
  });
});
