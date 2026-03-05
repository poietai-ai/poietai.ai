export type Segment =
  | { type: 'text'; value: string }
  | { type: 'token'; tokenType: 'mention' | 'ticket' | 'command'; raw: string; value: string };

/**
 * Parse a text string into segments of plain text and tokens (@mention, #ticket, /command).
 * `knownAgentNames` enables multi-word agent matching (longest-first).
 */
export function parseTokens(text: string, knownAgentNames?: string[]): Segment[] {
  if (!text) return [];

  // Sort known names longest-first for greedy matching
  const sortedNames = knownAgentNames
    ? [...knownAgentNames].sort((a, b) => b.length - a.length)
    : [];

  const segments: Segment[] = [];
  let i = 0;
  let textStart = 0;

  const flush = (end: number) => {
    if (end > textStart) {
      segments.push({ type: 'text', value: text.slice(textStart, end) });
    }
  };

  while (i < text.length) {
    const ch = text[i];
    const prevCh = i > 0 ? text[i - 1] : undefined;
    const atWordBoundary = i === 0 || /\s/.test(prevCh!);

    // --- /command: only at position 0 or after whitespace ---
    if (ch === '/' && atWordBoundary) {
      const match = text.slice(i).match(/^\/(\w+)/);
      if (match) {
        flush(i);
        const raw = match[0];
        segments.push({ type: 'token', tokenType: 'command', raw, value: match[1] });
        i += raw.length;
        textStart = i;
        continue;
      }
    }

    // --- @mention ---
    if (ch === '@' && atWordBoundary) {
      // Skip if it looks like an email (prev char is alphanumeric)
      if (prevCh && /\w/.test(prevCh)) {
        i++;
        continue;
      }

      // Try known agent names first (longest match)
      let matched = false;
      for (const name of sortedNames) {
        const candidate = text.slice(i + 1, i + 1 + name.length);
        if (candidate === name) {
          // Ensure the match ends at a word boundary
          const afterIdx = i + 1 + name.length;
          const afterCh = afterIdx < text.length ? text[afterIdx] : undefined;
          if (!afterCh || /[\s.,!?;:)\]}]/.test(afterCh)) {
            flush(i);
            const raw = `@${name}`;
            segments.push({ type: 'token', tokenType: 'mention', raw, value: name });
            i = afterIdx;
            textStart = i;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      // Fallback: @\w+
      const match = text.slice(i).match(/^@(\w+)/);
      if (match) {
        flush(i);
        segments.push({ type: 'token', tokenType: 'mention', raw: match[0], value: match[1] });
        i += match[0].length;
        textStart = i;
        continue;
      }
    }

    // --- #ticket: #(\d+) at word boundary, skip URLs ---
    if (ch === '#' && atWordBoundary) {
      // Skip if preceded by URL-like chars (part of a URL fragment)
      if (prevCh && /[\/\w.]/.test(prevCh) && i > 0) {
        // Check if this looks like a URL fragment (e.g., example.com#section)
        const before = text.slice(0, i);
        if (/\S+\.\S*$/.test(before) || /https?:\/\/\S*$/.test(before)) {
          i++;
          continue;
        }
      }

      const match = text.slice(i).match(/^#(\d+)\b/);
      if (match) {
        flush(i);
        segments.push({ type: 'token', tokenType: 'ticket', raw: match[0], value: match[1] });
        i += match[0].length;
        textStart = i;
        continue;
      }
    }

    i++;
  }

  flush(text.length);
  return segments;
}
