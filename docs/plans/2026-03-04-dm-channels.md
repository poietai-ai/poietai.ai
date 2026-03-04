# DM & Channels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slack-style agent DMs with cross-ticket history, user-created channels, central event routing, persistence, and sidebar unread badge.

**Architecture:** Evolve `messageStore` into the messaging backbone with `DmMessage` type, per-agent threads, channels, persistence via `@tauri-apps/plugin-store`. Move event routing from `DmList` to `AppShell` so messages arrive regardless of active view. `DmList` becomes a pure view component with two-column layout (DM threads + channels).

**Tech Stack:** React 19, Zustand, @tauri-apps/plugin-store, Tailwind CSS 4, Lucide icons

---

### Task 1: Update message types

**Files:**
- Modify: `apps/desktop/src/types/message.ts`

**Step 1: Replace Message type with DmMessage and Channel**

Replace the entire contents of `apps/desktop/src/types/message.ts` with:

```typescript
export interface DmMessage {
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

export interface Channel {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/types/message.ts
git commit -m "feat: replace Message type with DmMessage + Channel for DM/channel support"
```

---

### Task 2: Rewrite messageStore with persistence and channels

**Files:**
- Modify: `apps/desktop/src/store/messageStore.ts`
- Create: `apps/desktop/src/store/messageStore.test.ts`

**Step 1: Write the failing tests**

Create `apps/desktop/src/store/messageStore.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { useMessageStore } from './messageStore';
import type { DmMessage, Channel } from '../types/message';

function makeDm(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    threadId: 'agent-1',
    threadType: 'dm',
    from: 'agent',
    agentId: 'agent-1',
    agentName: 'Ada',
    content: 'Hello',
    type: 'text',
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  useMessageStore.setState({
    threads: {},
    channels: [],
    unreadCounts: {},
    activeThread: null,
    loaded: false,
  });
});

describe('addMessage', () => {
  it('creates a thread and appends the message', () => {
    const msg = makeDm();
    useMessageStore.getState().addMessage(msg);
    const thread = useMessageStore.getState().threads['agent-1'];
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('Hello');
  });

  it('increments unread when thread is not active', () => {
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(1);
  });

  it('does not increment unread when thread is active', () => {
    useMessageStore.getState().setActiveThread('agent-1');
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });

  it('appends to existing thread', () => {
    useMessageStore.getState().addMessage(makeDm({ content: 'first' }));
    useMessageStore.getState().addMessage(makeDm({ content: 'second' }));
    expect(useMessageStore.getState().threads['agent-1']).toHaveLength(2);
  });
});

describe('setActiveThread', () => {
  it('sets activeThread and clears unread', () => {
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(1);
    useMessageStore.getState().setActiveThread('agent-1');
    expect(useMessageStore.getState().activeThread).toBe('agent-1');
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });
});

describe('markRead', () => {
  it('zeroes unread for the given threadId', () => {
    useMessageStore.getState().addMessage(makeDm());
    useMessageStore.getState().addMessage(makeDm());
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(2);
    useMessageStore.getState().markRead('agent-1');
    expect(useMessageStore.getState().unreadCounts['agent-1']).toBe(0);
  });
});

describe('totalUnread', () => {
  it('sums unread across all threads', () => {
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-1', agentId: 'agent-1' }));
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-2', agentId: 'agent-2' }));
    useMessageStore.getState().addMessage(makeDm({ threadId: 'agent-2', agentId: 'agent-2' }));
    expect(useMessageStore.getState().totalUnread()).toBe(3);
  });

  it('returns 0 when all read', () => {
    expect(useMessageStore.getState().totalUnread()).toBe(0);
  });
});

describe('channels', () => {
  it('addChannel appends to channels list', () => {
    const ch: Channel = { id: 'ch-1', name: 'auth-redesign', agentIds: ['agent-1'], createdAt: Date.now() };
    useMessageStore.getState().addChannel(ch);
    expect(useMessageStore.getState().channels).toHaveLength(1);
    expect(useMessageStore.getState().channels[0].name).toBe('auth-redesign');
  });

  it('channel messages go to channel thread', () => {
    const ch: Channel = { id: 'ch-1', name: 'perf', agentIds: ['agent-1'], createdAt: Date.now() };
    useMessageStore.getState().addChannel(ch);
    useMessageStore.getState().addMessage(makeDm({ threadId: 'ch-1', threadType: 'channel' }));
    expect(useMessageStore.getState().threads['ch-1']).toHaveLength(1);
  });
});

describe('resolveMessage', () => {
  it('marks a message as resolved with resolution text', () => {
    const msg = makeDm({ type: 'question', resolved: false });
    useMessageStore.getState().addMessage(msg);
    useMessageStore.getState().resolveMessage(msg.id, 'Yes, do it');
    const thread = useMessageStore.getState().threads['agent-1'];
    expect(thread[0].resolved).toBe(true);
    expect(thread[0].resolution).toBe('Yes, do it');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/store/messageStore.test.ts`
