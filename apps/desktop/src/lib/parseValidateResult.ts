export interface ValidateLine {
  type: 'verified' | 'mismatch';
  summary: string;
  location?: string;
  severity?: 'critical' | 'advisory';
}

export interface ValidateResult {
  verified: number;
  critical: number;
  advisory: number;
  lines: ValidateLine[];
}

export function parseValidateResult(text: string): ValidateResult {
  const lines: ValidateLine[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('VERIFIED |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      lines.push({ type: 'verified', summary: parts[1] ?? '', location: parts[2] });
    } else if (trimmed.startsWith('MISMATCH |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const lastPart = parts[parts.length - 1].toLowerCase();
      const severity: 'critical' | 'advisory' = lastPart === 'critical' ? 'critical' : 'advisory';
      lines.push({ type: 'mismatch', summary: parts[1] ?? '', severity });
    }
  }

  return {
    verified: lines.filter((l) => l.type === 'verified').length,
    critical: lines.filter((l) => l.type === 'mismatch' && l.severity === 'critical').length,
    advisory: lines.filter((l) => l.type === 'mismatch' && l.severity === 'advisory').length,
    lines,
  };
}
