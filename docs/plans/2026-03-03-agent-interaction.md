# Agent Interaction Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI agents feel like real team members who communicate naturally — personality-driven prompts, richer MCP tools, persistent conversation thread.

**Architecture:** Three layers: (A) rewrite system prompt in `promptBuilder.ts` with personality/phase-aware interaction coaching, (B) add 3 MCP tools (`present_choices`, `status_update`, `confirm_action`) to Rust server with matching Tauri events, (C) build a `ConversationPanel` sidebar + `conversationStore` to replace ephemeral question cards.

**Tech Stack:** Rust/axum MCP server, Tauri 2 events/commands, React 19, Zustand, TypeScript, Tailwind CSS 4

**Design doc:** `docs/plans/2026-03-03-agent-interaction-design.md`

---

## Task 1: Prompt Rewrite — Personality Interaction Profiles

**Files:**
- Modify: `apps/desktop/src/lib/promptBuilder.ts`
- Modify: `apps/desktop/src/lib/promptBuilder.test.ts`

**Step 1: Write failing tests for personality-specific prompt content**

In `apps/desktop/src/lib/promptBuilder.test.ts`, add tests:

```typescript
describe('personality interaction coaching', () => {
  it('includes pragmatic interaction coaching', () => {
    const prompt = buildPrompt({ ...baseInput, personality: 'pragmatic' });
    expect(prompt).toContain('targeted question');
    expect(prompt).toContain('ask_human');
  });

  it('includes perfectionist interaction coaching', () => {
    const prompt = buildPrompt({ ...baseInput, personality: 'perfectionist' });
    expect(prompt).toContain('multiple valid approaches');
  });

  it('includes conservative interaction coaching', () => {
    const prompt = buildPrompt({ ...baseInput, personality: 'conservative' });
    expect(prompt).toContain('scope');
    expect(prompt).toContain('risk');
  });

  it('includes ambitious interaction coaching', () => {
    const prompt = buildPrompt({ ...baseInput, personality: 'ambitious' });
    expect(prompt).toContain('buy-in');
  });

  it('includes devils-advocate interaction coaching', () => {
    const prompt = buildPrompt({ ...baseInput, personality: 'devils-advocate' });
    expect(prompt).toContain('challenge');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm vitest run src/lib/promptBuilder.test.ts`
Expected: FAIL — current prompt doesn't include personality-specific interaction content.

**Step 3: Add `personalityInteraction()` helper and rewrite Communication section**

In `apps/desktop/src/lib/promptBuilder.ts`, add a helper function:

```typescript
function personalityInteraction(personality: string): string {
  switch (personality) {
    case 'pragmatic':
      return 'You ask one targeted question to get unblocked fast. Don\'t over-ask — if you can make a reasonable decision, do it. But when a wrong assumption would waste significant effort, send a quick ask_human message.';
    case 'perfectionist':
      return 'You ask when you see multiple valid approaches — you want to pick the right one. Validate assumptions about interfaces and data models. Use present_choices when trade-offs are genuinely different.';
    case 'ambitious':
      return 'You propose bold ideas before implementing them. Ask for buy-in on changes that go beyond the ticket scope. Share your vision with status_update so your lead sees where you\'re heading.';
    case 'conservative':
      return 'You question scope creep and flag risks early. Ask "do users actually need this?" before building. Use ask_human frequently — you prefer clarity over speed.';
    case 'devils-advocate':
      return 'You challenge assumptions and surface edge cases. Ask pointed questions: "What about X?" or "Have we considered Y?" Use present_choices to force explicit trade-off decisions.';
    default:
      return 'Communicate naturally with your team lead when you need input.';
  }
}
```

Replace the MCP Tools and Tool Restrictions sections in `buildPrompt()` with:

