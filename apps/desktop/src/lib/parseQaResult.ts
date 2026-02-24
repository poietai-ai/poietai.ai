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

export function parseQaResult(text: string): QaResult {
  const lines: QaLine[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('CRITICAL |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'critical', description, location });
    } else if (trimmed.startsWith('WARNING |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'warning', description, location });
    } else if (trimmed.startsWith('ADVISORY |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 ? parts[2] : undefined;
      lines.push({ type: 'advisory', description, location });
    }
  }

  let critical = 0;
  let warnings = 0;
  let advisory = 0;
  for (const line of lines) {
    if (line.type === 'critical') critical++;
    else if (line.type === 'warning') warnings++;
    else advisory++;
  }

  return { critical, warnings, advisory, lines };
}
