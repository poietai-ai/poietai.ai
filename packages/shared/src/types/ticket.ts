export type TicketPhase =
  | 'brief'
  | 'design'
  | 'review'
  | 'plan'
  | 'build'
  | 'validate'
  | 'qa'
  | 'security'
  | 'ship';

export type TicketStatus =
  | 'backlog'
  | 'refined'
  | 'assigned'
  | 'in_progress'
  | 'in_review'
  | 'shipped';

export type TicketComplexity = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Artifact {
  phase: TicketPhase;
  /** Markdown or structured JSON string produced by this phase's agent */
  content: string;
  createdAt: string;
  agentId?: string;
}

export interface Assignment {
  agentId: string;
  repoId: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  complexity: TicketComplexity;
  status: TicketStatus;
  assignments: Assignment[];
  acceptanceCriteria: string[];
  /** Ordered phase pipeline, computed from complexity at ticket creation */
  phases: TicketPhase[];
  /** The phase currently being executed */
  activePhase?: TicketPhase;
  /** Artifact produced by each completed phase */
  artifacts: Partial<Record<TicketPhase, Artifact>>;
  roomId?: string;
  createdAt: string;
  updatedAt: string;
}
