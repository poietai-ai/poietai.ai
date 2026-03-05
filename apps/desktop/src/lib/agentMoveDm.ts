import type { TicketStatus, Ticket } from '../store/ticketStore';
import type { AgentStatus } from '../store/agentStore';
import { getMoveDirection, isAdjacentForward } from './statusOrder';
import { useMessageStore } from '../store/messageStore';
import { useAgentStore } from '../store/agentStore';
import { useToastStore } from '../store/toastStore';

const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  refined: 'Refined',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  in_review: 'In Review',
  shipped: 'Shipped',
  blocked: 'Blocked',
};

export function generateMoveDm(opts: {
  ticketTitle: string;
  oldStatus: TicketStatus;
  newStatus: TicketStatus;
  agentStatus: AgentStatus;
}): string | null {
  const { ticketTitle, oldStatus, newStatus, agentStatus } = opts;
  const direction = getMoveDirection(oldStatus, newStatus);

  if (direction === 'same') return null;

  if (direction === 'backward') {
    return `Hey, I saw you moved "${ticketTitle}" back to ${STATUS_LABELS[newStatus]}. Did something come up? Let me know what needs fixing.`;
  }

  // Forward move
  if (isAdjacentForward(oldStatus, newStatus) && agentStatus === 'idle') {
    return null; // Normal workflow progression, no need to nag
  }

  return `Just noticed you moved "${ticketTitle}" to ${STATUS_LABELS[newStatus]} — was the work already handled? I had progress on it.`;
}

export function notifyAgentOfMove(
  ticket: Ticket,
  oldStatus: TicketStatus,
  newStatus: TicketStatus,
): void {
  // Skip if either status is blocked (not a board column)
  if (oldStatus === 'blocked' || newStatus === 'blocked') return;

  // Find the first assigned agent
  const assignment = ticket.assignments[0];
  if (!assignment) return;

  const agent = useAgentStore.getState().agents.find((a) => a.id === assignment.agentId);
  if (!agent) return;

  const content = generateMoveDm({
    ticketTitle: ticket.title,
    oldStatus,
    newStatus,
    agentStatus: agent.status,
  });
  if (!content) return;

  const msgId = `dm-move-${agent.id}-${Date.now()}`;

  useMessageStore.getState().addMessage({
    id: msgId,
    threadId: agent.id,
    threadType: 'dm',
    from: 'agent',
    agentId: agent.id,
    agentName: agent.name,
    content,
    type: 'text',
    ticketId: ticket.id,
    timestamp: Date.now(),
  });

  useToastStore.getState().showToast({
    id: msgId,
    agentId: agent.id,
    agentName: agent.name,
    message: content,
    isQuestion: false,
    ticketId: ticket.id,
  });
}