Expected: FAIL — store API doesn't match yet

**Step 3: Rewrite messageStore**

Replace the entire contents of `apps/desktop/src/store/messageStore.ts` with:

```typescript
import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import type { DmMessage, Channel } from '../types/message';

interface MessageStore {
  threads: Record<string, DmMessage[]>;
  channels: Channel[];
  unreadCounts: Record<string, number>;
  activeThread: string | null;
  loaded: boolean;

  loadFromDisk: () => Promise<void>;
  addMessage: (message: DmMessage) => void;
  resolveMessage: (id: string, resolution: string) => void;
  setActiveThread: (threadId: string) => void;
  markRead: (threadId: string) => void;
  addChannel: (channel: Channel) => void;
  totalUnread: () => number;
}

const MSG_PERSIST_DEBOUNCE_MS = 500;

async function getMessageStoreFile() {
  return load('messages.json', { defaults: {}, autoSave: true });
}

let msgPersistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistMessages(get: () => MessageStore) {
  if (msgPersistTimer) clearTimeout(msgPersistTimer);
  msgPersistTimer = setTimeout(async () => {
    try {
      const store = await getMessageStoreFile();
      await store.set('threads', get().threads);
      await store.set('channels', get().channels);
    } catch (e) {
      console.warn('failed to persist messages:', e);
    }
  }, MSG_PERSIST_DEBOUNCE_MS);
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  threads: {},
  channels: [],
  unreadCounts: {},
  activeThread: null,
  loaded: false,

  loadFromDisk: async () => {
    if (get().loaded) return;
    try {
      const store = await getMessageStoreFile();
      const threads = (await store.get<Record<string, DmMessage[]>>('threads')) ?? {};
      const channels = (await store.get<Channel[]>('channels')) ?? [];
      set({ threads, channels, loaded: true });
    } catch (e) {
      console.warn('failed to load messages:', e);
      set({ loaded: true });
    }
  },

  addMessage: (message) => {
    const { threads, unreadCounts, activeThread } = get();
    const threadId = message.threadId;
    const thread = threads[threadId] ?? [];
    const isActive = activeThread === threadId;

    set({
      threads: { ...threads, [threadId]: [...thread, message] },
      unreadCounts: {
        ...unreadCounts,
        [threadId]: isActive ? 0 : (unreadCounts[threadId] ?? 0) + 1,
      },
    });
    debouncedPersistMessages(get);
  },

  resolveMessage: (id, resolution) => {
    const { threads } = get();
    const updated: Record<string, DmMessage[]> = {};
    for (const [tid, msgs] of Object.entries(threads)) {
      updated[tid] = msgs.map((m) =>
        m.id === id ? { ...m, resolved: true, resolution } : m
      );
    }
    set({ threads: updated });
    debouncedPersistMessages(get);
  },

  setActiveThread: (threadId) => {
    set({ activeThread: threadId });
    get().markRead(threadId);
  },

  markRead: (threadId) => {
    const { unreadCounts } = get();
    set({ unreadCounts: { ...unreadCounts, [threadId]: 0 } });
  },

  addChannel: (channel) => {
    set((state) => ({ channels: [...state.channels, channel] }));
    debouncedPersistMessages(get);
  },

  totalUnread: () => {
    return Object.values(get().unreadCounts).reduce((sum, n) => sum + n, 0);
  },
}));
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/store/messageStore.test.ts`
Expected: All tests PASS (persist calls will warn in test env but not fail)

**Step 5: Commit**

```bash
git add apps/desktop/src/store/messageStore.ts apps/desktop/src/store/messageStore.test.ts
git commit -m "feat: rewrite messageStore with DmMessage type, channels, persistence, and tests"
```

