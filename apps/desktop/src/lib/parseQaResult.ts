export type QaLine =
  | { type: 'critical'; description: string; location?: string }
  | { type: 'warning';  description: string; location?: string }
  | { type: 'advisory'; description: string; location?: string };

export interface QaResult {
  critical: number;
  warnings: number;
  advisory: number;
  lines: QaLine[];
}

function parsePipeLine(trimmed: string): { description: string; location?: string } {
  const parts = trimmed.split('|').map((p) => p.trim());
  const description = parts[1] ?? '';
  const location = parts.length >= 3 && parts[2] !== '' ? parts[2] : undefined;
  return { description, location };
}

export function parseQaResult(text: string): QaResult {
  const lines: QaLine[] = [];
  let critical = 0;
  let warnings = 0;
  let advisory = 0;

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('CRITICAL |')) {
      const { description, location } = parsePipeLine(trimmed);
      lines.push({ type: 'critical', description, location });
      critical++;
    } else if (trimmed.startsWith('WARNING |')) {
      const { description, location } = parsePipeLine(trimmed);
      lines.push({ type: 'warning', description, location });
      warnings++;
    } else if (trimmed.startsWith('ADVISORY |')) {
      const { description, location } = parsePipeLine(trimmed);
      lines.push({ type: 'advisory', description, location });
      advisory++;
    }
  }

  return { critical, warnings, advisory, lines };
}