```typescript
`## Communication`,
`You are part of an engineering team. Communicate like a real developer would — concise, direct, like Slack messages to a coworker.`,
``,
`### Your communication tools (via MCP server):`,
`- \`ask_human\` — Ask your lead a question. Include context: "I'm looking at X and found Y. Should I Z?"`,
`- \`present_choices\` — Present 2-4 labeled options when you see multiple valid approaches.`,
`- \`status_update\` — Share progress. Non-blocking. "Reading auth module...", "Tests passing, moving to API layer."`,
`- \`confirm_action\` — Get approval before anything irreversible (creating PRs, major refactors, deleting files).`,
``,
`Always pass agent_id="${input.agentId}" to every MCP tool call.`,
``,
`### Your personality: ${input.personality}`,
personalityInteraction(input.personality),
``,
`### Communication style:`,
`- Be concise and direct`,
`- Include context in questions — don't just ask "should I do X?", explain what you found and why it matters`,
`- Don't ask permission for routine code changes — just do them`,
`- DO ask before: changing architecture, adding dependencies, modifying public interfaces`,
`- DO NOT use the \`AskUserQuestion\` tool — it is disabled in headless mode`,
`- DO NOT invoke skills — skills are for interactive sessions, not automated agents`,
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm vitest run src/lib/promptBuilder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/promptBuilder.ts apps/desktop/src/lib/promptBuilder.test.ts
git commit -m "feat: personality-driven interaction coaching in system prompt"
```

---

## Task 2: Prompt Rewrite — Phase-Specific Interaction

**Files:**
- Modify: `apps/desktop/src/lib/promptBuilder.ts`
- Modify: `apps/desktop/src/lib/promptBuilder.test.ts`

**Step 1: Write failing tests for phase-specific interaction content**

The `buildPrompt` function currently doesn't take a `phase` parameter. The phase section is appended by the Rust side in `lib.rs:154-178`. We need to add a `phase` field to `PromptInput` and include phase interaction guidance in the TS-side prompt.

```typescript
describe('phase interaction guidance', () => {
  it('includes high-interaction guidance for BRIEF phase', () => {
    const prompt = buildPrompt({ ...baseInput, phase: 'brief' });
    expect(prompt).toContain('Ask frequently');
  });

  it('includes low-interaction guidance for BUILD phase', () => {
    const prompt = buildPrompt({ ...baseInput, phase: 'build' });
    expect(prompt).toContain('sparingly');
  });

  it('includes minimal-interaction guidance for VALIDATE phase', () => {
    const prompt = buildPrompt({ ...baseInput, phase: 'validate' });
    expect(prompt).toContain('Minimal');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm vitest run src/lib/promptBuilder.test.ts`
Expected: FAIL — `phase` doesn't exist on `PromptInput`.

**Step 3: Add `phase` to `PromptInput` and `phaseInteraction()` helper**

Add to `PromptInput` interface:

```typescript
phase?: string;  // ticket phase: brief, design, plan, build, validate, qa, security
```

Add helper:

```typescript
function phaseInteraction(phase?: string): string {
  switch (phase) {
    case 'brief':
      return '**Phase: BRIEF** — Ask frequently. This is requirements gathering. Every ambiguity should become a question. Use present_choices for scope decisions.';
    case 'design':
      return '**Phase: DESIGN** — Medium interaction. Present architectural choices with present_choices. Ask about trade-offs. Confirm major decisions with confirm_action.';
    case 'plan':
      return '**Phase: PLAN** — Ask about unclear requirements. Present choices for task breakdown. Confirm the final plan before marking complete.';
    case 'build':
      return '**Phase: BUILD** — Ask sparingly. The plan should answer most questions. Ask only when the plan is insufficient or wrong. Use status_update at each milestone.';
    case 'validate':
    case 'qa':
    case 'security':
      return '**Phase: ' + phase.toUpperCase() + '** — Minimal interaction. Use status_update when starting and when complete. Only ask_human if you find something ambiguous in the code.';
    default:
      return '';
  }
}
```

Add to the `buildPrompt` output array, after the personality section:

```typescript
phaseInteraction(input.phase),
``,
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm vitest run src/lib/promptBuilder.test.ts`
Expected: PASS

**Step 5: Update call sites to pass `phase`**

In `apps/desktop/src/components/board/TicketCard.tsx` (or wherever `buildPrompt` is called), add the `phase` field to the input. Search for `buildPrompt(` to find all call sites.

**Step 6: Commit**

```bash
git add apps/desktop/src/lib/promptBuilder.ts apps/desktop/src/lib/promptBuilder.test.ts
git commit -m "feat: phase-specific interaction guidance in system prompt"
```

---

## Task 3: MCP Server — `status_update` Tool (Non-Blocking)

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp/server.rs`

**Step 1: Add `status_update` to `tools/list` response**

In `server.rs`, find the `"tools/list"` handler (around line 160). Add a second tool to the `tools` array:

```rust
{
    "name": "status_update",
    "description": "Send a non-blocking status update to your team lead. Use to share progress: what you're doing, what you found, milestones reached.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": "A brief status message, like a Slack update"
            },
            "agent_id": {
                "type": "string",
                "description": "Your agent ID, exactly as given in your system prompt"
            }
        },
        "required": ["message", "agent_id"]
    }
}
```

**Step 2: Add dispatch branch for `status_update` in `tools/call`**

In the `"tools/call"` handler (around line 185), before the `ask_human` branch, add:

```rust
"status_update" => {
    let message = args.get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let agent_id = args.get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Non-blocking: emit event and return immediately
    let _ = app.emit("agent-status", serde_json::json!({
        "agent_id": agent_id,
        "message": message,
    }));

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": "Status update delivered." }],
            "isError": false
        }
    })
}
```

**Step 3: Verify compilation**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/server.rs
git commit -m "feat: add status_update MCP tool (non-blocking)"
```

---

## Task 4: MCP Server — `present_choices` Tool (Blocking)

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp/server.rs`

**Step 1: Add `present_choices` to `tools/list` response**

Add to the tools array:

```rust
{
    "name": "present_choices",
    "description": "Present the user with 2-4 labeled options. Use when you see multiple valid approaches and want the user to pick.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The question or decision to present"
            },
            "choices": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": { "type": "string", "description": "Short label for this option" },
                        "description": { "type": "string", "description": "Why this option and its trade-offs" }
                    },
                    "required": ["label", "description"]
                },
                "minItems": 2,
                "maxItems": 4
            },
            "agent_id": {
                "type": "string",
                "description": "Your agent ID"
            }
        },
        "required": ["question", "choices", "agent_id"]
    }
}
```

**Step 2: Add dispatch branch for `present_choices`**

Uses the same oneshot channel pattern as `ask_human`:

```rust
"present_choices" => {
    let question = args.get("question")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let choices = args.get("choices")
        .cloned()
        .unwrap_or(serde_json::json!([]));
    let agent_id = args.get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut pending = state.pending_questions.lock().await;
        pending.insert(agent_id.clone(), tx);
    }

    let _ = app.emit("agent-choices", serde_json::json!({
        "agent_id": agent_id,
        "question": question,
        "choices": choices,
    }));

    match tokio::time::timeout(Duration::from_secs(600), rx).await {
        Ok(Ok(reply)) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": format!("User chose: {}", reply) }],
                "isError": false
            }
        }),
        Ok(Err(_)) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": "Error: connection lost" }],
                "isError": true
            }
        }),
        Err(_) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": "Timed out waiting for user choice" }],
                "isError": true
            }
        }),
    }
}
```

**Step 3: Verify compilation**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/server.rs
git commit -m "feat: add present_choices MCP tool (blocking, reuses oneshot pattern)"
```

---

## Task 5: MCP Server — `confirm_action` Tool (Blocking)

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp/server.rs`

**Step 1: Add `confirm_action` to `tools/list` response**

```rust
{
    "name": "confirm_action",
    "description": "Request approval before a major or irreversible action. Shows the user what you're about to do and waits for Approve/Reject.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "What you're about to do, e.g. 'Create PR #42' or 'Refactor auth module'"
            },
            "details": {
                "type": "string",
                "description": "Details/preview of the action"
            },
            "agent_id": {
                "type": "string",
                "description": "Your agent ID"
            }
        },
        "required": ["action", "agent_id"]
    }
}
```

**Step 2: Add dispatch branch for `confirm_action`**

Same oneshot pattern. The user's reply will be JSON like `{"approved":true,"reply":"..."}` or just "approved"/"rejected".

```rust
"confirm_action" => {
    let action = args.get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let details = args.get("details")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let agent_id = args.get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut pending = state.pending_questions.lock().await;
        pending.insert(agent_id.clone(), tx);
    }

    let _ = app.emit("agent-confirm", serde_json::json!({
        "agent_id": agent_id,
        "action": action,
        "details": details,
    }));

    match tokio::time::timeout(Duration::from_secs(600), rx).await {
        Ok(Ok(reply)) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": reply }],
                "isError": false
            }
        }),
        Ok(Err(_)) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": "Error: connection lost" }],
                "isError": true
            }
        }),
        Err(_) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": "Timed out waiting for confirmation" }],
                "isError": true
            }
        }),
    }
}
```

**Step 3: Verify compilation**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/server.rs
git commit -m "feat: add confirm_action MCP tool (blocking)"
```

---

## Task 6: TypeScript Types — New Event Payloads

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`

**Step 1: Add new payload interfaces and node type**

At the end of `canvas.ts`, add:

```typescript
/// Emitted by MCP server when agent calls present_choices.
export interface AgentChoicesPayload {
  agent_id: string;
  question: string;
  choices: { label: string; description: string }[];
}

/// Emitted by MCP server when agent calls status_update.
export interface AgentStatusPayload {
  agent_id: string;
  message: string;
}

/// Emitted by MCP server when agent calls confirm_action.
export interface AgentConfirmPayload {
  agent_id: string;
  action: string;
  details?: string;
}
```

Add `'status_update'` to the `CanvasNodeType` union:

```typescript
export type CanvasNodeType =
  | 'thought'
  | 'file_read'
  // ... existing types ...
  | 'review_synthesis'
  | 'status_update';
```

**Step 2: Commit**

```bash
git add apps/desktop/src/types/canvas.ts
git commit -m "feat: add TypeScript types for new MCP tool event payloads"
```

---

## Task 7: StatusUpdateNode Component

**Files:**
- Create: `apps/desktop/src/components/canvas/nodes/StatusUpdateNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

**Step 1: Create the StatusUpdateNode component**

```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Radio } from 'lucide-react';
import type { CanvasNode } from '../../../types/canvas';

export function StatusUpdateNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-1.5 max-w-xs shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-zinc-300" />
      <div className="flex items-center gap-2">
        <Radio size={12} className="text-zinc-400 flex-shrink-0" />
        <span className="text-zinc-500 text-xs">{data.content}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-zinc-300" />
    </div>
  );
}
```

**Step 2: Register in nodeTypes**

In `apps/desktop/src/components/canvas/nodes/index.ts`, add import and entry:

```typescript
import { StatusUpdateNode } from './StatusUpdateNode';

// Add to nodeTypes:
status_update: StatusUpdateNode,
```

**Step 3: Commit**

```bash
git add apps/desktop/src/components/canvas/nodes/StatusUpdateNode.tsx apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat: add StatusUpdateNode canvas component"
```

---

## Task 8: canvasStore — `addStatusUpdateNode()`

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Create: `apps/desktop/src/store/canvasStore.statusUpdate.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

describe('addStatusUpdateNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], activeTicketId: 'ticket-1' });
  });

  it('adds a status_update node', () => {
    useCanvasStore.getState().addStatusUpdateNode('agent-1', 'Reading files...');
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.nodeType).toBe('status_update');
    expect(nodes[0].data.content).toBe('Reading files...');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm vitest run src/store/canvasStore.statusUpdate.test.ts`
Expected: FAIL — `addStatusUpdateNode` doesn't exist.

**Step 3: Add `addStatusUpdateNode` to the store**

In `canvasStore.ts`, add to the interface and implementation. Follow the pattern used by `addValidateResultNode`:

```typescript
// In the interface:
addStatusUpdateNode: (agentId: string, message: string) => void;

// In the create() body:
addStatusUpdateNode: (agentId: string, message: string) => {
  set((state) => {
    const ticketId = state.activeTicketId ?? '';
    const nonGhostNodes = state.nodes.filter((n) => !n.data.isGhost);
    const x = nonGhostNodes.length * NODE_HORIZONTAL_SPACING;
    const id = `status-${agentId}-${Date.now()}`;

    const newNode: Node<CanvasNodeData> = {
      id,
      type: 'status_update',
      position: { x, y: 80 },
      data: {
        nodeType: 'status_update',
        agentId,
        ticketId,
        content: message,
      },
    };

    const prevNode = nonGhostNodes[nonGhostNodes.length - 1];
    const newEdge = prevNode
      ? { id: `e-${prevNode.id}-${id}`, source: prevNode.id, target: id }
      : undefined;

    return {
      nodes: [...state.nodes, newNode],
      edges: newEdge ? [...state.edges, newEdge] : state.edges,
    };
  });
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm vitest run src/store/canvasStore.statusUpdate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.statusUpdate.test.ts
git commit -m "feat: addStatusUpdateNode in canvasStore with TDD"
```

---

## Task 9: Conversation Store

**Files:**
- Create: `apps/desktop/src/store/conversationStore.ts`
- Create: `apps/desktop/src/store/conversationStore.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore } from './conversationStore';

describe('conversationStore', () => {
  beforeEach(() => {
    useConversationStore.setState({ messages: [] });
  });

  it('adds a question message', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_question',
      content: 'Should I use JWT or sessions?',
    });
    const msgs = useConversationStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('agent_question');
    expect(msgs[0].resolved).toBe(false);
  });

  it('resolves a message', () => {
    useConversationStore.getState().addMessage({
      ticketId: 'ticket-1',
      agentId: 'agent-1',
      agentName: 'Backend Engineer',
      type: 'agent_question',
      content: 'Which DB?',
    });
    const id = useConversationStore.getState().messages[0].id;
    useConversationStore.getState().resolveMessage(id, 'Use PostgreSQL');
    const msg = useConversationStore.getState().messages[0];
    expect(msg.resolved).toBe(true);
    expect(msg.resolution).toBe('Use PostgreSQL');
  });

  it('gets unresolved messages for a ticket', () => {
    const store = useConversationStore.getState();
    store.addMessage({ ticketId: 't-1', agentId: 'a-1', agentName: 'FE', type: 'agent_question', content: 'Q1' });
    store.addMessage({ ticketId: 't-1', agentId: 'a-1', agentName: 'FE', type: 'agent_status', content: 'Reading...' });
    store.addMessage({ ticketId: 't-2', agentId: 'a-2', agentName: 'BE', type: 'agent_question', content: 'Q2' });

    const unresolved = useConversationStore.getState().unresolvedForTicket('t-1');
    expect(unresolved).toHaveLength(1); // status is auto-resolved, only question
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && pnpm vitest run src/store/conversationStore.test.ts`
Expected: FAIL — file doesn't exist.

**Step 3: Create the conversationStore**

```typescript
import { create } from 'zustand';

export interface ConversationMessage {
  id: string;
  ticketId: string;
  agentId: string;
  agentName: string;
  type: 'agent_question' | 'agent_choices' | 'agent_status' | 'agent_confirm' | 'user_reply';
  content: string;
  choices?: { label: string; description: string }[];
  actionDetails?: string;
  timestamp: number;
  resolved: boolean;
  resolution?: string;
}

interface AddMessageInput {
  ticketId: string;
  agentId: string;
  agentName: string;
  type: ConversationMessage['type'];
  content: string;
  choices?: { label: string; description: string }[];
  actionDetails?: string;
}

interface ConversationStore {
  messages: ConversationMessage[];
  addMessage: (input: AddMessageInput) => string;
  resolveMessage: (id: string, resolution: string) => void;
  messagesForTicket: (ticketId: string) => ConversationMessage[];
  unresolvedForTicket: (ticketId: string) => ConversationMessage[];
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  messages: [],

  addMessage: (input) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isAutoResolved = input.type === 'agent_status';
    const msg: ConversationMessage = {
      id,
      ...input,
      timestamp: Date.now(),
      resolved: isAutoResolved,
      resolution: isAutoResolved ? input.content : undefined,
    };
    set((state) => ({ messages: [...state.messages, msg] }));
    return id;
  },

  resolveMessage: (id, resolution) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, resolved: true, resolution } : m
      ),
    }));
  },

  messagesForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId);
  },

  unresolvedForTicket: (ticketId) => {
    return get().messages.filter((m) => m.ticketId === ticketId && !m.resolved);
  },
}));
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm vitest run src/store/conversationStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/store/conversationStore.ts apps/desktop/src/store/conversationStore.test.ts
git commit -m "feat: add conversationStore for persistent agent-user message thread"
```

---

## Task 10: ConversationPanel Component

**Files:**
- Create: `apps/desktop/src/components/canvas/ConversationPanel.tsx`

**Step 1: Build the component**

```typescript
import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MessageCircle, X, ChevronRight, Send, Check, XCircle } from 'lucide-react';
import { useConversationStore, type ConversationMessage } from '../../store/conversationStore';

