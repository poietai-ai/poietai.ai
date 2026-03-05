export type InitiativeLevel = 'auto' | 'ask' | 'suggest' | 'off';

const PERSONALITY_DEFAULTS: Record<string, InitiativeLevel> = {
  pragmatic: 'auto',
  ambitious: 'auto',
  creative: 'auto',
  perfectionist: 'ask',
  meticulous: 'ask',
  systematic: 'ask',
  conservative: 'suggest',
  'devils-advocate': 'suggest',
};

export function resolveInitiative(
  personality: string,
  override: string | null | undefined,
): InitiativeLevel {
  if (override && (override === 'auto' || override === 'ask' || override === 'suggest' || override === 'off')) {
    return override;
  }
  return PERSONALITY_DEFAULTS[personality] ?? 'suggest';
}
