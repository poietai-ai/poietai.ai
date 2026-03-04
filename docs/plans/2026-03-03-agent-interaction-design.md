# Agent Interaction Overhaul — Design

**Date:** 2026-03-03
**Goal:** Make AI agents feel like real team members who communicate naturally with the user.

## Problem

Agents never use the `ask_human` MCP tool because:
1. The system prompt gives 3 buried lines about it with a high bar ("meaningfully change your approach")
2. No personality-driven interaction coaching — all agents get the same minimal guidance
3. No phase-specific interaction patterns
4. Only one generic tool (`ask_human`) — no structured choices, status updates, or confirmations
5. Questions are ephemeral (disappear after answering) — no conversation history

## Solution: Three Layers

### Layer A: Prompt Rewrite

Replace the current 3-line MCP section in `promptBuilder.ts` with a full Communication section.

**Personality interaction profiles:**

| Personality | Style | Frequency |
|---|---|---|
| `pragmatic` | One targeted question to get unblocked fast | Medium |
| `perfectionist` | Validates assumptions, asks about multiple valid approaches | High |
| `ambitious` | Proposes ideas before implementing, asks for buy-in | Medium-high |
| `conservative` | Questions scope, flags risks early | High |
| `devils-advocate` | Challenges the plan, surfaces edge cases | Medium |

**Phase-specific interaction:**

| Phase | Interaction level | Guidance |
|---|---|---|
| BRIEF | High | Every ambiguity → question. Use `present_choices` for scope decisions. |
| DESIGN | Medium | Present architectural choices. Confirm major decisions. |
| PLAN | Medium | Ask about unclear requirements. Present task breakdown choices. |
| BUILD | Low | Plan should answer most questions. Ask only when plan is wrong. Status updates at milestones. |
| VALIDATE/QA/SECURITY | Minimal | Status update at start and finish. |

**Prompt template:**

```
## Communication
You are part of an engineering team. Communicate like a real developer would.

### Your communication tools (via MCP server):
- `ask_human` — Ask your lead a question. Use like a Slack message to a coworker.
- `present_choices` — Present 2-4 options when you see multiple valid approaches.
- `status_update` — Share what you're doing. Your team lead can see these.
- `confirm_action` — Get approval before anything irreversible (PRs, major refactors).

Always pass agent_id="{agentId}" to every MCP tool call.

### Your personality: {personality}
{personality-specific interaction coaching}

### Phase: {phase}
{phase-specific interaction guidance}

### Communication style:
- Be concise and direct, like a real Slack message
- Include context: "I'm looking at the billing module and found X. Should I Y or Z?"
- Don't ask permission for routine code changes — just do them
- DO ask before: changing architecture, adding dependencies, modifying interfaces
```

### Layer B: MCP Tool Expansion

Add three tools to the Rust MCP server (`apps/desktop/src-tauri/src/mcp/server.rs`):

#### `present_choices`
```json
{
  "name": "present_choices",
  "description": "Present the user with 2-4 labeled options. Use when you see multiple valid approaches.",
  "inputSchema": {
    "properties": {
      "question": { "type": "string" },
      "choices": {
        "type": "array",
        "items": { "type": "object", "properties": { "label": { "type": "string" }, "description": { "type": "string" } } },
        "minItems": 2, "maxItems": 4
      },
      "agent_id": { "type": "string" }
    },
    "required": ["question", "choices", "agent_id"]
  }
}
```
- **Blocking.** Emits `agent-choices` Tauri event. Waits for user selection. Returns `{ "choice": "<label>" }`.

#### `status_update`
```json
{
  "name": "status_update",
  "description": "Send a non-blocking status update to your team lead. Use to share progress.",
  "inputSchema": {
    "properties": {
      "message": { "type": "string" },
      "agent_id": { "type": "string" }
    },
    "required": ["message", "agent_id"]
  }
}
```
- **Non-blocking.** Emits `agent-status` Tauri event. Returns immediately.

