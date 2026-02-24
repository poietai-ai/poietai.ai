import type { PlanArtifact } from '../types/planArtifact';

/**
 * Extracts the first ```json ... ``` fence from text and parses it as a PlanArtifact.
 * Returns null if no fence is found, JSON is invalid, or shape is not a PlanArtifact.
 */
export function parsePlanArtifact(text: string): PlanArtifact | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    return isPlanArtifact(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlanArtifact(obj: unknown): obj is PlanArtifact {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.ticketId === 'string' &&
    Array.isArray(p.taskGroups) &&
    typeof p.fileConflictCheck === 'object' &&
    p.fileConflictCheck !== null &&
    typeof p.parallelSafe === 'boolean'
  );
}
