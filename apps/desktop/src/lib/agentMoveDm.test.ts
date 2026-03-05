import { describe, it, expect } from 'vitest';
import { generateMoveDm } from './agentMoveDm';

describe('generateMoveDm', () => {
  const base = { ticketTitle: 'Fix billing bug' };

  it('returns message for backward moves', () => {
    const msg = generateMoveDm({
      ...base,
      oldStatus: 'in_progress',
      newStatus: 'backlog',
      agentStatus: 'working',
    });
    expect(msg).toContain('back to Backlog');
    expect(msg).toContain('Fix billing bug');
  });

  it('returns message for forward skip (non-adjacent)', () => {
    const msg = generateMoveDm({
      ...base,
      oldStatus: 'backlog',
      newStatus: 'in_progress',
      agentStatus: 'working',
    });
    expect(msg).toContain('In Progress');
    expect(msg).toContain('already handled');
  });

  it('returns message for adjacent forward when agent is working', () => {
    const msg = generateMoveDm({
      ...base,
      oldStatus: 'in_progress',
      newStatus: 'in_review',
      agentStatus: 'working',
    });
    expect(msg).toContain('In Review');
    expect(msg).toContain('already handled');
  });

  it('returns null for adjacent forward when agent is idle', () => {
    const msg = generateMoveDm({
      ...base,
      oldStatus: 'in_progress',
      newStatus: 'in_review',
      agentStatus: 'idle',
    });
    expect(msg).toBeNull();
  });

  it('returns null for same column', () => {
    const msg = generateMoveDm({
      ...base,
      oldStatus: 'backlog',
      newStatus: 'backlog',
      agentStatus: 'idle',
    });
    expect(msg).toBeNull();
  });
});
