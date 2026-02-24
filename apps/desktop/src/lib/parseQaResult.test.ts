import { describe, it, expect } from 'vitest';
import { parseQaResult } from './parseQaResult';

describe('parseQaResult', () => {
  it('returns zero counts for empty input', () => {
    const result = parseQaResult('');
    expect(result).toEqual({ critical: 0, warnings: 0, advisory: 0, lines: [] });
  });

  it('counts a single CRITICAL line', () => {
    const result = parseQaResult('CRITICAL | Missing error handling | src/lib.rs:42');
    expect(result.critical).toBe(1);
    expect(result.warnings).toBe(0);
    expect(result.advisory).toBe(0);
    expect(result.lines[0]).toEqual({
      type: 'critical',
      description: 'Missing error handling',
      location: 'src/lib.rs:42',
    });
  });

  it('counts a single WARNING line', () => {
    const result = parseQaResult('WARNING | Unused import | src/main.ts:5');
    expect(result.warnings).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'warning',
      description: 'Unused import',
      location: 'src/main.ts:5',
    });
  });

  it('counts a single ADVISORY line', () => {
    const result = parseQaResult('ADVISORY | Consider extracting helper | src/foo.ts:10');
    expect(result.advisory).toBe(1);
    expect(result.lines[0]).toEqual({
      type: 'advisory',
      description: 'Consider extracting helper',
      location: 'src/foo.ts:10',
    });
  });

  it('counts mixed severity lines', () => {
    const text = [
      'CRITICAL | Panic in unwrap | src/lib.rs:99',
      'WARNING | Magic number 42 | src/config.ts:7',
      'ADVISORY | Long function | src/util.ts:3',
      'CRITICAL | SQL injection risk | src/db.rs:14',
    ].join('\n');
    const result = parseQaResult(text);
    expect(result.critical).toBe(2);
    expect(result.warnings).toBe(1);
    expect(result.advisory).toBe(1);
    expect(result.lines).toHaveLength(4);
  });

  it('ignores lines that do not match any prefix', () => {
    const text = 'Some summary text\nCRITICAL | Real issue | src/a.rs:1\nAnother note';
    const result = parseQaResult(text);
    expect(result.critical).toBe(1);
    expect(result.lines).toHaveLength(1);
  });

  it('location is undefined when only two pipe-separated parts', () => {
    const result = parseQaResult('CRITICAL | Missing tests');
    expect(result.lines[0]).toEqual({
      type: 'critical',
      description: 'Missing tests',
      location: undefined,
    });
  });

  it('uses parts[1] as description — pipe in description truncates at parts[1]', () => {
    // With split('|'), "Use foo | bar instead" splits — parts[1] is "Use foo"
    // This documents the known limitation: description is always parts[1] only
    const result = parseQaResult('WARNING | Use foo | src/x.ts:1');
    expect(result.lines[0].description).toBe('Use foo');
    expect(result.lines[0].location).toBe('src/x.ts:1');
  });
});
