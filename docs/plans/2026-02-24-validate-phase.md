# VALIDATE Phase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After BUILD completes, automatically launch a read-only VALIDATE agent that compares the approved plan against the actual code changes and surfaces any drift as VERIFIED/MISMATCH claims — with CRITICAL mismatches blocking the ticket.

**Architecture:** When `agent-result` fires and the ticket phase advances to `validate`, TicketCanvas auto-starts a second Claude process. That process receives only (1) the plan artifact content and (2) the full git diff from the build agent's worktree — no broad project context (noise reduction). The VALIDATE agent runs in the existing BUILD worktree in read-only mode (Read/Grep/Glob/git only). Its output is parsed into a structured summary and rendered as a `ValidateResultNode` on the canvas. CRITICAL mismatches set the ticket to `blocked`.

**Tech Stack:** Rust (Tauri 2 commands), TypeScript, React 19, Zustand, ReactFlow/xyflow, Vitest

---

## Context for Implementer

This is Milestone 3 of the poietai.ai phase pipeline. M1 added `TicketPhase` type, phase lifecycle, and `PhaseBreadcrumb`. M2 added `PlanArtifact` parsing, ghost graph, and BUILD context scoping. This plan extends the `agent-result` handler in `TicketCanvas.tsx` to auto-trigger a VALIDATE agent and adds visual feedback to the canvas.

**Key invariants to maintain:**
- `agent-result` Tauri event payload: `{ agent_id: string, ticket_id: string, session_id?: string }`
- `CanvasNodePayload` uses `kind` field (NOT `event`) — this was renamed in M2
- Ghost nodes have `isGhost: true` and `activated: false`
- `phasesForComplexity(2)` → `['plan', 'build', 'validate', 'ship']` — VALIDATE always follows BUILD for complexity ≥ 2

**Tests:** Run `pnpm test` from `apps/desktop/`. Currently 36 tests pass.
**Type check:** Run `pnpm typecheck` from `apps/desktop/`.
**Rust check:** Run `cargo check` from `apps/desktop/src-tauri/`.

---

### Task 1: Rust — `get_worktree_diff` command + `worktree_path_override` + phase-aware tools

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Context:** `StartAgentPayload` currently always creates a new git worktree. For VALIDATE, we reuse the BUILD agent's worktree (read-only). We also need a new command to get the diff from that worktree.

**Step 1: Add `worktree_path_override` field to `StartAgentPayload`**

In `lib.rs`, find `StartAgentPayload` struct and add the new field:

```rust
#[derive(Deserialize)]
pub struct StartAgentPayload {
    pub agent_id: String,
    pub ticket_id: String,
    pub ticket_slug: String,
    pub prompt: String,
    pub system_prompt: String,
    pub repo_root: String,
    pub gh_token: String,
    pub resume_session_id: Option<String>,
    pub phase: Option<String>,
    /// When set, skip worktree creation and run in this directory instead.
    /// Used by VALIDATE phase to reuse the BUILD agent's worktree.
    pub worktree_path_override: Option<String>,
}
```

**Step 2: Update `start_agent` to use `worktree_path_override` when provided**

Replace the existing worktree creation block (lines ~118-138 of current lib.rs) with:

```rust
    // Create the git worktree, or reuse an override path (e.g. for VALIDATE phase).
    let working_dir = if let Some(ref override_path) = payload.worktree_path_override {
        PathBuf::from(override_path)
    } else {
        let wt_config = git::worktree::WorktreeConfig {
            repo_root: repo_root.clone(),
            ticket_id: payload.ticket_id.clone(),
            ticket_slug: payload.ticket_slug.clone(),
            agent_name: agent.name.clone(),
            agent_email: format!("{}@poietai.ai", agent.role),
        };
        info!("[start_agent] creating worktree for ticket={}", payload.ticket_id);
        let worktree = git::worktree::create(&wt_config)
            .map_err(|e| {
                error!("[start_agent] worktree creation failed: {}", e);
                format!("failed to create worktree: {}", e)
            })?;
        info!("[start_agent] worktree created at {:?}", worktree.path);
        // Save worktree path to agent state
        if let Some(mut a) = get_agent(&agents_store, &payload.agent_id) {
            a.worktree_path = Some(worktree.path.to_string_lossy().to_string());
            upsert_agent(&agents_store, a);
        }
        worktree.path
    };

    let env = if payload.worktree_path_override.is_some() {
        vec![] // Existing worktree already has git identity set
    } else {
        let wt_config = git::worktree::WorktreeConfig {
            repo_root: repo_root.clone(),
            ticket_id: payload.ticket_id.clone(),
            ticket_slug: payload.ticket_slug.clone(),
            agent_name: agent.name.clone(),
            agent_email: format!("{}@poietai.ai", agent.role),
        };
        git::worktree::agent_env(&wt_config, &payload.gh_token)
    };
```

