import { ThoughtNode } from './ThoughtNode';
import { FileNode } from './FileNode';
import { BashNode } from './BashNode';
import { AwaitingNode } from './AwaitingNode';

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
} as const;