---

### Task 3: Central event routing in AppShell

**Files:**
- Modify: `apps/desktop/src/components/layout/AppShell.tsx`
- Modify: `apps/desktop/src/components/messages/DmList.tsx` (remove its own event listener)

**Step 1: Add DM routing to AppShell**

In `AppShell.tsx`, add imports:
```typescript
import { useMessageStore } from '../../store/messageStore';
import type { AgentQuestionPayload, AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';
```

Expand the existing `handleAgentEvent` callback to also route text events to `messageStore`. Then add new `useEffect` hooks for the other event types (`agent-question`, `agent-status`, `agent-choices`, `agent-confirm`). Each creates a `DmMessage` with:
- `threadId: payload.agent_id` (groups by agent)
- `threadType: 'dm'`
- `from: 'agent'` (or `'system'` for status)
- Agent name resolved from `useAgentStore.getState().agents`
- `ticketId: payload.ticket_id`

Specifically, inside the existing `handleAgentEvent` callback, after the `showToast()` call, add:

```typescript
useMessageStore.getState().addMessage({
  id: payload.node_id ?? `dm-${payload.agent_id}-${Date.now()}`,
  threadId: payload.agent_id,
  threadType: 'dm',
  from: 'agent',
  agentId: payload.agent_id,
  agentName,
  content: text,
  type: 'text',
  ticketId: payload.ticket_id,
  timestamp: Date.now(),
});
```

Then add 4 new `useEffect` hooks (one per event type) that create DmMessages:

```typescript
// Route agent-question to DM
useEffect(() => {
  const unlisten = listen<AgentQuestionPayload>('agent-question', (event) => {
    const { agent_id, question } = event.payload;
    const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
    useMessageStore.getState().addMessage({
      id: `dm-q-${agent_id}-${Date.now()}`,
      threadId: agent_id,
      threadType: 'dm',
      from: 'agent',
      agentId: agent_id,
      agentName: agent?.name ?? agent_id,
      content: question,
      type: 'question',
      timestamp: Date.now(),
      resolved: false,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);

// Route agent-status to DM
useEffect(() => {
  const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
    const { agent_id, message } = event.payload;
    const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
    useMessageStore.getState().addMessage({
      id: `dm-s-${agent_id}-${Date.now()}`,
      threadId: agent_id,
      threadType: 'dm',
      from: 'system',
      agentId: agent_id,
      agentName: agent?.name ?? agent_id,
      content: message,
      type: 'status',
      timestamp: Date.now(),
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);

// Route agent-choices to DM
useEffect(() => {
  const unlisten = listen<AgentChoicesPayload>('agent-choices', (event) => {
    const { agent_id, question, choices } = event.payload;
    const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
    useMessageStore.getState().addMessage({
      id: `dm-ch-${agent_id}-${Date.now()}`,
      threadId: agent_id,
      threadType: 'dm',
      from: 'agent',
      agentId: agent_id,
      agentName: agent?.name ?? agent_id,
      content: question,
      type: 'choices',
      choices,
      timestamp: Date.now(),
      resolved: false,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);

// Route agent-confirm to DM
useEffect(() => {
  const unlisten = listen<AgentConfirmPayload>('agent-confirm', (event) => {
    const { agent_id, action, details } = event.payload;
    const agent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
    useMessageStore.getState().addMessage({
      id: `dm-cf-${agent_id}-${Date.now()}`,
      threadId: agent_id,
      threadType: 'dm',
      from: 'agent',
      agentId: agent_id,
      agentName: agent?.name ?? agent_id,
      content: action,
      type: 'confirm',
      actionDetails: details,
      timestamp: Date.now(),
      resolved: false,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);
```

**Step 2: Remove the event listener from DmList**

In `apps/desktop/src/components/messages/DmList.tsx`, remove the entire `useEffect` that calls `listen<CanvasNodePayload>('agent-event', ...)` (lines 11-30). Remove the `listen` and `CanvasNodePayload` imports. DmList now purely reads from `messageStore`.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/AppShell.tsx apps/desktop/src/components/messages/DmList.tsx
git commit -m "feat: central event routing — all agent events flow to messageStore from AppShell"
```

---

### Task 4: Sidebar unread badge

**Files:**
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx`

**Step 1: Add unread badge to Messages icon**

