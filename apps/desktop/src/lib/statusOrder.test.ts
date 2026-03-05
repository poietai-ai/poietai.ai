import { describe, it, expect } from 'vitest';
import { statusIndex, getMoveDirection, isAdjacentForward } from './statusOrder';

describe('statusIndex', () => {
  it('returns correct indices for board columns', () => {
    expect(statusIndex('backlog')).toBe(0);
    expect(statusIndex('refined')).toBe(1);
    expect(statusIndex('assigned')).toBe(2);
    expect(statusIndex('in_progress')).toBe(3);
    expect(statusIndex('in_review')).toBe(4);
    expect(statusIndex('shipped')).toBe(5);
  });

  it('returns -1 for blocked (not a board column)', () => {
    expect(statusIndex('blocked')).toBe(-1);
  });
});

describe('getMoveDirection', () => {
  it('detects forward moves', () => {
    expect(getMoveDirection('backlog', 'refined')).toBe('forward');
    expect(getMoveDirection('backlog', 'shipped')).toBe('forward');
  });

  it('detects backward moves', () => {
    expect(getMoveDirection('shipped', 'backlog')).toBe('backward');
    expect(getMoveDirection('in_review', 'in_progress')).toBe('backward');
  });

  it('detects same column', () => {
    expect(getMoveDirection('backlog', 'backlog')).toBe('same');
  });
});

describe('isAdjacentForward', () => {
  it('returns true for adjacent forward moves', () => {
    expect(isAdjacentForward('backlog', 'refined')).toBe(true);
    expect(isAdjacentForward('in_review', 'shipped')).toBe(true);
  });

  it('returns false for non-adjacent forward moves', () => {
    expect(isAdjacentForward('backlog', 'assigned')).toBe(false);
  });

  it('returns false for backward moves', () => {
    expect(isAdjacentForward('shipped', 'in_review')).toBe(false);
  });

  it('returns false for same column', () => {
    expect(isAdjacentForward('backlog', 'backlog')).toBe(false);
  });
});
