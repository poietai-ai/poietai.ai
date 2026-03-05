# Ticket Navigation & Parallel Fan-out Design

**Date:** 2026-03-04

Two features designed together because fan-out changes the canvas that ticket chips navigate to.

---

## Feature A: Ticket Chip → Canvas Navigation

Clicking a `#2` chip in DMs (or anywhere tokens are rendered) navigates to the Graph view with that ticket's canvas loaded.

### Changes

1. **`navigationStore.ts`** — add `selectedTicketId: string | null` and `setSelectedTicketId(id)` which atomically sets `activeView: 'graph'`.

2. **`TokenChip.tsx`** — ticket click calls `navigationStore.setSelectedTicketId(ticket.id)` instead of `setActiveView('dashboard') + selectTicket(id)`.

3. **`MainArea.tsx`** — read `selectedTicketId` from nav store, pass to `TicketCanvas` instead of hardcoded `"ticket-1"`. Show empty state if null.

4. **`TicketBoard.tsx`** — ticket card click also calls `setSelectedTicketId` so board→canvas navigation works.

---

## Feature B: Rust-Side Phase Orchestrator with Parallel Fan-out

### Problem

Phase transition logic lives in `TicketCanvas.tsx`'s `agent-result` useEffect (~300 lines). This is fragile:
- Unmounting the canvas breaks the phase chain
- Can't run multiple tickets concurrently
- Fan-out requires tracking N parallel sessions — too complex for a React component

### Solution

Move phase orchestration to a new `orchestrator.rs` Rust module. The canvas becomes a pure display layer.

### Orchestrator Architecture

```
PhaseOrchestrator
  ├─ ticket_id: String
  ├─ phase_sequence: [brief, design, plan, build, validate, qa, security, ship]
  ├─ active_phase: Phase
  ├─ fan_out_state: Option<FanOutState>
  └─ app_handle: AppHandle

FanOutState
  ├─ task_groups: Vec<TaskGroupRun>
  ├─ parent_worktree: PathBuf
  └─ pending_count: AtomicUsize

TaskGroupRun
  ├─ group_id: String
  ├─ agent_role: String
  ├─ worktree_branch: String
  ├─ session_id: Option<String>
  └─ status: Pending | Running | Completed | Failed
```

### Phase Lifecycle

**Single-agent phases** (brief, design, plan, validate, qa, security):
1. Orchestrator calls `process::run()`
2. On exit, orchestrator parses artifacts, checks blockers, advances phase, starts next

**Fan-out phase** (build, when `parallelSafe=true` and `taskGroups.len() > 1`):
1. Plan completes → orchestrator reads `PlanArtifact`
2. For each task group: `git worktree add` on a branch forked from ticket branch
3. Spawn N concurrent `process::run()` via `tokio::JoinSet`
   - Each gets its own worktree, filtered system prompt, same `agent_id`
   - Events tagged with `group_id` for swim lane routing
4. Track completions; when all done, merge branches into parent worktree
   - Merge conflict → emit `orchestrator-blocked`, set ticket to blocked
   - Clean → proceed to validate

**Sequential fallback** (`parallelSafe=false` or single task group):
- Run task groups one at a time, same as current behavior

### Events Emitted to Frontend

| Event | Payload | When |
|-------|---------|------|
| `orchestrator-phase-started` | `{ ticket_id, phase, group_id? }` | Phase begins |
| `orchestrator-phase-completed` | `{ ticket_id, phase, artifact? }` | Phase ends |
| `orchestrator-fan-out` | `{ ticket_id, groups: [{group_id, agent_role}] }` | Build fans out |
| `orchestrator-fan-in` | `{ ticket_id, merge_status }` | All groups done |
| `orchestrator-blocked` | `{ ticket_id, reason, details }` | Critical or merge conflict |
| `orchestrator-question` | `{ ticket_id, agent_id, content }` | End-of-session question |

Existing `agent-event` and `agent-status` events continue flowing with an optional `group_id` field.

### Git Worktree Management

```
ticket-worktree/          (parent, branch: ticket-42-build)
  ├─ .worktrees/
  │   ├─ group-0/         (branch: ticket-42-build-frontend)
  │   └─ group-1/         (branch: ticket-42-build-backend)
```

Merge process (sequential, after all sessions complete):
```
for each group branch:
  git merge --no-ff <branch>
    → conflict: abort, emit orchestrator-blocked, preserve worktrees
    → clean: continue, remove child worktree + branch
```

On ticket cancellation: all worktrees cleaned up.

---

## Canvas Swim Lanes

### Layout

```
Ghost nodes (plan tasks):     y = -180  (unchanged)
Single-agent mode:            y = 80    (unchanged)
Lane 0 (group 0):             y = 80
Lane 1 (group 1):             y = 80 + 260
Lane N (group N):             y = 80 + N * 260
```

### Special Nodes

- **Fan-out node** — after plan phase, shows "Building in parallel" with group count. Edges fan to each lane.
- **Lane label** — left-pinned per lane, shows `agentRole`.
- **Fan-in node** — after all lanes complete. Shows merge status. Edges converge from each lane's last node.

### canvasStore Changes

`addNodeFromEvent` gains `group_id` awareness:
- Look up lane index from group ordering
- Calculate `y` from lane index, `x` from per-lane node count
- Ghost activation scopes to matching task group's files

New actions: `addFanOutNode(ticketId, groups)`, `addFanInNode(ticketId, mergeStatus)`.

### Edges

- Fan-out node → first node in each lane
- Within lane: sequential chain
- Last node per lane → fan-in node
- Fan-in node → first validate node

---

## File Changes

### Rust (src-tauri/src/)

| File | Change |
|------|--------|
| `agent/orchestrator.rs` | **New.** PhaseOrchestrator, phase lifecycle, fan-out/fan-in, worktree management, artifact parsing, event emission |
| `agent/mod.rs` | Export orchestrator module |
| `lib.rs` | `start_agent` delegates to orchestrator instead of raw `process::run()` |
| `agent/process.rs` | Add optional `group_id` to `AgentRunConfig` for event tagging |

### Frontend (src/)

| File | Change |
|------|--------|
| `store/navigationStore.ts` | Add `selectedTicketId`, `setSelectedTicketId` |
| `components/messages/TokenChip.tsx` | Ticket click → `setSelectedTicketId` |
| `components/layout/MainArea.tsx` | Read `selectedTicketId`, pass to `TicketCanvas` |
| `components/canvas/TicketCanvas.tsx` | Delete `agent-result` phase useEffect. Add `orchestrator-*` listeners. Lane-aware node routing |
| `store/canvasStore.ts` | Lane-aware positioning, `addFanOutNode`, `addFanInNode` |
| `components/layout/AppShell.tsx` | `orchestrator-*` listeners → sync ticket store |
| `components/board/TicketBoard.tsx` | Card click → `setSelectedTicketId` |
