import { describe, it, expect } from 'vitest';
import { parseSecurityResult } from './parseSecurityResult';

describe('parseSecurityResult', () => {
  it('returns zero counts for empty input', () => {
    const result = parseSecurityResult('');
    expect(result).toEqual({ critical: 0, warnings: 0, lines: [] });
  });

  it('parses a CRITICAL line with category and location', () => {
    const result = parseSecurityResult(
      'CRITICAL | OWASP A03:Injection | Unsanitized user input | src/db.rs:42'
    );
    expect(result.critical).toBe(1);
    expect(result.warnings).toBe(0);
    expect(result.lines[0]).toEqual({
      type: 'critical',
      category: 'OWASP A03:Injection',
      description: 'Unsanitized user input',
      location: 'src/db.rs:42',
    });
  });

  it('parses a WARNING line with description and location', () => {
    const result = parseSecurityResult(
      'WARNING | Outdated dependency lodash | package.json:1'
    );
    expect(result.warnings).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Outdated dependency lodash',
      location: 'package.json:1',
    });
  });

  it('location is undefined for CRITICAL with only 3 parts', () => {
    const result = parseSecurityResult('CRITICAL | OWASP A01:BrokenAccess | Missing auth check');
    expect(result.lines[0]).toEqual({
      type: 'critical',
      category: 'OWASP A01:BrokenAccess',
      description: 'Missing auth check',
      location: undefined,
    });
  });

  it('location is undefined for WARNING with only 2 parts', () => {
    const result = parseSecurityResult('WARNING | Hardcoded secret');
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Hardcoded secret',
      location: undefined,
    });
  });

  it('counts mixed lines correctly', () => {
    const text = [
      'CRITICAL | OWASP A03:Injection | SQL injection | src/db.rs:10',
      'WARNING | Weak hash algorithm | src/auth.rs:5',
      'CRITICAL | OWASP A07:AuthFailure | No rate limiting | src/api.rs:33',
      'WARNING | CORS wildcard | src/server.rs:2',
    ].join('\n');
    const result = parseSecurityResult(text);
    expect(result.critical).toBe(2);
    expect(result.warnings).toBe(2);
    expect(result.lines).toHaveLength(4);
  });

  it('ignores lines that do not match any prefix', () => {
    const text = 'Security summary:\nCRITICAL | OWASP A01 | Issue | src/a.rs:1\nNo other issues.';
    const result = parseSecurityResult(text);
    expect(result.critical).toBe(1);
    expect(result.lines).toHaveLength(1);
  });

  it('location is undefined for CRITICAL when parts[3] is empty (trailing pipe)', () => {
    const result = parseSecurityResult('CRITICAL | OWASP A02 | Sensitive data exposure |');
    expect(result.lines[0].location).toBeUndefined();
  });

  it('location is undefined for WARNING when trailing pipe produces empty parts[2]', () => {
    const result = parseSecurityResult('WARNING | Hardcoded API key |');
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Hardcoded API key',
      location: undefined,
    });
  });
});
