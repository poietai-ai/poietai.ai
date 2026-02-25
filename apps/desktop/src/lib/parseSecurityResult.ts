export type SecurityLine =
  | { type: 'critical'; category: string; description: string; location?: string }
  | { type: 'warning'; description: string; location?: string };

export interface SecurityResult {
  critical: number;
  warnings: number;
  lines: SecurityLine[];
}

export function parseSecurityResult(text: string): SecurityResult {
  const lines: SecurityLine[] = [];
  let critical = 0;
  let warnings = 0;

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('CRITICAL |')) {
      // Format: CRITICAL | <category> | <description> | <file:line>
      const parts = trimmed.split('|').map((p) => p.trim());
      const category = parts[1] ?? '';
      const description = parts[2] ?? '';
      const location = parts.length >= 4 && parts[3] !== '' ? parts[3] : undefined;
      lines.push({ type: 'critical', category, description, location });
      critical++;
    } else if (trimmed.startsWith('WARNING |')) {
      // Format: WARNING | <description> | <file:line>
      const parts = trimmed.split('|').map((p) => p.trim());
      const description = parts[1] ?? '';
      const location = parts.length >= 3 && parts[2] !== '' ? parts[2] : undefined;
      lines.push({ type: 'warning', description, location });
      warnings++;
    }
  }

  return { critical, warnings, lines };
}