**Note on env:** The current code creates `wt_config` twice — once for `create` and once for `agent_env`. This refactor unifies them. `agent_env` just builds GIT_AUTHOR_NAME/EMAIL vars, so passing empty env for the override path is fine (the worktree already has its identity from the original `start_agent` call).

**Step 3: Make `allowed_tools` phase-aware**

Replace the hardcoded `allowed_tools` vec in `AgentRunConfig` with phase-based selection:

```rust
    let allowed_tools: Vec<String> = match phase {
        TicketPhase::Validate | TicketPhase::Qa | TicketPhase::Security => vec![
            "Read".to_string(),
            "Grep".to_string(),
            "Glob".to_string(),
            "Bash(git:*)".to_string(),
        ],
        _ => vec![
            "Read".to_string(),
            "Edit".to_string(),
            "Write".to_string(),
            "Glob".to_string(),
            "Grep".to_string(),
            "Bash(git:*)".to_string(),
            "Bash(gh:*)".to_string(),
            "Bash(cargo:*)".to_string(),
            "Bash(npm:*)".to_string(),
            "Bash(npx:*)".to_string(),
            "Bash(node:*)".to_string(),
            "Bash(pnpm:*)".to_string(),
            "Bash(yarn:*)".to_string(),
            "Bash(ls:*)".to_string(),
            "Bash(mkdir:*)".to_string(),
            "Bash(cp:*)".to_string(),
            "Bash(mv:*)".to_string(),
            "Bash(cat:*)".to_string(),
            "Bash(echo:*)".to_string(),
        ],
    };
```

**Step 4: Add `get_worktree_diff` command**

Add this new Tauri command (before the `run()` function or alongside other commands):

```rust
/// Get the git diff for an agent's worktree relative to the base branch.
/// Returns the diff string for the VALIDATE phase to inspect.
#[tauri::command]
fn get_worktree_diff(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<String, String> {
    let agent = get_agent(&state.agents, &agent_id)
        .ok_or_else(|| format!("agent '{}' not found", agent_id))?;
    let worktree_path = agent
        .worktree_path
        .ok_or_else(|| format!("agent '{}' has no worktree", agent_id))?;

    // Try "git diff main...HEAD" first (works when branched off main)
    let output = std::process::Command::new("git")
        .args(["diff", "main...HEAD"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    if output.status.success() && !output.stdout.is_empty() {
        return String::from_utf8(output.stdout).map_err(|e| e.to_string());
    }

    // Fallback: diff against the immediate parent commit
    let fallback = std::process::Command::new("git")
        .args(["diff", "HEAD~1..HEAD"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("git diff fallback failed: {}", e))?;

    String::from_utf8(fallback.stdout).map_err(|e| e.to_string())
}
```

**Step 5: Register `get_worktree_diff` in `invoke_handler`**

In the `run()` function, find the `invoke_handler!` macro and add the new command:

```rust
        .invoke_handler(tauri::generate_handler![
            create_agent,
            scan_folder,
            get_all_agents,
            get_worktree_diff,   // ← add this
            start_agent,
            resume_agent,
            start_pr_poll,
            answer_agent,
        ])
```

**Step 6: Run cargo check**

```bash
cargo check
```

Expected: compiles with 0 errors (pre-existing warnings are OK).

**Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: get_worktree_diff command + worktree_path_override + phase-aware tools"
```

---

### Task 2: TypeScript — `parseValidateResult` utility (TDD)

**Files:**
- Create: `apps/desktop/src/lib/parseValidateResult.ts`
- Create: `apps/desktop/src/lib/parseValidateResult.test.ts`

**Context:** The VALIDATE agent outputs structured lines in two formats:
```
VERIFIED | <claim summary> | <file:line>
MISMATCH | <claim summary> | Expected: <what plan says> | Found: <what code does> | CRITICAL|ADVISORY
```

We need to parse these from raw agent output text and return counts + structured data.

**Step 1: Write the failing tests first**

Create `apps/desktop/src/lib/parseValidateResult.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseValidateResult } from './parseValidateResult';

