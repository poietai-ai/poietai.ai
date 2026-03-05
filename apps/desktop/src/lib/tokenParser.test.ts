import { describe, it, expect } from 'vitest';
import { parseTokens } from './tokenParser';

describe('parseTokens', () => {
  it('returns plain text for input with no tokens', () => {
    expect(parseTokens('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ]);
  });

  it('parses a single @mention', () => {
    expect(parseTokens('@Builder')).toEqual([
      { type: 'token', tokenType: 'mention', raw: '@Builder', value: 'Builder' },
    ]);
  });

  it('parses a single #ticket', () => {
    expect(parseTokens('#42')).toEqual([
      { type: 'token', tokenType: 'ticket', raw: '#42', value: '42' },
    ]);
  });

  it('parses a single /command', () => {
    expect(parseTokens('/list_tickets')).toEqual([
      { type: 'token', tokenType: 'command', raw: '/list_tickets', value: 'list_tickets' },
    ]);
  });

  it('parses mixed tokens in a sentence', () => {
    const result = parseTokens('hey @Builder check #1 and run /status');
    expect(result).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'token', tokenType: 'mention', raw: '@Builder', value: 'Builder' },
      { type: 'text', value: ' check ' },
      { type: 'token', tokenType: 'ticket', raw: '#1', value: '1' },
      { type: 'text', value: ' and run ' },
      { type: 'token', tokenType: 'command', raw: '/status', value: 'status' },
    ]);
  });

  it('handles tokens near punctuation', () => {
    const result = parseTokens('talk to @Builder, about #3.');
    expect(result).toEqual([
      { type: 'text', value: 'talk to ' },
      { type: 'token', tokenType: 'mention', raw: '@Builder', value: 'Builder' },
      { type: 'text', value: ', about ' },
      { type: 'token', tokenType: 'ticket', raw: '#3', value: '3' },
      { type: 'text', value: '.' },
    ]);
  });

  it('does not tokenize # inside URLs', () => {
    const result = parseTokens('see https://example.com#section for details');
    expect(result).toEqual([
      { type: 'text', value: 'see https://example.com#section for details' },
    ]);
  });

  it('does not tokenize @ in emails', () => {
    const result = parseTokens('contact user@example.com please');
    expect(result).toEqual([
      { type: 'text', value: 'contact user@example.com please' },
    ]);
  });

  it('matches multi-word agent names (known names)', () => {
    const result = parseTokens('ask @CI Claude about it', ['CI Claude', 'Builder']);
    expect(result).toEqual([
      { type: 'text', value: 'ask ' },
      { type: 'token', tokenType: 'mention', raw: '@CI Claude', value: 'CI Claude' },
      { type: 'text', value: ' about it' },
    ]);
  });

  it('prefers longest known name match', () => {
    const result = parseTokens('@CI Claude Bot', ['CI', 'CI Claude', 'CI Claude Bot']);
    expect(result).toEqual([
      { type: 'token', tokenType: 'mention', raw: '@CI Claude Bot', value: 'CI Claude Bot' },
    ]);
  });

  it('does not tokenize /command in the middle of a word', () => {
    const result = parseTokens('path/to/file');
    expect(result).toEqual([
      { type: 'text', value: 'path/to/file' },
    ]);
  });

  it('handles empty string', () => {
    expect(parseTokens('')).toEqual([]);
  });

  it('handles consecutive tokens', () => {
    const result = parseTokens('@Builder @Reviewer');
    expect(result).toEqual([
      { type: 'token', tokenType: 'mention', raw: '@Builder', value: 'Builder' },
      { type: 'text', value: ' ' },
      { type: 'token', tokenType: 'mention', raw: '@Reviewer', value: 'Reviewer' },
    ]);
  });

  it('does not match # followed by non-digits', () => {
    const result = parseTokens('#heading is not a ticket');
    expect(result).toEqual([
      { type: 'text', value: '#heading is not a ticket' },
    ]);
  });
});
