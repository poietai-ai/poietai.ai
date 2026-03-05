# Agent-to-Agent Messaging Design

## Goal

Enable agents to message each other directly, with the user having full visibility and the ability to participate in any conversation — like a Slack workspace where agents are teammates.

## Core Concepts

### Conversation Model

All messaging (user↔agent, agent↔agent, group) flows through a unified `Conversation` entity:

```typescript
interface Conversation {
  id: string;                    // deterministic from sorted participant IDs, or uuid for groups
  type: 'dm' | 'channel';
  name?: string;                 // channels only
  participants: string[];        // agent IDs — user is always an implicit participant
  locked: boolean;               // true = 1:1 DM (can't add members), false = group (can add)
  createdAt: number;
  lastMessageAt: number;         // for sidebar sort order
}
```

### Conversation Types

| Type | Created by | Participants | Membership | Sidebar display |
|------|-----------|-------------|------------|-----------------|
| **User↔Agent 1:1** | Auto (first DM) | 1 agent | Locked | "Atlas" |
| **Agent↔Agent 1:1** | Auto (first `message_agent`) | 2 agents | Locked | "Atlas, Jules" |
| **Group DM** | User (compose button) | 1+ agents | Mutable (add/remove) | "Atlas, Jules, Morgan" |
| **Channel** | User | 1+ agents | Mutable | "#design-review" |

### Message Model Changes

`DmMessage.from` changes from `'agent' | 'user' | 'system'` to allow identifying which agent sent a message:

```typescript
from: 'user' | 'system' | string;  // string = agent ID
```

For backward compatibility in 1:1 DMs, `from: 'agent'` is still accepted and maps to the single participant.

`DmMessage.threadId` points to `Conversation.id`.

## MCP Tool: `message_agent`

New non-blocking MCP tool for agents to message other agents:

```
message_agent({
  agent_id: string,              // sender (required by MCP pattern)
  to: string[],                  // recipient agent ID(s)
  message: string,               // message content
  conversation_id?: string       // reuse existing conversation thread
})
→ Returns { conversation_id: string, message_id: string }
```

**Behavior:**
1. Find or create a `Conversation` for this participant set
2. Store message in messageStore
3. Emit `agent-message` Tauri event to frontend
4. For each idle recipient → wake their chat session
5. Return immediately (non-blocking)

**Conversation resolution:**
- If `conversation_id` provided → use that conversation
- If no `conversation_id` and exactly 1 recipient → find or create 1:1 DM (locked)
- If no `conversation_id` and 2+ recipients → create new group DM (unlocked)

## Wake Mechanism

When a message arrives for an idle agent:

1. Backend calls `chat_agent` with injected system context:
   ```
   [AGENT_MESSAGE from Atlas in "Atlas, Jules"]:
   Hey, finished the auth module. Can you review?
   ```
2. Agent's chat session processes and responds naturally
3. Response stored in the same conversation thread
4. Agent returns to idle

When agent is **busy** (working on a ticket):
- Message queues in `chatSessionStore.pushUpdate(agentId, update)`
- Gets injected as context on next chat resume

## UI Changes

### Sidebar

```
MESSAGES
  Atlas                    ← 1:1 user↔agent (locked)
  Jules                    ← 1:1 user↔agent (locked)
  Atlas, Jules             ← 1:1 agent↔agent or user group DM
  [+ New message]          ← compose button

CHANNELS
  # design-review
  [+ New channel]
```

- Sorted by `lastMessageAt` (most recent on top)
- Unread badges per conversation (existing unread tracking)

### Compose Flow (New Message Button)

1. Click [+ New message]
2. Opens picker: select 1+ agents
3. Type initial message
4. Creates Conversation (group DM, unlocked) + sends message + wakes agents

### Multi-Agent Thread View

- Every message shows avatar + agent name (no same-sender grouping in multi-agent threads)
- User messages right-aligned, agent messages left-aligned
- Input box at bottom — user can type at any time
- For group DMs (unlocked): "Add agent" button in thread header

### @-mentions

@-mentioning an agent inside an existing DM does NOT add them to the conversation. It's a clickable profile link (Slack behavior). To include someone, create a new group DM.

## Migration

On first load with new code:

1. For each existing DM thread (threadId = agentId):
   - Create `Conversation { id: agentId, participants: [agentId], type: 'dm', locked: true }`
2. For each existing channel:
   - Create `Conversation { id: channelId, participants: channel.agentIds, type: 'channel', name: channel.name, locked: false }`
3. Existing messages keep their `threadId` values (which now reference `Conversation.id`)

## Guardrails

- **Rate limit**: Max 10 agent messages per minute per conversation to prevent loops
- **Depth limit**: If a conversation exceeds 20 back-and-forth messages without user input, pause and notify user: "Atlas and Jules have been going back and forth — want to weigh in?"
- **Agent prompt update**: Chat prompt gets new instructions about messaging etiquette and the `message_agent` tool

## Chat Prompt Additions

```
## Messaging Other Agents
You can message other agents using `message_agent`. Use it when:
- You need a review of your work
- You have a question for a specialist
- You want to coordinate on a shared task
Keep messages casual and brief — like pinging a teammate on Slack.
Don't spam — if the other agent doesn't respond, wait or ask the user.
```

## Sync Points (New MCP Tool)

When adding `message_agent`, update three places:
1. `src-tauri/src/mcp/server.rs` — tool definition + handler
2. `src-tauri/src/lib.rs` — add to `chat_agent` allowed_tools
3. `src/components/messages/DmList.tsx` — add to `SLASH_COMMANDS` if needed
4. `src/lib/mcpTools.ts` — add tool definition
5. `src/lib/chatPromptBuilder.ts` — add messaging instructions

## Files Affected

| Layer | File | Changes |
|-------|------|---------|
| **Types** | `src/types/message.ts` | Add `Conversation` interface, update `DmMessage.from` |
| **Store** | `src/store/messageStore.ts` | Add conversations map, migration logic, conversation CRUD |
| **MCP (Rust)** | `src-tauri/src/mcp/server.rs` | Add `message_agent` tool definition + handler |
| **Backend** | `src-tauri/src/lib.rs` | Add `message_agent` to allowed tools, wake logic |
| **MCP tools** | `src/lib/mcpTools.ts` | Add `message_agent` entry |
| **Prompt** | `src/lib/chatPromptBuilder.ts` | Add agent messaging instructions |
| **UI** | `src/components/messages/DmList.tsx` | Multi-participant threads, compose button, sidebar changes |
| **Events** | `src/components/layout/AppShell.tsx` | Handle `agent-message` Tauri event, route to conversations |
