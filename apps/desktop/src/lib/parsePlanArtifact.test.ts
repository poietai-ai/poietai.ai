import { describe, it, expect } from 'vitest';
import { parsePlanArtifact } from './parsePlanArtifact';
import type { PlanArtifact } from '../types/planArtifact';

const VALID_PLAN: PlanArtifact = {
  ticketId: 'T-87',
  taskGroups: [
    {
      groupId: 'G1',
      agentRole: 'backend_engineer',
      description: 'Add nil guard',
      tasks: [
        {
          id: 'G1-T1',
          action: 'modify',
          file: 'src/services/billing.ts',
          description: 'Add nil guard on subscription',
        },
      ],
      filesTouched: ['src/services/billing.ts'],
    },
  ],
  fileConflictCheck: { conflicts: [], status: 'clean' },
  parallelSafe: true,
};

describe('parsePlanArtifact', () => {
  it('extracts and parses a JSON plan from a code fence', () => {
    const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``;
    const result = parsePlanArtifact(text);
    expect(result).not.toBeNull();
    expect(result?.ticketId).toBe('T-87');
    expect(result?.taskGroups).toHaveLength(1);
    expect(result?.taskGroups[0].tasks[0].file).toBe('src/services/billing.ts');
  });

  it('returns null when no JSON fence is present', () => {
    expect(parsePlanArtifact('no plan here')).toBeNull();
    expect(parsePlanArtifact('')).toBeNull();
  });

  it('returns null when JSON fence does not contain a valid PlanArtifact', () => {
    expect(parsePlanArtifact('```json\n{"foo":"bar"}\n```')).toBeNull();
  });

  it('returns null when JSON in fence is malformed', () => {
    expect(parsePlanArtifact('```json\n{invalid json}\n```')).toBeNull();
  });

  it('handles plan with multiple task groups', () => {
    const plan: PlanArtifact = {
      ...VALID_PLAN,
      taskGroups: [
        VALID_PLAN.taskGroups[0],
        { ...VALID_PLAN.taskGroups[0], groupId: 'G2', tasks: [] },
      ],
    };
    const result = parsePlanArtifact(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``);
    expect(result?.taskGroups).toHaveLength(2);
  });

  it('works when plan JSON is the entire string with no surrounding text', () => {
    const text = `\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``;
    expect(parsePlanArtifact(text)?.ticketId).toBe('T-87');
  });
});
