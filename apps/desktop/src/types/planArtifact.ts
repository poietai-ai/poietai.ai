export interface PlanTestCase {
  name: string;
  setup: string;
  input: string;
  assertion: string;
}

export interface PlanTask {
  id: string;
  action: 'create' | 'modify' | 'delete';
  file: string;
  description: string;
  patternReference?: string;
  codeExample?: string;
  testCases?: PlanTestCase[];
}

export interface PlanTaskGroup {
  groupId: string;
  agentRole: string;
  description: string;
  tasks: PlanTask[];
  filesTouched: string[];
}

export interface PlanArtifact {
  ticketId: string;
  planVersion?: number;
  designRef?: string;
  taskGroups: PlanTaskGroup[];
  fileConflictCheck: {
    conflicts: string[];
    status: 'clean' | 'conflict';
  };
  parallelSafe: boolean;
}