const SAMPLE_OUTPUT = `
I'll now verify each claim in the plan against the actual code.

VERIFIED | addTicket sets phases from complexity | ticketStore.ts:89
VERIFIED | advanceTicketPhase moves to next phase | ticketStore.ts:121
MISMATCH | setPhaseArtifact stores artifact | Expected: stores under phase key | Found: key lookup uses wrong index | CRITICAL
MISMATCH | PhaseBreadcrumb shows active phase in violet | Expected: violet-400 class | Found: violet-500 class | ADVISORY

Overall: 2 verified, 1 critical mismatch, 1 advisory mismatch.
`;

describe('parseValidateResult', () => {
  it('counts VERIFIED lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.verified).toBe(2);
  });

  it('counts CRITICAL MISMATCH lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.critical).toBe(1);
  });

  it('counts ADVISORY MISMATCH lines', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.advisory).toBe(1);
  });

  it('returns structured lines with type, summary, and severity', () => {
    const result = parseValidateResult(SAMPLE_OUTPUT);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0].type).toBe('verified');
    expect(result.lines[0].summary).toBe('addTicket sets phases from complexity');
    expect(result.lines[2].type).toBe('mismatch');
    expect(result.lines[2].severity).toBe('critical');
    expect(result.lines[3].severity).toBe('advisory');
  });

  it('returns zeros and empty lines for text with no validate lines', () => {
    const result = parseValidateResult('No structured output here.');
    expect(result.verified).toBe(0);
    expect(result.critical).toBe(0);
    expect(result.advisory).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('handles MISMATCH lines without explicit severity (defaults to advisory)', () => {
    const result = parseValidateResult('MISMATCH | some claim | Expected: x | Found: y');
    expect(result.lines[0].severity).toBe('advisory');
    expect(result.advisory).toBe(1);
    expect(result.critical).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test parseValidateResult
```

Expected: FAIL — "Cannot find module './parseValidateResult'"

**Step 3: Implement `parseValidateResult`**

Create `apps/desktop/src/lib/parseValidateResult.ts`:

```typescript
export interface ValidateLine {
  type: 'verified' | 'mismatch';
  summary: string;
  location?: string;
  severity?: 'critical' | 'advisory';
}

export interface ValidateResult {
  verified: number;
  critical: number;
  advisory: number;
  lines: ValidateLine[];
}

export function parseValidateResult(text: string): ValidateResult {
  const lines: ValidateLine[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('VERIFIED |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      lines.push({ type: 'verified', summary: parts[1] ?? '', location: parts[2] });
    } else if (trimmed.startsWith('MISMATCH |')) {
      const parts = trimmed.split('|').map((p) => p.trim());
      const lastPart = parts[parts.length - 1].toLowerCase();
      const severity: 'critical' | 'advisory' = lastPart === 'critical' ? 'critical' : 'advisory';
      lines.push({ type: 'mismatch', summary: parts[1] ?? '', severity });
    }
  }

  return {
    verified: lines.filter((l) => l.type === 'verified').length,
    critical: lines.filter((l) => l.type === 'mismatch' && l.severity === 'critical').length,
    advisory: lines.filter((l) => l.type === 'mismatch' && l.severity === 'advisory').length,
    lines,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test parseValidateResult
```

Expected: 6 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src/lib/parseValidateResult.ts apps/desktop/src/lib/parseValidateResult.test.ts
git commit -m "feat: parseValidateResult — parse VERIFIED/MISMATCH lines from validate agent output"
```

---

### Task 3: Canvas — `ValidateResultNode` + type + registration

**Files:**
- Modify: `apps/desktop/src/types/canvas.ts`
- Create: `apps/desktop/src/components/canvas/nodes/ValidateResultNode.tsx`
- Modify: `apps/desktop/src/components/canvas/nodes/index.ts`

**Context:** `ValidateResultNode` shows a summary of the VALIDATE phase: counts of VERIFIED, CRITICAL, and ADVISORY findings. Visual style: green tint if 0 criticals, red tint if any criticals.

**Step 1: Add `'validate_result'` to `CanvasNodeType` and `validateSummary` to `CanvasNodeData`**

In `apps/desktop/src/types/canvas.ts`, find the `CanvasNodeType` union and add `'validate_result'`:

```typescript
export type CanvasNodeType =
  | 'thought'
  | 'file_read'
  | 'file_edit'
  | 'file_write'
  | 'bash_command'
  | 'agent_message'
  | 'awaiting_user'
  | 'user_reply'
  | 'pr_opened'
  | 'ci_review'
  | 'plan_task'
  | 'validate_result';  // ← add this
```

In `CanvasNodeData`, add the `validateSummary` field after the existing M2 fields:

```typescript
export interface CanvasNodeData extends Record<string, unknown> {
  // ... existing fields ...
  // M3: validate result summary
  validateSummary?: { verified: number; critical: number; advisory: number };
}
```

**Step 2: Create `ValidateResultNode.tsx`**

Create `apps/desktop/src/components/canvas/nodes/ValidateResultNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../../types/canvas';

export function ValidateResultNode({ data }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const summary = nodeData.validateSummary ?? { verified: 0, critical: 0, advisory: 0 };
  const hasCritical = summary.critical > 0;

  return (
    <div
      className={[
        'px-4 py-3 rounded-lg border font-mono text-xs w-64 select-none',
        hasCritical
          ? 'bg-red-950 border-red-700 text-red-200'
          : 'bg-green-950 border-green-700 text-green-200',
      ].join(' ')}
    >
      <div className="text-[10px] uppercase tracking-wider mb-2 text-zinc-400">
        Validate Report
      </div>
      <div className="flex gap-4">
        <div className="text-center">
          <div className="text-green-400 font-bold text-base">{summary.verified}</div>
          <div className="text-zinc-500 text-[10px]">verified</div>
        </div>
        <div className="text-center">
          <div className={`font-bold text-base ${hasCritical ? 'text-red-400' : 'text-zinc-500'}`}>
            {summary.critical}
          </div>
          <div className="text-zinc-500 text-[10px]">critical</div>
        </div>
        <div className="text-center">
          <div className="text-yellow-400 font-bold text-base">{summary.advisory}</div>
          <div className="text-zinc-500 text-[10px]">advisory</div>
        </div>
      </div>
      {hasCritical && (
        <div className="mt-2 text-red-400 text-[10px] font-semibold">
          ⛔ Critical drift detected — ticket blocked
        </div>
      )}
    </div>
  );
}
```

**Step 3: Register in `nodes/index.ts`**

In `apps/desktop/src/components/canvas/nodes/index.ts`, add the import and registration:

```typescript
import { ThoughtNode } from './ThoughtNode';
import { FileNode } from './FileNode';
import { BashNode } from './BashNode';
import { AwaitingNode } from './AwaitingNode';
import { PlanTaskNode } from './PlanTaskNode';
import { ValidateResultNode } from './ValidateResultNode';

export const nodeTypes = {
  thought: ThoughtNode,
  agent_message: ThoughtNode,
  file_read: FileNode,
  file_edit: FileNode,
  file_write: FileNode,
  bash_command: BashNode,
  awaiting_user: AwaitingNode,
  plan_task: PlanTaskNode,
  validate_result: ValidateResultNode,  // ← add this
} as const;
```

**Step 4: Run type check**

```bash
pnpm typecheck
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add apps/desktop/src/types/canvas.ts \
        apps/desktop/src/components/canvas/nodes/ValidateResultNode.tsx \
        apps/desktop/src/components/canvas/nodes/index.ts
git commit -m "feat: ValidateResultNode — validate_result canvas node with VERIFIED/CRITICAL/ADVISORY summary"
```

---

### Task 4: canvasStore — `addValidateResultNode` action (TDD)

**Files:**
- Modify: `apps/desktop/src/store/canvasStore.ts`
- Modify: `apps/desktop/src/store/canvasStore.test.ts`

**Context:** `addValidateResultNode` places a `validate_result` node at the next horizontal execution position (y=80) and connects it with an edge from the previous non-ghost node. It takes a summary object, not a payload event.

**Step 1: Write the failing test**

In `apps/desktop/src/store/canvasStore.test.ts`, add this describe block after the existing tests:

```typescript
describe('addValidateResultNode', () => {
  it('adds a validate_result node at the correct position', () => {
    useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
    useCanvasStore.getState().addValidateResultNode({ verified: 3, critical: 0, advisory: 1 });
    const { nodes } = useCanvasStore.getState();
    const validateNode = nodes.find((n) => n.type === 'validate_result');
    expect(validateNode).toBeDefined();
    expect(validateNode?.position.y).toBe(80);
    expect(validateNode?.position.x).toBe(340); // one node before it
    expect(validateNode?.data.validateSummary).toEqual({ verified: 3, critical: 0, advisory: 1 });
  });

  it('connects validate_result node to the previous node', () => {
    useCanvasStore.getState().addNodeFromEvent(thoughtEvent('n1'));
    useCanvasStore.getState().addValidateResultNode({ verified: 1, critical: 1, advisory: 0 });
    const { edges } = useCanvasStore.getState();
    expect(edges.some((e) => e.target.startsWith('validate-result-'))).toBe(true);
  });

  it('works when canvas is empty (first node)', () => {
    useCanvasStore.getState().addValidateResultNode({ verified: 0, critical: 0, advisory: 0 });
    const { nodes, edges } = useCanvasStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('validate_result');
    expect(edges).toHaveLength(0); // no previous node to connect to
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm test canvasStore
```

Expected: 3 new tests fail with "addValidateResultNode is not a function".

**Step 3: Add `addValidateResultNode` to canvasStore**

In `apps/desktop/src/store/canvasStore.ts`, add to the `CanvasStore` interface:

```typescript
interface CanvasStore {
  // ... existing fields ...
  addValidateResultNode: (summary: { verified: number; critical: number; advisory: number }) => void;
}
```

Add the implementation inside `create<CanvasStore>`:

```typescript
  addValidateResultNode: (summary) => {
    const { nodes, edges, activeTicketId } = get();
    const nodeId = `validate-result-${Date.now()}`;
    const xPosition = nodes.filter((n) => !n.data.isGhost).length * NODE_HORIZONTAL_SPACING;

    const newNode: Node<CanvasNodeData> = {
      id: nodeId,
      type: 'validate_result' as CanvasNodeType,
      position: { x: xPosition, y: 80 },
      data: {
        nodeType: 'validate_result' as CanvasNodeType,
        agentId: '',
        ticketId: activeTicketId ?? '',
        content: '',
        validateSummary: summary,
        items: [],
      },
    };

    const newEdges = [...edges];
    if (nodes.length > 0) {
      const prevNode = [...nodes].reverse().find((n) => !n.data.isGhost) ?? nodes[nodes.length - 1];
      newEdges.push({
        id: `${prevNode.id}->${nodeId}`,
        source: prevNode.id,
        target: nodeId,
        type: 'smoothstep',
        style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
      });
    }

    set({ nodes: [...nodes, newNode], edges: newEdges });
  },
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test canvasStore
```

Expected: All 14 tests pass (11 existing + 3 new).

**Step 5: Run all tests to check nothing broke**

```bash
pnpm test
```

Expected: 39 tests pass.

**Step 6: Commit**

```bash
git add apps/desktop/src/store/canvasStore.ts apps/desktop/src/store/canvasStore.test.ts
git commit -m "feat: addValidateResultNode — canvasStore action for validate summary node"
```

---

### Task 5: Auto-trigger VALIDATE + capture result + blockTicket (TDD + wiring)

**Files:**
- Modify: `apps/desktop/src/store/ticketStore.ts`
- Modify: `apps/desktop/src/store/ticketStore.test.ts`
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

**Context:** This is the orchestration task. When BUILD completes:
1. `agent-result` fires
2. We capture the BUILD artifact and advance phase to VALIDATE
3. We detect `activePhase === 'validate'` and auto-trigger a new `start_agent` call
4. When VALIDATE's `agent-result` fires:
   - We capture the VALIDATE artifact
   - Parse VERIFIED/MISMATCH counts
   - Add `ValidateResultNode` to canvas
   - If any CRITICAL, call `blockTicket`
   - Advance phase to next (QA or SHIP)

**Step 1: Add `blockTicket` to ticketStore — failing test first**

In `apps/desktop/src/store/ticketStore.test.ts`, add:

```typescript
describe('blockTicket', () => {
  it('sets ticket status to blocked', () => {
    useTicketStore.getState().addTicket({ title: 'T', description: '', complexity: 2, acceptanceCriteria: [] });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().blockTicket(id);
    expect(useTicketStore.getState().tickets[0].status).toBe('blocked');
  });

  it('does nothing for nonexistent ticket id', () => {
    expect(() => useTicketStore.getState().blockTicket('nope')).not.toThrow();
  });
});
```

**Step 2: Run ticketStore tests to verify they fail**

```bash
pnpm test ticketStore
```

Expected: 2 new tests fail with "blockTicket is not a function".

**Step 3: Add `'blocked'` to TicketStatus and implement `blockTicket`**

In `apps/desktop/src/store/ticketStore.ts`:

Change `TicketStatus`:
```typescript
export type TicketStatus =
  | 'backlog' | 'refined' | 'assigned'
  | 'in_progress' | 'in_review' | 'shipped' | 'blocked';
```

Add to `TicketStore` interface:
```typescript
  blockTicket: (id: string) => void;
```

Add implementation in `create<TicketStore>`:
```typescript
  blockTicket: (id) =>
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status: 'blocked' as TicketStatus } : t)),
    })),
```

**Step 4: Run ticketStore tests**

```bash
pnpm test ticketStore
```

Expected: All 10 tests pass (8 existing + 2 new).

**Step 5: Commit ticketStore changes**

```bash
git add apps/desktop/src/store/ticketStore.ts apps/desktop/src/store/ticketStore.test.ts
git commit -m "feat: ticketStore — add 'blocked' status and blockTicket action"
```

**Step 6: Wire auto-trigger in `TicketCanvas.tsx`**

`TicketCanvas.tsx` currently imports:
```typescript
import { useCanvasStore } from '../../store/canvasStore';
import { useTicketStore } from '../../store/ticketStore';
```

Add these new imports at the top:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useSecretsStore } from '../../store/secretsStore';
import { buildPrompt } from '../../lib/promptBuilder';
import { parseValidateResult } from '../../lib/parseValidateResult';
```

Replace the **entire** `agent-result` `useEffect` block (lines 51–89 of current TicketCanvas.tsx) with:

```typescript
  // Listen for agent run completion — capture artifact, advance phase, auto-trigger next agent
  useEffect(() => {
    const unlisten = listen<AgentResultPayload>('agent-result', async (event) => {
      const { agent_id, ticket_id, session_id } = event.payload;

      // --- Phase lifecycle: capture artifact + get completed phase ---
      const ticket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
      const completedPhase = ticket?.activePhase;

      if (ticket && completedPhase && completedPhase !== 'ship') {
        const currentNodes = useCanvasStore.getState().nodes;
        const lastTextNode = [...currentNodes]
          .reverse()
          .find((n) => n.data.nodeType === 'agent_message');

        if (lastTextNode) {
          const content = String(lastTextNode.data.content);
          useTicketStore.getState().setPhaseArtifact(ticket_id, {
            phase: completedPhase,
            content,
            createdAt: new Date().toISOString(),
            agentId: agent_id,
          });

          // If VALIDATE just completed: parse result + add summary node + maybe block
          if (completedPhase === 'validate') {
            const result = parseValidateResult(content);
            useCanvasStore.getState().addValidateResultNode(result);
            if (result.critical > 0) {
              useTicketStore.getState().blockTicket(ticket_id);
            }
          }
        }

        // Advance to the next phase
        useTicketStore.getState().advanceTicketPhase(ticket_id);

        // After advance: check if we've entered VALIDATE — auto-trigger
        const updatedTicket = useTicketStore.getState().tickets.find((t) => t.id === ticket_id);
        if (updatedTicket?.activePhase === 'validate') {
          const planArtifact = updatedTicket.artifacts.plan;
          if (planArtifact) {
            try {
              // Get build agent's worktree info
              await useAgentStore.getState().refresh();
              const buildAgent = useAgentStore.getState().agents.find((a) => a.id === agent_id);
              const worktreePath = buildAgent?.worktree_path;

              // Get git diff from the build worktree
              const diff = await invoke<string>('get_worktree_diff', { agentId: agent_id });

              // Get repo info from ticket assignment
              const assignment = updatedTicket.assignments[0];
              const project = useProjectStore
                .getState()
                .projects.find((p) => p.id === useProjectStore.getState().activeProjectId);
              const repo =
                project?.repos.find((r) => r.id === assignment?.repoId) ?? project?.repos[0];
              const ghToken = useSecretsStore.getState().ghToken ?? '';

              if (!repo) {
                console.warn('[TicketCanvas] No repo found — cannot auto-trigger VALIDATE');
                return;
              }

              // Build validate prompt: plan + diff
              const validatePrompt = [
                'Validate the following plan against the code changes.',
                '',
                '## Approved Plan',
                planArtifact.content,
                '',
                '## Git Diff (code changes to validate)',
                diff || '(no diff available)',
              ].join('\n');

              const systemPrompt = buildPrompt({
                agentId: agent_id,
                role: buildAgent?.role ?? 'qa',
                personality: buildAgent?.personality ?? 'pragmatic',
                projectName: project?.name ?? '',
                projectStack: 'Rust, React 19, Tauri 2, TypeScript',
                projectContext: '',
                ticketNumber: 0,
                ticketTitle: updatedTicket.title,
                ticketDescription: updatedTicket.description,
                ticketAcceptanceCriteria: updatedTicket.acceptanceCriteria,
              });

              await invoke<void>('start_agent', {
                payload: {
                  agent_id,
                  ticket_id,
                  ticket_slug: updatedTicket.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
                  prompt: validatePrompt,
                  system_prompt: systemPrompt,
                  repo_root: repo.repoRoot,
                  gh_token: ghToken,
                  resume_session_id: null,
                  phase: 'validate',
                  worktree_path_override: worktreePath ?? null,
                },
              });
            } catch (err) {
              console.error('[TicketCanvas] Failed to auto-trigger VALIDATE:', err);
            }
          }
        }
      }
      // --- End phase lifecycle ---

      // Existing: check for end-of-session question (awaiting resume)
      if (!session_id) return;
      const currentNodes = useCanvasStore.getState().nodes;
      const lastTextNode = [...currentNodes]
        .reverse()
        .find((n) => n.data.nodeType === 'agent_message');
      if (lastTextNode && String(lastTextNode.data.content).trim().endsWith('?')) {
        setAwaiting(String(lastTextNode.data.content), session_id);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [setAwaiting]);
```

**Note on `async` in `useEffect` callback:** The outer callback passed to `listen` is marked `async` — this is fine because `listen` doesn't use the return value of the callback. The cleanup (`unlisten`) is still returned from the `useEffect` itself.

**Step 7: Run type check**

```bash
pnpm typecheck
```

Expected: 0 errors.

**Step 8: Run all tests**

```bash
pnpm test
```

Expected: All 41 tests pass (39 from Task 4 + 2 new ticketStore tests).

**Step 9: Run cargo check**

```bash
cargo check
```

Expected: 0 errors.

**Step 10: Commit**

```bash
git add apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat: auto-trigger VALIDATE agent after BUILD completes, capture result, block on critical"
```

---

## M3 Milestone Checklist

- [ ] `get_worktree_diff` Tauri command returns git diff from agent's worktree
- [ ] `worktree_path_override` skips worktree creation for VALIDATE
- [ ] VALIDATE/QA/SECURITY phases get read-only tool set
- [ ] `parseValidateResult` parses VERIFIED/MISMATCH/CRITICAL/ADVISORY counts
- [ ] `ValidateResultNode` renders summary with green/red color signal
- [ ] `addValidateResultNode` places summary node in execution lane
- [ ] `blockTicket` sets status to 'blocked'
- [ ] TicketCanvas auto-triggers VALIDATE agent when BUILD phase completes
- [ ] VALIDATE agent receives plan content + git diff in prompt
- [ ] VALIDATE artifact captured and phase advances normally
- [ ] CRITICAL mismatches block the ticket
- [ ] All 41 tests pass
- [ ] 0 TypeScript errors
- [ ] Rust cargo check clean

---

## Milestone 4 Preview: QA Pipeline

After VALIDATE, the ticket enters QA. M4 will:
- Auto-trigger a QA agent (same pattern as VALIDATE) that checks code style, coverage, and patterns
- Parse `CRITICAL | WARNING | ADVISORY` output from QA agent
- Render a `QaResultNode` summary on canvas
- Fan-out to parallel QA checks in future (style, security, docs)
