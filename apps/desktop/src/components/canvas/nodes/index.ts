import { ThoughtNode } from './ThoughtNode';
import { AgentMessageNode } from './AgentMessageNode';
import { FileNode } from './FileNode';
import { BashNode } from './BashNode';
import { AwaitingNode } from './AwaitingNode';
import { PlanTaskNode } from './PlanTaskNode';
import { ValidateResultNode } from './ValidateResultNode';
import { QaResultNode } from './QaResultNode';
import { SecurityResultNode } from './SecurityResultNode';
import { ReviewSynthesisNode } from './ReviewSynthesisNode';
import { StatusUpdateNode } from './StatusUpdateNode';
import { FanOutNode } from './FanOutNode';
import { FanInNode } from './FanInNode';
import { PhaseBoxNode } from './PhaseBoxNode';

// Maps node type strings (from Zustand) to React components.
// Passed to ReactFlow as the `nodeTypes` prop.
export const nodeTypes = {
  thought: ThoughtNode,
  agent_message: AgentMessageNode,
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
  fan_out: FanOutNode,
  fan_in: FanInNode,
  phase_box: PhaseBoxNode,
} as const;
