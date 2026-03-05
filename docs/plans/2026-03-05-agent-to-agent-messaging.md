# Agent-to-Agent Messaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable agents to message each other in Slack-style DM conversations, with the user as an observer who can jump in at any point.

**Architecture:** Replace the current single-agent-per-thread model with a multi-participant `Conversation` entity. Agent-to-agent DMs auto-create on first message. Users create group DMs via a compose button. A new `message_agent` MCP tool lets agents initiate conversations. Idle recipients get woken via `chat_agent`.

**Tech Stack:** React 19, Zustand, Tauri 2 (Rust/axum MCP server), TypeScript

**Design doc:** `docs/plans/2026-03-05-agent-to-agent-messaging-design.md`

---

### Task 1: Add Conversation type to message types

**Files:**
- Modify: `apps/desktop/src/types/message.ts:1-27`

**Step 1: Add Conversation interface and update DmMessage**

Add the `Conversation` interface and widen `DmMessage.from` to support agent IDs:

```typescript
export interface Conversation {
  id: string;
  type: 'dm' | 'channel';
  name?: string;                 // channels only
  participants: string[];        // agent IDs (user is always implicit)
  locked: boolean;               // true = 1:1 (can't add members), false = group
  createdAt: number;
  lastMessageAt: number;
}

export interface DmMessage {
  id: string;
  threadId: string;              // Conversation.id
  threadType: 'dm' | 'channel';
  from: string;                  // 'user' | 'system' | 'agent' | <agentId>
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
  parentId?: string;
  replyCount?: number;
  lastReplyAt?: number;
  sessionId?: string;
}

export interface Channel {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
}
```

Key changes:
- `DmMessage.from` widens from `'agent' | 'user' | 'system'` to `string` so it can hold an agent ID
- New `Conversation` interface exported
- `Channel` stays for backward compat (migration in Task 2)

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -20`
Expected: No new errors (existing badge/button ref errors are pre-existing)

**Step 3: Commit**

```bash
git add apps/desktop/src/types/message.ts
git commit -m "feat: add Conversation type, widen DmMessage.from to string"
```

---

### Task 2: Add conversations to messageStore with migration

**Files:**
- Modify: `apps/desktop/src/store/messageStore.ts:1-168`

**Step 1: Write the tests**

Create `apps/desktop/src/store/messageStore.conversations.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock projectFileIO before importing store
vi.mock('../lib/projectFileIO', () => ({
  readProjectStore: vi.fn().mockResolvedValue(null),
  writeProjectStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./projectStore', () => ({
  getActiveProjectRoot: vi.fn(() => '/mock/root'),
}));

import { useMessageStore } from './messageStore';
import type { Conversation } from '../types/message';

