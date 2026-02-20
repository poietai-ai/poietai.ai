export type RoomType = 'brainstorm' | 'design-review' | 'standup' | 'war-room';

export type RoomStatus = 'active' | 'archived';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  status: RoomStatus;
  agentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  authorId: string; // agent id or 'user'
  content: string;
  createdAt: string;
}
