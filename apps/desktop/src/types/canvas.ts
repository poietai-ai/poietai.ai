import type { Node } from '@xyflow/react';

// These mirror the Rust AgentEvent enum exactly.
// When Tauri emits "agent-event", the payload has this shape.

export type AgentEventKind =
  | { type: 'thinking'; thinking: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; tool_name: string; tool_input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'result'; result?: string; session_id?: string };

export interface CanvasNodePayload {
  /** Optional explicit node id; derived from kind.id for tool_use, or auto-generated. */
  node_id?: string;
  agent_id: string;
  ticket_id: string;
  kind: AgentEventKind;
}

// Visual node types rendered by @xyflow/react
export type CanvasNodeType =
  | 'thought'
  | 'file_read'
  | 'file_edit'
  | 'file_write'
  | 'bash_command'
  | 'agent_message'
  | 'awaiting_user'
  | 'user_reply'
  | 'pr_opened'
  | 'ci_review'
  | 'plan_task'
  | 'validate_result'
  | 'qa_result'
  | 'security_result'
  | 'review_synthesis';

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: CanvasNodeType;
  agentId: string;
  ticketId: string;
  content: string;
  filePath?: string;
  /** Labels for grouped tool nodes (multiple consecutive calls of the same type). */
  items?: string[];
  fileContent?: string;
  diff?: string;
  sessionId?: string;
  approved?: boolean;
  // M2: ghost graph fields
  isGhost?: boolean;      // true = plan task not yet executed
  activated?: boolean;    // true = agent has touched this file
  taskId?: string;        // matches PlanTask.id
  action?: 'create' | 'modify' | 'delete';
  // M3: validate result summary
  validateSummary?: { verified: number; critical: number; advisory: number };
  // M4: QA result summary
  qaSummary?: { critical: number; warnings: number; advisory: number };
  // M5: security result summary
  securitySummary?: { critical: number; warnings: number };
  // M5: review synthesis summary
  synthesisSummary?: {
    validate: { critical: number; verified: number };
    qa: { critical: number; warnings: number; advisory: number };
    security: { critical: number; warnings: number };
  };
}

// Full node type for use in NodeProps — wraps CanvasNodeData in @xyflow/react's Node shape.
export type CanvasNode = Node<CanvasNodeData>;

/// Emitted by Tauri when Claude calls ask_human mid-task.
/// Agent stays running — answer via invoke('answer_agent', { agentId, reply }).
export interface AgentQuestionPayload {
  agent_id: string;
  question: string;
}
