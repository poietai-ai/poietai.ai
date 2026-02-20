export type TicketStatus =
  | 'backlog'
  | 'refined'
  | 'assigned'
  | 'in-progress'
  | 'in-review'
  | 'approved'
  | 'shipped';

export type TicketComplexity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: TicketComplexity;
  status: TicketStatus;
  assigneeId?: string; // agent id
  roomId?: string;     // originating room
  createdAt: string;
  updatedAt: string;
}
