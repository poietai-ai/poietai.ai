import type { TicketStatus } from '../store/ticketStore';

export const STATUS_ORDER: TicketStatus[] = [
  'backlog', 'refined', 'assigned', 'in_progress', 'in_review', 'shipped',
];

export function statusIndex(status: TicketStatus): number {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? -1 : i;
}

export function getMoveDirection(
  oldStatus: TicketStatus,
  newStatus: TicketStatus,
): 'backward' | 'forward' | 'same' {
  const oldIdx = statusIndex(oldStatus);
  const newIdx = statusIndex(newStatus);
  if (oldIdx === newIdx) return 'same';
  return newIdx < oldIdx ? 'backward' : 'forward';
}

export function isAdjacentForward(
  oldStatus: TicketStatus,
  newStatus: TicketStatus,
): boolean {
  return statusIndex(newStatus) - statusIndex(oldStatus) === 1;
}
