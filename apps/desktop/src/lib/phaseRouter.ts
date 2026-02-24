// @poietai/shared is in package.json deps, but we use string[] here
// so callers can cast to TicketPhase[] where needed without forcing an import.

const LOW: string[] = ['plan', 'build', 'validate', 'ship'];
const MEDIUM: string[] = ['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship'];
const HIGH: string[] = ['brief', 'design', 'review', 'plan', 'build', 'validate', 'qa', 'security', 'ship'];

const COMPLEXITY_LOW_MAX = 3;
const COMPLEXITY_MEDIUM_MAX = 7;

export function phasesForComplexity(complexity: number): string[] {
  if (complexity <= COMPLEXITY_LOW_MAX) return [...LOW];
  if (complexity <= COMPLEXITY_MEDIUM_MAX) return [...MEDIUM];
  return [...HIGH];
}

export function nextPhase(phases: string[], current: string): string | undefined {
  const idx = phases.indexOf(current);
  if (idx === -1 || idx === phases.length - 1) return undefined;
  return phases[idx + 1];
}
