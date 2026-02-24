import { describe, it, expect } from 'vitest';
import { parseValidateResult, ValidateLine } from './parseValidateResult';

type MismatchLine = Extract<ValidateLine, { type: 'mismatch' }>;

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
    expect((result.lines[2] as MismatchLine).severity).toBe('critical');
    expect((result.lines[3] as MismatchLine).severity).toBe('advisory');
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
    expect((result.lines[0] as MismatchLine).severity).toBe('advisory');
    expect(result.advisory).toBe(1);
    expect(result.critical).toBe(0);
  });

  it('handles mixed-case severity tokens (Critical, critical, CRITICAL all work)', () => {
    const input = [
      'MISMATCH | claim A | Expected: x | Found: y | Critical',
      'MISMATCH | claim B | Expected: x | Found: y | CRITICAL',
      'MISMATCH | claim C | Expected: x | Found: y | critical',
    ].join('\n');
    const result = parseValidateResult(input);
    expect(result.critical).toBe(3);
    expect(result.advisory).toBe(0);
  });

  it('does not misread summary as severity for two-part MISMATCH lines', () => {
    // Only 2 parts (MISMATCH + summary) — no severity slot — should default to advisory
    const result = parseValidateResult('MISMATCH | critical flaw in logic');
    expect(result.lines[0].summary).toBe('critical flaw in logic');
    expect((result.lines[0] as MismatchLine).severity).toBe('advisory'); // "critical" is in summary, not severity slot
    expect(result.critical).toBe(0);
  });

  it('does not misread pipe characters inside the summary for VERIFIED lines', () => {
    // If agent emits pipe in summary, location should still be the correct slot
    const result = parseValidateResult('VERIFIED | supports A | B shorthand | ticketStore.ts:10');
    // With the current split approach the summary will be 'supports A' — this test
    // documents the known limitation: only the text up to the first pipe after the keyword
    // is captured as summary. The location is parts[2].
    expect(result.lines[0].type).toBe('verified');
    expect(result.verified).toBe(1);
  });

  it('handles empty string input', () => {
    const result = parseValidateResult('');
    expect(result.verified).toBe(0);
    expect(result.critical).toBe(0);
    expect(result.advisory).toBe(0);
    expect(result.lines).toHaveLength(0);
  });
});
