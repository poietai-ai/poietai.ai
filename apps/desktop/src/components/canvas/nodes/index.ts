import { ThoughtNode } from './ThoughtNode';
import { FileNode } from './FileNode';
import { BashNode } from './BashNode';
import { AwaitingNode } from './AwaitingNode';
import { PlanTaskNode } from './PlanTaskNode';
import { ValidateResultNode } from './ValidateResultNode';
import { QaResultNode } from './QaResultNode';
import { SecurityResultNode } from './SecurityResultNode';
import { ReviewSynthesisNode } from './ReviewSynthesisNode';
import { StatusUpdateNode } from './StatusUpdateNode';

// Maps node type strings (from Zustand) to React components.
// Passed to ReactFlow as the `nodeTypes` prop.
export const nodeTypes = {
  thought: ThoughtNode,
  agent_message: ThoughtNode,  // same visual style, different semantic meaning
  file_read: FileNode,
  file_edit: FileNode,
  file_write: FileNode,
  bash_command: BashNode,
  awaiting_user: AwaitingNode,
  plan_task: PlanTaskNode,
  validate_result: ValidateResultNode,
  qa_result: QaResultNode,
  security_result: SecurityResultNode,
  review_synthesis: ReviewSynthesisNode,
  status_update: StatusUpdateNode,
} as const;
