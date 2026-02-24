import { describe, it, expect } from 'vitest';
import { parseValidateResult } from './parseValidateResult';

const SAMPLE_OUTPUT = `
I'll now verify each claim in the plan against the actual code.

VERIFIED | addTicket sets phases from complexity | ticketStore.ts:89
VERIFIED | advanceTicketPhase moves to next phase | ticketStore.ts:121
MISMATCH | setPhaseArtifact stores artifact | Expected: stores under phase key | Found: key lookup uses wrong index | CRITICAL
MISMATCH | PhaseBreadcrumb shows active phase in violet | Expected: violet-400 class | Found: violet-500 class | ADVISORY

Overall: 2 verified, 1 critical mismatch, 1 advisory mismatch.
`;

describe('parseValidateResult', () => {
  it('counts VERIFIED lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.verified).toBe(2);
  });

  it('counts CRITICAL MISMATCH lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.critical).toBe(1);
  });

  it('counts ADVISORY MISMATCH lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.advisory).toBe(1);
  });

  it('returns structured lines with type, summary, and severity', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0].type).toBe('verified');
    expect(result.lines[0].summary).toBe('addTicket sets phases from complexity');
    expect(result.lines[2].type).toBe('mismatch');
    expect(result.lines[2].severity).toBe('critical');
    expect(result.lines[3].severity).toBe('advisory');
  });

  it('returns zeros and empty lines for text with no validate lines', () => {
    const result = parseValidateResult('No structured output here.');
    expect(result.verified).toBe(0);
    expect(result.critical).toBe(0);
    expect(result.advisory).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('handles MISMATCH lines without explicit severity (defaults to advisory)', () => {
    const result = parseValidateResult('MISMATCH | some claim | Expected: x | Found: y');
    expect(result.lines[0].severity).toBe('advisory');
    expect(result.advisory).toBe(1);
    expect(result.critical).toBe(0);
  });
});
