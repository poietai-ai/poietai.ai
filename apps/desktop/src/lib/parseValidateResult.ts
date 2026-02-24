export type ValidateLine =
  | { type: 'verified'; summary: string; location?: string }
  | { type: 'mismatch'; summary: string; severity: 'critical' | 'advisory' };

export interface ValidateResult {
  verified: number;
  critical: number;
  advisory: number;
  lines: ValidateLine[];
}

export function parseValidateResult(text: string): ValidateResult {
  const lines: ValidateLine[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('VERIFIED |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      // parts[0] = 'VERIFIED', parts[1] = summary, parts[2] = location (optional)
      const summary = parts[1] ?? '';
      const location = parts[2];
      lines.push({ type: 'verified', summary, location });
    } else if (trimmed.startsWith('MISMATCH |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      // Expected format: MISMATCH | summary | Expected: ... | Found: ... | CRITICAL|ADVISORY
      // Minimum 2 parts (MISMATCH + summary). Severity is the last part IF it is exactly
      // 'CRITICAL' or 'ADVISORY' AND there are at least 3 parts (so it's not the summary).
      const summary = parts[1] ?? '';
      const lastPart = parts[parts.length - 1].toUpperCase();
      const hasSeveritySlot = parts.length >= 3;
      const severity: 'critical' | 'advisory' =
        hasSeveritySlot && lastPart === 'CRITICAL' ? 'critical' : 'advisory';
      lines.push({ type: 'mismatch', summary, severity });
    }
  }

  let verified = 0;
  let critical = 0;
  let advisory = 0;
  for (const line of lines) {
    if (line.type === 'verified') verified++;
    else if (line.severity === 'critical') critical++;
    else advisory++;
  }

  return { verified, critical, advisory, lines };
}