Import `useMessageStore`:
```typescript
import { useMessageStore } from '../../store/messageStore';
```

Inside the `Sidebar` component, get total unread:
```typescript
const totalUnread = useMessageStore((s) => s.totalUnread());
```

In the `navItems.map`, for the Messages item, render a badge after the `<Icon>`:
```tsx
<button key={id} ... >
  <Icon size={18} strokeWidth={1.5} />
  {id === 'messages' && totalUnread > 0 && (
    <span className="absolute -top-0.5 -right-0.5 bg-violet-600 text-white text-[9px] rounded-full min-w-[16px] h-4 flex items-center justify-center font-bold px-1">
      {totalUnread > 99 ? '99+' : totalUnread}
    </span>
  )}
</button>
```

The button needs `relative` added to its className so the absolute badge is positioned correctly.

**Step 2: Commit**

```bash
git add apps/desktop/src/components/layout/Sidebar.tsx
git commit -m "feat: add unread badge to Messages icon in sidebar"
```

---

### Task 5: Rewrite DmList with channels, message input, and human-feel rendering

**Files:**
- Modify: `apps/desktop/src/components/messages/DmList.tsx`

**Step 1: Rewrite DmList**

This is a full rewrite of the component. The new version:

1. **Left sidebar** (w-56):
   - "Direct Messages" header
   - Per-agent thread buttons: violet avatar (first letter) + agent name + unread badge
   - Divider
   - "Channels" header
   - Per-channel buttons: `#` prefix + channel name
   - "+ New Channel" button → inline form (name input + agent multi-select + create button)

2. **Right pane**:
   - Thread header: agent name (for DMs) or `# channel-name` (for channels)
   - Message list with human-feel rendering:
     - **text**: Left-aligned bubble with avatar, agent name, timestamp. Ticket context as muted `re: ticket-title` tag.
     - **question**: Same as text but with a text input + send button when unresolved. Shows "Answered: ..." when resolved.
     - **choices**: Same as text but with clickable choice buttons when unresolved.
     - **confirm**: Same as text but with Approve/Reject buttons when unresolved.
     - **status**: Centered muted italic system message (like Slack "joined channel").
     - **reply** (from: 'user'): Right-aligned violet bubble, "You" label.
   - Message input at bottom: text field + send button

3. **Reply handling**: For DM threads, user replies via `invoke('answer_agent', ...)` (same as ConversationPanel). For channel threads, user messages are stored locally (no agent response wiring yet).

Use these imports:
```typescript
import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Send, Check, XCircle, Plus, Hash } from 'lucide-react';
import { useMessageStore } from '../../store/messageStore';
import { useAgentStore } from '../../store/agentStore';
import { useTicketStore } from '../../store/ticketStore';
import type { DmMessage, Channel } from '../../types/message';
```

Key patterns to follow from `ConversationPanel.tsx`:
- `AgentAvatar` component for the violet first-letter circle
- `fmtTime(ts)` helper for "9:41 AM" timestamps
- `Markdown` component for rendering agent text (import from `'../canvas/nodes/Markdown'`)
- Interactive cards for choices/confirms (same button styles)
- Ticket context: look up ticket title from `useTicketStore` for the `re:` tag

For the "New Channel" form:
- Small inline form that appears when clicking "+ New Channel"
- Text input for channel name
- Checkboxes for selecting agents from `useAgentStore`
- "Create" button calls `addChannel({ id: crypto.randomUUID(), name, agentIds, createdAt: Date.now() })`

**Step 2: Commit**

```bash
git add apps/desktop/src/components/messages/DmList.tsx
git commit -m "feat: rewrite DmList with channels section, message input, and human-feel rendering"
```

---

### Task 6: App.tsx initialization

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Add messageStore loading**

Import `useMessageStore` and call `loadFromDisk` in the startup `useEffect`:

```typescript
import { useMessageStore } from './store/messageStore';
```

In the `App` component:
```typescript
const { loadFromDisk: loadMessages } = useMessageStore();
```

In the `useEffect`:
```typescript
loadMessages();
```

Add `loadMessages` to the dependency array.

**Step 2: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: load persisted messages on app startup"
```

---

### Task 7: Verify

**Step 1: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No new errors (only pre-existing badge.tsx/button.tsx errors)

**Step 2: Run all tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests pass (existing 101 + new messageStore tests)

**Step 3: Commit any fixes if needed**
