# DM & Channels Design

**Date:** 2026-03-04

## Context

The Messages view (sidebar Inbox icon) has a `DmList` component and `messageStore` that show per-agent threads. Currently:

- `messageStore` is ephemeral (no persistence)
- Events only captured when DmList is mounted (messages lost if on another view)
- Only `text`-type agent events captured
- No concept of channels

## Goals

1. Agent DMs auto-populated from all agent message types, across all tickets
2. Cross-ticket history per agent (Slack-style 1:1 DM)
3. User-created channels with one or more agents for topical discussions
4. Messages feel human, not like logs
5. Unread badge on sidebar Messages icon

## Data Model

### DmMessage

```typescript
interface DmMessage {
  id: string;
  threadId: string;            // agentId for DMs, channelId for channels
  threadType: 'dm' | 'channel';
  from: 'agent' | 'user' | 'system';
  agentId: string;
  agentName: string;
  content: string;
  type: 'text' | 'question' | 'choices' | 'status' | 'confirm' | 'reply';
  choices?: { label: string; description: string }[];
  actionDetails?: string;
  ticketId?: string;
  timestamp: number;
  resolved?: boolean;
  resolution?: string;
}
```

### Channel

```typescript
interface Channel {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
}
```

### Store shape (messageStore)

```typescript
interface MessageStore {
  threads: Record<string, DmMessage[]>; // threadId -> messages
  channels: Channel[];
  unreadCounts: Record<string, number>;
  activeThread: string | null;
  loaded: boolean;

  loadFromDisk: () => Promise<void>;
  addMessage: (message: DmMessage) => void;
  setActiveThread: (threadId: string) => void;
  markRead: (threadId: string) => void;
  addChannel: (channel: Channel) => void;
  totalUnread: () => number;
}
```

Persisted to `messages.json` via `@tauri-apps/plugin-store`, debounced at 500ms.

## Event Routing

All routing happens in `AppShell` (not `DmList`), so messages arrive regardless of active view.

| Tauri Event | DM type | Notes |
|---|---|---|
| `agent-event` (text) | `text` | Agent's own words |
| `agent-question` | `question` | Interactive, tracks `resolved` |
| `agent-choices` | `choices` | Content + choices array |
| `agent-confirm` | `confirm` | Content + actionDetails |
| `agent-status` | `status` | Compact system-style message |

**Not routed to DMs**: `thinking`, `tool_use`, `tool_result`, `result` events (canvas-only).

**Agent name resolution**: Look up `agentStore.agents` for real name, fall back to agentId.

**Thread key for DMs**: `agentId` (one thread per agent, all tickets mixed chronologically).

## UI Design

### DmList (two-column)

```
Left sidebar (w-56):
  "Direct Messages" header
  Agent threads: avatar + name + unread badge
  ---
  "Channels" header
  Channel threads: # prefix + name
  [+ New Channel] button

Right pane:
  Thread header: agent name or channel name
  Message list:
    Agent messages: left-aligned, avatar + timestamp
    User messages: right-aligned, violet background
    Status messages: centered, muted italic
    Questions/choices/confirms: interactive cards inline
    Ticket context: muted "re: ticket-1" tag on agent messages
  Message input: text field + send button at bottom
```

### Sidebar Badge

Unread count rendered on the Messages icon in `Sidebar.tsx`. Violet background, small rounded pill.

### Channel Creation

"+ New Channel" opens an inline form:
- Channel name text input
- Multi-select agent picker
- Create button

## Scope

### In scope (this iteration)
- Evolve `messageStore` with new data model + persistence
- Central event routing in `AppShell`
- Redesigned `DmList` with DM threads + channels section
- Human-feeling message rendering (avatars, timestamps, interactive cards, ticket context tags)
- Message input for user replies in DM threads
- Channel CRUD (create, list, select)
- Unread badge on sidebar
- Channel message input (user can type, stored locally)

### Out of scope (future)
- Agent responses in channels (needs new Tauri command / MCP routing)
- Breakout rooms (maps to existing Rooms nav item)
- Agent suggesting ticket creation from channel discussions
- Channel deletion/editing
