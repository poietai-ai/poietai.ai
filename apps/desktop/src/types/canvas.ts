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
  node_id: string;
  agent_id: string;
  ticket_id: string;
  event: AgentEventKind;
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
  | 'ci_review';

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: CanvasNodeType;
  agentId: string;
  ticketId: string;
  content: string;
  filePath?: string;
  /** Labels for grouped tool nodes (multiple consecutive calls of the same type). */
  items?: string[];
  diff?: string;
  sessionId?: string;
  approved?: boolean;
}

// Full node type for use in NodeProps — wraps CanvasNodeData in @xyflow/react's Node shape.
export type CanvasNode = Node<CanvasNodeData>;