#### `confirm_action`
```json
{
  "name": "confirm_action",
  "description": "Request approval before a major or irreversible action. Shows the user what you're about to do.",
  "inputSchema": {
    "properties": {
      "action": { "type": "string" },
      "details": { "type": "string" },
      "agent_id": { "type": "string" }
    },
    "required": ["action", "agent_id"]
  }
}
```
- **Blocking.** Emits `agent-confirm` Tauri event. Waits for Approve/Reject + optional reply. Returns `{ "approved": bool, "reply": "..." }`.

**Backend implementation pattern:**
- Each tool follows the existing `ask_human` pattern in `server.rs`
- `present_choices` and `confirm_action` use the same `oneshot::channel` + `answer_agent` mechanism
- `status_update` skips the channel — emit event and return immediately
- New Tauri command: extend `answer_agent` to handle choice selection and confirmation responses (or add `answer_choices` / `answer_confirm` commands)

**New Tauri events:**
- `agent-choices` — payload: `{ agent_id, question, choices, request_id }`
- `agent-status` — payload: `{ agent_id, message, timestamp }`
- `agent-confirm` — payload: `{ agent_id, action, details, request_id }`

### Layer C: Conversation Thread UI

Replace the ephemeral `AgentQuestionCard` with a persistent conversation panel.

#### New component: `ConversationPanel`
- Collapsible sidebar on the right side of `TicketCanvas`
- Chronological thread of all agent-user interactions for the ticket
- Persists across agent runs

#### Message types:

| Type | Source | Visual |
|---|---|---|
| `agent_question` | `ask_human` call | Chat bubble (left), agent name |
| `agent_choices` | `present_choices` call | Chat bubble with clickable option buttons |
| `agent_status` | `status_update` call | Subtle inline status (gray, compact) |
| `agent_confirm` | `confirm_action` call | Card with action preview + Approve/Reject |
| `user_reply` | User responds | Chat bubble (right), "You" label |

#### New store: `conversationStore`

```typescript
interface ConversationMessage {
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
```

#### Interaction flow:
1. Agent calls MCP tool → Rust emits Tauri event
2. `TicketCanvas` listener adds message to `conversationStore`
3. `ConversationPanel` renders with appropriate UI card
4. User interacts (types reply / clicks choice / approves-rejects)
5. Response sent via `invoke('answer_agent', ...)` (existing pattern, extended)
6. Message marked `resolved`, resolution stored
7. Agent receives reply and continues

#### Canvas integration:
- `AgentQuestionCard` overlay → replaced by `ConversationPanel`
- `status_update` nodes appear on the canvas as lightweight inline nodes
- Panel has toggle button — collapsible when user wants canvas focus
- Unresolved messages show a badge/indicator on the toggle button

## Files Changed

| File | Change |
|---|---|
| `apps/desktop/src/lib/promptBuilder.ts` | Rewrite Communication section |
| `apps/desktop/src/lib/promptBuilder.test.ts` | Update tests |
| `apps/desktop/src-tauri/src/mcp/server.rs` | Add 3 new MCP tools |
| `apps/desktop/src/types/canvas.ts` | Add `status_update` node type, new event payloads |
| `apps/desktop/src/store/conversationStore.ts` | New Zustand store |
| `apps/desktop/src/store/canvasStore.ts` | Add `addStatusUpdateNode()` |
| `apps/desktop/src/components/canvas/ConversationPanel.tsx` | New component |
| `apps/desktop/src/components/canvas/nodes/StatusUpdateNode.tsx` | New node |
| `apps/desktop/src/components/canvas/nodes/index.ts` | Register new node type |
| `apps/desktop/src/components/canvas/TicketCanvas.tsx` | Wire new event listeners, replace AgentQuestionCard |

## Out of Scope
- Agent-to-agent communication (future: agent teams)
- Voice/audio interaction
- Persistent storage beyond in-memory Zustand (future: SQLite)
