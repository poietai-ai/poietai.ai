import { describe, it, expect } from 'vitest';
import { phasesForComplexity, nextPhase } from './phaseRouter';

describe('phasesForComplexity', () => {
  it('low complexity (1-3) returns minimal pipeline', () => {
    expect(phasesForComplexity(1)).toEqual(['plan', 'build', 'validate', 'ship']);
    expect(phasesForComplexity(3)).toEqual(['plan', 'build', 'validate', 'ship']);
  });

  it('medium complexity (4-7) returns standard pipeline', () => {
    const expected = ['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship'];
    expect(phasesForComplexity(4)).toEqual(expected);
    expect(phasesForComplexity(7)).toEqual(expected);
  });

  it('high complexity (8-10) returns full pipeline including review and security', () => {
    const expected = ['brief', 'design', 'review', 'plan', 'build', 'validate', 'qa', 'security', 'ship'];
    expect(phasesForComplexity(8)).toEqual(expected);
    expect(phasesForComplexity(10)).toEqual(expected);
  });
});

describe('nextPhase', () => {
  it('returns the next phase in the given pipeline', () => {
    const pipeline = ['plan', 'build', 'validate', 'ship'];
    expect(nextPhase(pipeline, 'plan')).toBe('build');
    expect(nextPhase(pipeline, 'validate')).toBe('ship');
  });

  it('returns undefined when current phase is the last one', () => {
    const pipeline = ['plan', 'build', 'validate', 'ship'];
    expect(nextPhase(pipeline, 'ship')).toBeUndefined();
  });

  it('returns undefined when current phase is not in the pipeline', () => {
    const pipeline = ['plan', 'build'];
    expect(nextPhase(pipeline, 'validate')).toBeUndefined();
  });
});