describe('messageStore conversations', () => {
  beforeEach(() => {
    useMessageStore.setState({
      threads: {},
      channels: [],
      conversations: [],
      unreadCounts: {},
      activeThread: null,
      openThreadParentId: null,
      loaded: false,
    });
  });

  it('addConversation adds and persists a conversation', () => {
    const conv: Conversation = {
      id: 'conv-1',
      type: 'dm',
      participants: ['agent-a', 'agent-b'],
      locked: true,
      createdAt: 1000,
      lastMessageAt: 1000,
    };
    useMessageStore.getState().addConversation(conv);
    expect(useMessageStore.getState().conversations).toHaveLength(1);
    expect(useMessageStore.getState().conversations[0].id).toBe('conv-1');
  });

  it('findOrCreateDm finds existing conversation', () => {
    const conv: Conversation = {
      id: 'dm-ab',
      type: 'dm',
      participants: ['agent-a', 'agent-b'],
      locked: true,
      createdAt: 1000,
      lastMessageAt: 1000,
    };
    useMessageStore.getState().addConversation(conv);
    const found = useMessageStore.getState().findOrCreateDm(['agent-a', 'agent-b']);
    expect(found.id).toBe('dm-ab');
  });

  it('findOrCreateDm creates new locked DM when not found', () => {
    const conv = useMessageStore.getState().findOrCreateDm(['agent-x', 'agent-y']);
    expect(conv.locked).toBe(true);
    expect(conv.participants).toEqual(['agent-x', 'agent-y']);
    expect(useMessageStore.getState().conversations).toHaveLength(1);
  });

  it('updateConversation patches fields', () => {
    useMessageStore.getState().addConversation({
      id: 'conv-1', type: 'dm', participants: ['a'], locked: false,
      createdAt: 1000, lastMessageAt: 1000,
    });
    useMessageStore.getState().updateConversation('conv-1', { lastMessageAt: 2000 });
    expect(useMessageStore.getState().conversations[0].lastMessageAt).toBe(2000);
  });

  it('addMessage updates conversation lastMessageAt', () => {
    useMessageStore.getState().addConversation({
      id: 'conv-1', type: 'dm', participants: ['agent-a'],
      locked: true, createdAt: 1000, lastMessageAt: 1000,
    });
    useMessageStore.getState().addMessage({
      id: 'msg-1', threadId: 'conv-1', threadType: 'dm',
      from: 'user', agentId: '', agentName: 'You',
      content: 'hello', type: 'text', timestamp: 5000,
    });
    expect(useMessageStore.getState().conversations[0].lastMessageAt).toBe(5000);
  });

  it('migrateToConversations creates conversations from legacy threads', () => {
    // Simulate legacy state: threads keyed by agentId, no conversations
    useMessageStore.setState({
      threads: {
        'agent-a': [{ id: 'm1', threadId: 'agent-a', threadType: 'dm' as const, from: 'agent', agentId: 'agent-a', agentName: 'A', content: 'hi', type: 'text' as const, timestamp: 1000 }],
      },
      channels: [{ id: 'ch-1', name: 'general', agentIds: ['agent-a'], createdAt: 500 }],
      conversations: [],
      unreadCounts: {},
      activeThread: null,
      openThreadParentId: null,
      loaded: true,
    });
    useMessageStore.getState().migrateToConversations();
    const convs = useMessageStore.getState().conversations;
    // Should create one for the DM thread and one for the channel
    expect(convs.length).toBe(2);
    const dmConv = convs.find((c) => c.id === 'agent-a');
    expect(dmConv?.locked).toBe(true);
    expect(dmConv?.participants).toEqual(['agent-a']);
    const chConv = convs.find((c) => c.id === 'ch-1');
    expect(chConv?.type).toBe('channel');
    expect(chConv?.name).toBe('general');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/store/messageStore.conversations.test.ts`
Expected: FAIL — `addConversation`, `findOrCreateDm`, `updateConversation`, `migrateToConversations` don't exist yet

**Step 3: Add conversations to store interface and implementation**

In `apps/desktop/src/store/messageStore.ts`, add to the `MessageStore` interface (after line 12):

```typescript
  conversations: Conversation[];
  addConversation: (conversation: Conversation) => void;
  findOrCreateDm: (participants: string[]) => Conversation;
  updateConversation: (id: string, patch: Partial<Pick<Conversation, 'name' | 'participants' | 'lastMessageAt'>>) => void;
  migrateToConversations: () => void;
```

Add `Conversation` to the import on line 4:
```typescript
import type { DmMessage, Channel, Conversation } from '../types/message';
```

Add initial state in `create()` (after line 49):
```typescript
  conversations: [],
```

Add persistence — update `debouncedPersistMessages` (line 37-40) to also save conversations:
```typescript
      await writeProjectStore(root, 'messages.json', {
        threads: get().threads,
        channels: get().channels,
        conversations: get().conversations,
      });
```

Add to `loadFromDisk` — update the type and destructure (lines 63-69):
```typescript
      const saved = await readProjectStore<{
        threads: Record<string, DmMessage[]>;
        channels: Channel[];
        conversations?: Conversation[];
      }>(root, 'messages.json');
      const threads = saved?.threads ?? {};
      const channels = saved?.channels ?? [];
      const conversations = saved?.conversations ?? [];
      set({ threads, channels, conversations, loaded: true });
```

Update `addMessage` (after line 97, before `debouncedPersistMessages`) to bump `lastMessageAt`:
```typescript
    // Update conversation lastMessageAt
    const conversations = get().conversations.map((c) =>
      c.id === message.threadId ? { ...c, lastMessageAt: message.timestamp } : c
    );
    // Include conversations in the set call
```

Merge the conversations into the existing `set()` call on line 91.

Add the new methods after `updateChannel` (after line 137):

```typescript
  addConversation: (conversation) => {
    set((state) => ({ conversations: [...state.conversations, conversation] }));
    debouncedPersistMessages(get);
  },

  findOrCreateDm: (participants) => {
    const sorted = [...participants].sort();
    const existing = get().conversations.find(
      (c) => c.type === 'dm' && c.locked &&
        c.participants.length === sorted.length &&
        [...c.participants].sort().every((p, i) => p === sorted[i])
    );
    if (existing) return existing;

    const conv: Conversation = {
      id: `dm-${sorted.join('-')}`,
      type: 'dm',
      participants: sorted,
      locked: true,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    get().addConversation(conv);
    return conv;
  },

  updateConversation: (id, patch) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    }));
    debouncedPersistMessages(get);
  },

  migrateToConversations: () => {
    const { threads, channels, conversations } = get();
    if (conversations.length > 0) return; // Already migrated

    const newConvs: Conversation[] = [];
    const channelIds = new Set(channels.map((c) => c.id));

    // Migrate DM threads (threadId = agentId)
    for (const threadId of Object.keys(threads)) {
      if (channelIds.has(threadId)) continue;
      const msgs = threads[threadId];
      const lastMsg = msgs[msgs.length - 1];
      newConvs.push({
        id: threadId,
        type: 'dm',
        participants: [threadId],
        locked: true,
        createdAt: msgs[0]?.timestamp ?? Date.now(),
        lastMessageAt: lastMsg?.timestamp ?? Date.now(),
      });
    }

    // Migrate channels
    for (const ch of channels) {
      newConvs.push({
        id: ch.id,
        type: 'channel',
        name: ch.name,
        participants: ch.agentIds,
        locked: false,
        createdAt: ch.createdAt,
        lastMessageAt: threads[ch.id]?.slice(-1)[0]?.timestamp ?? ch.createdAt,
      });
    }

    set({ conversations: newConvs });
    debouncedPersistMessages(get);
  },
```

Update `resetForProjectSwitch` (line 156) to also clear conversations:
```typescript
    set({ threads: {}, channels: [], conversations: [], unreadCounts: {}, activeThread: null, openThreadParentId: null, loaded: false });
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/store/messageStore.conversations.test.ts`
Expected: All 6 tests PASS

**Step 5: Run all tests to check for regressions**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/store/messageStore.ts apps/desktop/src/store/messageStore.conversations.test.ts
git commit -m "feat: add Conversation to messageStore with migration from legacy threads"
```

---

### Task 3: Add `message_agent` MCP tool definition (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp/server.rs:197-444` (tools/list)
- Modify: `apps/desktop/src-tauri/src/mcp/server.rs:446-781` (tools/call)

**Step 1: Add tool definition to tools/list**

In `server.rs`, inside the `"tools"` array (before the closing `]` around line 442), add:

```rust
                    {
                        "name": "message_agent",
                        "description": "Send a message to another agent. Creates a DM conversation if one doesn't exist. Non-blocking — returns immediately.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "to": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "Recipient agent ID(s)"
                                },
                                "message": {
                                    "type": "string",
                                    "description": "The message to send"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID, exactly as given in your system prompt"
                                },
                                "conversation_id": {
                                    "type": "string",
                                    "description": "Optional — reuse an existing conversation thread"
                                }
                            },
                            "required": ["to", "message", "agent_id"]
                        }
                    }
```

**Step 2: Add handler to tools/call**

In the `match tool_name` block (before the `_ =>` fallback around line 775), add:

```rust
                "message_agent" => {
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let message = args.get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let to: Vec<String> = args.get("to")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let conversation_id = args.get("conversation_id")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    // Emit to frontend — it handles conversation creation and wake
                    let _ = state.app.emit("agent-message", json!({
                        "from_agent_id": agent_id,
                        "to": to,
                        "message": message,
                        "conversation_id": conversation_id,
                    }));

                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": "Message sent." }],
                            "isError": false
                        }
                    }))
                }
```

**Step 3: Verify Rust compiles**

Run: `cd apps/desktop && cargo build 2>&1 | tail -5`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/server.rs
git commit -m "feat: add message_agent MCP tool definition and handler"
```

---

### Task 4: Wire `message_agent` into allowed tools and frontend registry

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs:343-358`
- Modify: `apps/desktop/src/lib/mcpTools.ts:7-19`
- Modify: `apps/desktop/src/lib/chatPromptBuilder.ts`

**Step 1: Add to chat_agent allowed_tools in lib.rs**

In `lib.rs`, add to the `allowed_tools` vec (after `relay_answer` at line 357):

```rust
            "mcp__poietai__message_agent".to_string(),
```

**Step 2: Add to MCP_TOOLS array in mcpTools.ts**

In `mcpTools.ts`, add after the `relay_answer` entry (line 18):

```typescript
  { name: 'message_agent', description: 'Send a message to another agent', slashCommand: false },
```

**Step 3: Add messaging instructions to chatPromptBuilder.ts**

In `chatPromptBuilder.ts`, add after the tool notes section (after line 84, before the "Coding session questions" section):

```typescript
    '',
    '## Messaging Other Agents',
    'You can message other agents using `message_agent`. Use it when:',
    '- You need someone to review your work',
    '- You have a question for a specialist',
    '- You want to coordinate on a shared task',
    'Keep messages casual and brief — like pinging a teammate.',
    'Don\'t spam — if the other agent doesn\'t respond, wait or ask the user.',
```

Also add `message_agent` to the tool notes:
```typescript
    '- `message_agent` takes to (array of agent IDs) + message — sends a DM to another agent',
```

**Step 4: Verify TypeScript and Rust compile**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -10`
Run: `cd apps/desktop && cargo build 2>&1 | tail -5`
Expected: Both compile

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/mcpTools.ts apps/desktop/src/lib/chatPromptBuilder.ts
git commit -m "feat: wire message_agent into allowed tools, registry, and prompt"
```

---

### Task 5: Handle `agent-message` event in AppShell + wake recipient

**Files:**
- Modify: `apps/desktop/src/components/layout/AppShell.tsx:142-260`

**Step 1: Add the agent-message event listener**

In `AppShell.tsx`, add a new `useEffect` alongside the existing event listeners (after the `agent-confirm` listener, around line 260):

```typescript
  // Agent-to-agent message listener
  useEffect(() => {
    const unlisten = listen<{
      from_agent_id: string;
      to: string[];
      message: string;
      conversation_id?: string;
    }>('agent-message', (event) => {
      const { from_agent_id, to, message, conversation_id } = event.payload;
      const fromAgent = useAgentStore.getState().agents.find((a) => a.id === from_agent_id);
      const store = useMessageStore.getState();

      // Find or create conversation
      let convId = conversation_id;
      if (!convId) {
        const participants = [from_agent_id, ...to];
        const conv = store.findOrCreateDm(participants);
        convId = conv.id;
      }

      // Add the message to the conversation thread
      store.addMessage({
        id: `agent-msg-${from_agent_id}-${Date.now()}`,
        threadId: convId,
        threadType: 'dm',
        from: from_agent_id,
        agentId: from_agent_id,
        agentName: fromAgent?.name ?? from_agent_id,
        content: message,
        type: 'text',
        timestamp: Date.now(),
      });

      // Wake each idle recipient agent
      for (const recipientId of to) {
        const recipient = useAgentStore.getState().agents.find((a) => a.id === recipientId);
        if (!recipient || recipient.chatting) continue;

        // Build context for the wake
        const tickets = useTicketStore.getState().tickets;
        const contextUpdate = useChatSessionStore.getState().flushUpdates(recipientId);
        const { projects, activeProjectId } = useProjectStore.getState();
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectRoot = activeProject?.repos[0]?.repoRoot;
        const systemPrompt = buildChatPrompt({
          agent: recipient,
          tickets,
          projectName: activeProject?.name,
          projectRoot,
        });

        const wakeMessage = `[AGENT_MESSAGE from ${fromAgent?.name ?? from_agent_id}]: ${message}`;

        invoke('chat_agent', {
          payload: {
            agent_id: recipientId,
            message: wakeMessage,
            system_prompt: systemPrompt,
            context_update: contextUpdate,
          },
        }).catch((err) => {
          console.warn(`[agent-message] failed to wake ${recipientId}:`, err);
          // Queue as context update instead
          useChatSessionStore.getState().pushUpdate(
            recipientId,
            `Message from ${fromAgent?.name ?? from_agent_id}: ${message}`
          );
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);
```

Make sure `buildChatPrompt` and `useChatSessionStore` are imported at the top of AppShell.tsx. Check existing imports — `buildChatPrompt` may already be imported for the nudge logic.

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -10`
Expected: No new errors

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/AppShell.tsx
git commit -m "feat: handle agent-message events, wake idle recipient agents"
```

---

### Task 6: Update DmList sidebar to show multi-agent conversations

**Files:**
- Modify: `apps/desktop/src/components/messages/DmList.tsx:557-1000`

**Step 1: Call migration on load**

In `DmList`, add a `useEffect` that calls `migrateToConversations` once when the store is loaded:

```typescript
  const conversations = useMessageStore((s) => s.conversations);
  const migrateToConversations = useMessageStore((s) => s.migrateToConversations);
  const loaded = useMessageStore((s) => s.loaded);

  useEffect(() => {
    if (loaded && conversations.length === 0) {
      migrateToConversations();
    }
  }, [loaded, conversations.length, migrateToConversations]);
```

**Step 2: Replace dmThreadIds with conversation-based list**

Replace the current `dmThreadIds` memo (lines 583-588) with:

```typescript
  // Build conversation list: existing conversations + ensure all agents have a 1:1
  const sortedConversations = useMemo(() => {
    // Ensure every agent has a 1:1 conversation stub
    const convMap = new Map(conversations.map((c) => [c.id, c]));
    const stubs: Conversation[] = [];
    for (const agent of agents) {
      if (!convMap.has(agent.id)) {
        stubs.push({
          id: agent.id,
          type: 'dm',
          participants: [agent.id],
          locked: true,
          createdAt: Date.now(),
          lastMessageAt: 0,
        });
      }
    }
    const all = [...conversations.filter((c) => c.type === 'dm'), ...stubs];
    return all.sort((a, b) => {
      // Agent 1:1s with no messages go to bottom, sorted by name
      if (a.lastMessageAt === 0 && b.lastMessageAt === 0) return 0;
      if (a.lastMessageAt === 0) return 1;
      if (b.lastMessageAt === 0) return -1;
      return b.lastMessageAt - a.lastMessageAt;
    });
  }, [conversations, agents]);
```

**Step 3: Update sidebar rendering**

Replace the `dmThreadIds.map(...)` block (lines 964-994) with:

```typescript
  {sortedConversations.map((conv) => {
    const unread = unreadCounts[conv.id] ?? 0;
    const isActive = activeThread === conv.id;

    // Display name: single agent name for 1:1, comma-separated for multi
    const displayName = conv.participants.length === 1
      ? agentNameFor(conv.participants[0])
      : conv.participants.map(agentNameFor).join(', ');

    // Avatar: first participant's initial
    const avatarName = agentNameFor(conv.participants[0]);

    return (
      <button
        key={conv.id}
        onClick={() => setActiveThread(conv.id)}
        onContextMenu={(e) => {
          if (conv.participants.length !== 1) return;
          const agent = agents.find((a) => a.id === conv.participants[0]);
          if (!agent) return;
          e.preventDefault();
          setAgentContextMenu({ x: e.clientX, y: e.clientY, agent });
        }}
        className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-sm
          hover:bg-zinc-800 transition-colors text-left
          ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
      >
        {conv.participants.length === 1 ? (
          <div className="w-6 h-6 rounded bg-violet-700 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
            {avatarName.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="w-6 h-6 rounded bg-indigo-700 flex items-center justify-center text-[9px] text-white font-bold flex-shrink-0">
            {conv.participants.length}
          </div>
        )}
        <span className="flex-1 truncate">{displayName}</span>
        {unread > 0 && (
          <span className="bg-violet-600 text-white text-xs rounded-full px-1.5 py-0.5">
            {unread}
          </span>
        )}
      </button>
    );
  })}
```

**Step 4: Update `isChannel` and handleSend for multi-agent conversations**

The `isChannel` check (line 589) currently uses `channelIds`. Keep it. But update `handleSend` (lines 729-793) so that when the user types in a multi-agent conversation, all participant agents are woken:

After the current DM send block (`if (!isChannel)` at line 754), replace the agent-finding logic:

```typescript
    if (!isChannel) {
      // Find which conversation this is
      const conv = conversations.find((c) => c.id === activeThread);
      const participantIds = conv ? conv.participants : [activeThread];

      for (const agentId of participantIds) {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent) continue;

        const tickets = useTicketStore.getState().tickets;
        const contextUpdate = useChatSessionStore.getState().flushUpdates(agentId);
        const { projects, activeProjectId } = useProjectStore.getState();
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectRoot = activeProject?.repos[0]?.repoRoot;
        const systemPrompt = buildChatPrompt({
          agent,
          tickets,
          projectName: activeProject?.name,
          projectRoot,
        });

        try {
          await invoke('chat_agent', {
            payload: {
              agent_id: agentId,
              message,
              system_prompt: systemPrompt,
              context_update: contextUpdate,
            },
          });
        } catch (err) {
          console.warn(`[chat_agent] invoke failed for ${agentId}:`, err);
        }
      }
    }
```

**Step 5: Update message rendering for multi-agent threads**

In the `MessageBubble` component, when `conv.participants.length > 1`, always show agent name and avatar (don't group by sender). The existing `isSameGroup` function (line 36) already handles this — just ensure the `from` field is used correctly.

Update the agent name resolution for messages where `from` is an agent ID (not just `'agent'`):

```typescript
  // In the message rendering, resolve from field:
  const senderName = msg.from === 'user' ? 'You'
    : msg.from === 'system' ? ''
    : msg.from === 'agent' ? msg.agentName  // legacy
    : agentNameFor(msg.from) || msg.agentName;
```

**Step 6: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -10`
Expected: No new errors

**Step 7: Commit**

```bash
git add apps/desktop/src/components/messages/DmList.tsx
git commit -m "feat: multi-participant conversation sidebar and message routing"
```

---

### Task 7: Add compose button for new group DMs

**Files:**
- Modify: `apps/desktop/src/components/messages/DmList.tsx`

**Step 1: Create NewGroupDmForm component**

Add a new component in `DmList.tsx` (near the existing `NewChannelForm` around line 426):

```typescript
function NewGroupDmForm({ onClose }: { onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const addConversation = useMessageStore((s) => s.addConversation);
  const setActiveThread = useMessageStore((s) => s.setActiveThread);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  const handleCreate = () => {
    if (selectedAgentIds.size === 0) return;
    const participants = [...selectedAgentIds];
    const id = crypto.randomUUID();
    const conv: Conversation = {
      id,
      type: 'dm',
      participants,
      locked: false, // Group DMs are mutable
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    addConversation(conv);
    setActiveThread(id);
    onClose();
  };

  return (
    <div className="px-4 py-2 border-b border-zinc-800">
      <p className="text-xs text-zinc-400 mb-1">Select agents for group DM:</p>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedAgentIds.has(a.id)}
              onChange={() => {
                const next = new Set(selectedAgentIds);
                next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                setSelectedAgentIds(next);
              }}
              className="rounded border-zinc-600"
            />
            {a.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={selectedAgentIds.size === 0}
          className="text-xs bg-violet-700 hover:bg-violet-600 text-white rounded px-2 py-1 disabled:opacity-50"
        >
          Create
        </button>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Add compose button to sidebar**

In the sidebar, add a "+ New message" button before the DM list (after the "Direct Messages" header around line 958):

```typescript
          <div className="px-4 mb-2 flex items-center justify-between">
            <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
              Direct Messages
            </h2>
            <button
              type="button"
              onClick={() => setShowNewGroupDm((v) => !v)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="New group message"
            >
              <Plus size={14} />
            </button>
          </div>

          {showNewGroupDm && <NewGroupDmForm onClose={() => setShowNewGroupDm(false)} />}
```

Add `showNewGroupDm` state to the component:

```typescript
  const [showNewGroupDm, setShowNewGroupDm] = useState(false);
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -10`
Expected: No new errors

**Step 4: Commit**

```bash
git add apps/desktop/src/components/messages/DmList.tsx
git commit -m "feat: add compose button for creating group DM conversations"
```

---

### Task 8: Add rate limiting and depth guardrails

**Files:**
- Modify: `apps/desktop/src/components/layout/AppShell.tsx` (agent-message listener)

**Step 1: Write the rate limit test**

Create `apps/desktop/src/lib/agentMessageRateLimit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { checkAgentMessageRate, resetRateLimits } from './agentMessageRateLimit';

describe('agentMessageRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows messages under the rate limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkAgentMessageRate('conv-1', 'agent-a')).toBe(true);
    }
  });

  it('blocks messages over the rate limit', () => {
    for (let i = 0; i < 10; i++) {
      checkAgentMessageRate('conv-1', 'agent-a');
    }
    expect(checkAgentMessageRate('conv-1', 'agent-a')).toBe(false);
  });

  it('tracks conversations independently', () => {
    for (let i = 0; i < 10; i++) {
      checkAgentMessageRate('conv-1', 'agent-a');
    }
    // Different conversation should still be allowed
    expect(checkAgentMessageRate('conv-2', 'agent-a')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/lib/agentMessageRateLimit.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement rate limiter**

Create `apps/desktop/src/lib/agentMessageRateLimit.ts`:

```typescript
const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 10;

// Map of conversationId -> timestamps of agent messages
const messageTimestamps: Map<string, number[]> = new Map();

/**
 * Check if an agent message is within rate limits.
 * Returns true if allowed, false if rate limited.
 */
export function checkAgentMessageRate(conversationId: string, _agentId: string): boolean {
  const now = Date.now();
  const key = conversationId;
  const timestamps = messageTimestamps.get(key) ?? [];

  // Remove timestamps outside the window
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    messageTimestamps.set(key, recent);
    return false;
  }

  recent.push(now);
  messageTimestamps.set(key, recent);
  return true;
}

/**
 * Check if a conversation has had too many agent-only messages without user input.
 * Returns true if the conversation should be paused.
 */
export function checkConversationDepth(conversationId: string, messages: { from: string }[]): boolean {
  const DEPTH_LIMIT = 20;
  let agentOnly = 0;
  // Count consecutive agent messages from the end
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === 'user') break;
    if (messages[i].from !== 'system') agentOnly++;
  }
  return agentOnly >= DEPTH_LIMIT;
}

export function resetRateLimits(): void {
  messageTimestamps.clear();
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/lib/agentMessageRateLimit.test.ts`
Expected: All 3 tests PASS

**Step 5: Integrate into AppShell agent-message listener**

In the `agent-message` event listener (from Task 5), add rate limiting before the message is stored:

```typescript
      import { checkAgentMessageRate, checkConversationDepth } from '../../lib/agentMessageRateLimit';

      // Rate limit check
      if (!checkAgentMessageRate(convId, from_agent_id)) {
        console.warn(`[agent-message] rate limited: ${from_agent_id} in ${convId}`);
        return;
      }

      // After adding message, check conversation depth
      const threadMsgs = useMessageStore.getState().threads[convId] ?? [];
      if (checkConversationDepth(convId, threadMsgs)) {
        store.addMessage({
          id: `depth-warn-${Date.now()}`,
          threadId: convId,
          threadType: 'dm',
          from: 'system',
          agentId: '',
          agentName: 'System',
          content: 'Conversation paused — agents have been going back and forth. Want to weigh in?',
          type: 'status',
          timestamp: Date.now(),
        });
        return; // Don't wake agents
      }
```

**Step 6: Run all tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/lib/agentMessageRateLimit.ts apps/desktop/src/lib/agentMessageRateLimit.test.ts apps/desktop/src/components/layout/AppShell.tsx
git commit -m "feat: add rate limiting and depth guardrails for agent-to-agent messaging"
```

---

### Task 9: TypeScript check and final integration test

**Files:**
- No new files

**Step 1: Run full TypeScript check**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | grep -v 'badge\|button' | head -20`
Expected: No new errors

**Step 2: Run full test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

**Step 3: Verify Rust compiles**

Run: `cd apps/desktop && cargo build 2>&1 | tail -5`
Expected: Compiles successfully

**Step 4: Final commit if any fixes needed**

If any issues found, fix and commit with descriptive message.