interface Props {
  ticketId: string;
}

function MessageBubble({ msg, onReply }: { msg: ConversationMessage; onReply: (id: string, reply: string) => void }) {
  const [reply, setReply] = useState('');

  if (msg.type === 'user_reply') {
    return (
      <div className="flex justify-end">
        <div className="bg-violet-600 text-white rounded-lg rounded-br-sm px-3 py-2 max-w-[80%]">
          <p className="text-xs">{msg.content}</p>
          <span className="text-[10px] text-violet-200 mt-1 block">{new Date(msg.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    );
  }

  if (msg.type === 'agent_status') {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded-full px-3 py-0.5">
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.type === 'agent_choices' && !msg.resolved) {
    return (
      <div className="flex justify-start">
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
          <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
          <p className="text-xs text-zinc-200 mb-2">{msg.content}</p>
          <div className="flex flex-col gap-1">
            {msg.choices?.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onReply(msg.id, c.label)}
                className="text-left bg-zinc-700 hover:bg-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-200 transition-colors"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-zinc-400 ml-1">— {c.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'agent_confirm' && !msg.resolved) {
    return (
      <div className="flex justify-start">
        <div className="bg-zinc-800 border border-amber-700/50 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
          <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
          <p className="text-xs text-amber-300 font-medium mb-1">Requesting approval</p>
          <p className="text-xs text-zinc-200">{msg.content}</p>
          {msg.actionDetails && (
            <pre className="mt-1 text-[10px] text-zinc-400 bg-zinc-900 rounded p-2 whitespace-pre-wrap">{msg.actionDetails}</pre>
          )}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => onReply(msg.id, JSON.stringify({ approved: true, reply: '' }))}
              className="flex items-center gap-1 bg-green-800 hover:bg-green-700 text-green-200 rounded px-3 py-1 text-xs transition-colors"
            >
              <Check size={12} /> Approve
            </button>
            <button
              type="button"
              onClick={() => onReply(msg.id, JSON.stringify({ approved: false, reply: '' }))}
              className="flex items-center gap-1 bg-red-900 hover:bg-red-800 text-red-200 rounded px-3 py-1 text-xs transition-colors"
            >
              <XCircle size={12} /> Reject
            </button>
          </div>
        </div>
      </div>
    );
  }

  // agent_question (or resolved choices/confirm)
  const needsReply = msg.type === 'agent_question' && !msg.resolved;

  return (
    <div className="flex justify-start">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg rounded-bl-sm px-3 py-2 max-w-[85%]">
        <p className="text-[10px] text-zinc-400 font-medium mb-1">{msg.agentName}</p>
        <p className="text-xs text-zinc-200">{msg.content}</p>
        {msg.resolved && msg.resolution && (
          <p className="text-[10px] text-zinc-500 mt-1 italic">Answered: {msg.resolution}</p>
        )}
        {needsReply && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) onReply(msg.id, reply.trim());
            }}
            className="flex gap-1 mt-2"
          >
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply..."
              className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className="bg-violet-600 hover:bg-violet-500 text-white rounded px-2 py-1 text-xs transition-colors"
            >
              <Send size={12} />
            </button>
          </form>
        )}
        <span className="text-[10px] text-zinc-500 mt-1 block">{new Date(msg.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

export function ConversationPanel({ ticketId }: Props) {
  const [open, setOpen] = useState(false);
  const messages = useConversationStore((s) => s.messagesForTicket(ticketId));
  const unresolved = useConversationStore((s) => s.unresolvedForTicket(ticketId));
  const resolveMessage = useConversationStore((s) => s.resolveMessage);
  const addMessage = useConversationStore((s) => s.addMessage);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleReply = async (msgId: string, reply: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    try {
      await invoke('answer_agent', { agentId: msg.agentId, reply });
      resolveMessage(msgId, reply);
      addMessage({
        ticketId,
        agentId: msg.agentId,
        agentName: 'You',
        type: 'user_reply',
        content: reply,
      });
    } catch (err) {
      console.error('Failed to deliver reply:', err);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-20 bg-zinc-800 border border-zinc-700 rounded-full p-2 hover:bg-zinc-700 transition-colors pointer-events-auto"
      >
        <MessageCircle size={18} className="text-zinc-300" />
        {unresolved.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-violet-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
            {unresolved.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700 z-20 flex flex-col pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <MessageCircle size={14} className="text-zinc-400" />
          <span className="text-xs font-medium text-zinc-300">Conversation</span>
          {unresolved.length > 0 && (
            <span className="bg-violet-600 text-white text-[10px] rounded-full px-1.5 font-bold">
              {unresolved.length}
            </span>
          )}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center mt-8">
            No messages yet. Agents will communicate here as they work.
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onReply={handleReply} />
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/canvas/ConversationPanel.tsx
git commit -m "feat: ConversationPanel sidebar with chat bubbles, choices, and confirmations"
```

---

## Task 11: Wire Events in TicketCanvas

**Files:**
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Step 1: Add imports**

```typescript
import { ConversationPanel } from './ConversationPanel';
import { useConversationStore } from '../../store/conversationStore';
import type { AgentChoicesPayload, AgentStatusPayload, AgentConfirmPayload } from '../../types/canvas';
```

**Step 2: Add event listeners for new MCP tools**

Inside the main component, alongside the existing `agent-question` listener, add:

```typescript
// agent-status (non-blocking)
useEffect(() => {
  const unlisten = listen<AgentStatusPayload>('agent-status', (event) => {
    const { agent_id, message } = event.payload;
    useCanvasStore.getState().addStatusUpdateNode(agent_id, message);
    useConversationStore.getState().addMessage({
      ticketId: activeTicketId ?? '',
      agentId: agent_id,
      agentName: agent_id, // TODO: resolve agent display name
      type: 'agent_status',
      content: message,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, [activeTicketId]);

// agent-choices (blocking — replaces ask_human pattern for choices)
useEffect(() => {
  const unlisten = listen<AgentChoicesPayload>('agent-choices', (event) => {
    const { agent_id, question, choices } = event.payload;
    useConversationStore.getState().addMessage({
      ticketId: activeTicketId ?? '',
      agentId: agent_id,
      agentName: agent_id,
      type: 'agent_choices',
      content: question,
      choices,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, [activeTicketId]);

// agent-confirm (blocking)
useEffect(() => {
  const unlisten = listen<AgentConfirmPayload>('agent-confirm', (event) => {
    const { agent_id, action, details } = event.payload;
    useConversationStore.getState().addMessage({
      ticketId: activeTicketId ?? '',
      agentId: agent_id,
      agentName: agent_id,
      type: 'agent_confirm',
      content: action,
      actionDetails: details,
    });
  });
  return () => { unlisten.then((fn) => fn()); };
}, [activeTicketId]);
```

**Step 3: Update the existing `agent-question` listener to also add to conversationStore**

Find the existing `agent-question` listener and add alongside the `setActiveQuestions`:

```typescript
useConversationStore.getState().addMessage({
  ticketId: activeTicketId ?? '',
  agentId: event.payload.agent_id,
  agentName: event.payload.agent_id,
  type: 'agent_question',
  content: event.payload.question,
});
```

**Step 4: Replace AgentQuestionCard rendering with ConversationPanel**

Remove the `AgentQuestionCard` rendering block (the `activeQuestions.map(...)` section). Replace with:

```typescript
<ConversationPanel ticketId={activeTicketId ?? ''} />
```

Remove the `activeQuestions` state and `handleQuestionAnswered` callback — these are now handled by the ConversationPanel + conversationStore.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat: wire new MCP tool events to conversationStore + ConversationPanel"
```

---

## Task 12: Integration Test — End-to-End Smoke

**Files:**
- No new files — manual verification

**Step 1: Build and run**

```bash
cd apps/desktop && pnpm tauri dev
```

**Step 2: Verify the following:**

1. Create a ticket with a vague description (to trigger questions)
2. Start an agent on it
3. Verify:
   - Agent sends `status_update` messages → appear as subtle nodes on canvas + in conversation panel
   - Agent calls `ask_human` → appears in conversation panel as a chat message with reply input
   - Conversation panel shows badge count for unresolved messages
   - Replying to a question resolves it in the panel and unblocks the agent
4. Check the Tauri console for any errors

**Step 3: Commit any fixes**

```bash
git add -u
git commit -m "fix: integration fixes for agent interaction overhaul"
```

---

Plan complete and saved to `docs/plans/2026-03-03-agent-interaction.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with `executing-plans`, batch execution with checkpoints

Which approach?