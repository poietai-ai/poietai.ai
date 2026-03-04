# Ticket Phase Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the ticket lifecycle from a simple status board into a configurable phase pipeline where every ticket flows through phase-specific agents with scoped context, producing typed artifacts at each stage.

**Architecture:** A `Ticket` gains `phases: TicketPhase[]` (computed from complexity), `activePhase`, and `artifacts`. Each phase runs a separate Claude process with a minimal, phase-specific context template. The canvas gains a phase breadcrumb. Subsequent milestones build the Plan artifact, VALIDATE phase, QA pipeline, and full lifecycle visualization on top of this foundation.

**Tech Stack:** TypeScript + Zustand (ticketStore), Rust (context/builder.rs + lib.rs), React/ReactFlow (canvas), pnpm workspaces

---

## Milestone Overview

| Milestone | What it delivers | Plan document |
|---|---|---|
| **M1: Phase Foundation** ← this doc | TicketPhase types, phase routing, ticketStore phase actions, phase-scoped context builder, breadcrumb on canvas | this file |
| **M2: Plan Artifact** | PLAN phase generates structured JSON; ghost graph on canvas before build starts | `2026-02-24-plan-artifact.md` |
| **M3: VALIDATE Phase** | Independent validator agent, plan-match drift detection, blocks PR on critical mismatch | future |
| **M4: QA Pipeline** | Configurable parallel QA checks (style, security, docs, coverage), fan-out canvas | future |
| **M5: Advanced Canvas + Review** | Lifecycle zoom levels, multi-agent adversarial review, review synthesis node | future |

**Execute M1 completely before starting M2. Each milestone gets its own plan document.**

---

## Current State (read this before starting)

### Key files to know

| File | What it is |
|---|---|
| `packages/shared/src/types/ticket.ts` | Canonical Ticket type — basic status union, no phases |
| `apps/desktop/src/store/ticketStore.ts` | Local richer Ticket type actually used by the UI — diverged from shared |
| `apps/desktop/src/lib/` | Does not exist yet — create it |
| `apps/desktop/src-tauri/src/context/builder.rs` | Monolithic context builder, `ContextInput` struct, `build()` method |
| `apps/desktop/src-tauri/src/lib.rs` | `start_agent` Tauri command + `StartAgentPayload` struct |
| `apps/desktop/src/components/canvas/TicketCanvas.tsx` | ReactFlow canvas, currently only shows BUILD phase execution |

### What the local Ticket type looks like (apps/desktop/src/store/ticketStore.ts)
```typescript
export type TicketStatus = 'backlog' | 'refined' | 'assigned' | 'in_progress' | 'in_review' | 'shipped';
export interface Assignment { agentId: string; repoId: string; }
export interface Ticket {
  id: string; title: string; description: string;
  complexity: number; status: TicketStatus;
  assignments: Assignment[]; acceptanceCriteria: string[];
}
```
Note: `packages/shared`'s Ticket is NOT imported by the desktop app — it defines its own. We update both in M1.

---

## Task 1: Update packages/shared Ticket type

**Files:**
- Modify: `packages/shared/src/types/ticket.ts`

### Step 1: Read the current file

```bash
cat /home/keenan/github/poietai.ai/packages/shared/src/types/ticket.ts
```

### Step 2: Replace the full file

```typescript
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
```

### Step 3: Build the shared package to verify no type errors

```bash
cd /home/keenan/github/poietai.ai && pnpm --filter @poietai/shared build
```
Expected: exits 0

### Step 4: Commit

```bash
git add packages/shared/src/types/ticket.ts
git commit -m "feat(shared): add TicketPhase, Artifact; phases pipeline on Ticket interface"
```

---

## Task 2: Add phase routing utility

**Files:**
- Create: `apps/desktop/src/lib/phaseRouter.ts`
- Create: `apps/desktop/src/lib/phaseRouter.test.ts`

> **Prerequisite:** Check if `@poietai/shared` is in the desktop package.json dependencies.
> Run: `grep "@poietai/shared" apps/desktop/package.json`
> If NOT found: import `TicketPhase` from a local re-export instead (see note below).

### Step 1: Write the failing test first

```typescript
// apps/desktop/src/lib/phaseRouter.test.ts
import { describe, it, expect } from 'vitest';
import { phasesForComplexity, nextPhase } from './phaseRouter';

describe('phasesForComplexity', () => {
  it('low complexity (1-3) returns minimal pipeline', () => {
    expect(phasesForComplexity(1)).toEqual(['plan', 'build', 'validate', 'ship']);
    expect(phasesForComplexity(3)).toEqual(['plan', 'build', 'validate', 'ship']);
  });

  it('medium complexity (4-7) returns standard pipeline', () => {
    const expected = ['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship'];
    expect(phasesForComplexity(4)).toEqual(expected);
    expect(phasesForComplexity(7)).toEqual(expected);
  });

  it('high complexity (8-10) returns full pipeline including review and security', () => {
    const expected = ['brief', 'design', 'review', 'plan', 'build', 'validate', 'qa', 'security', 'ship'];
    expect(phasesForComplexity(8)).toEqual(expected);
    expect(phasesForComplexity(10)).toEqual(expected);
  });
});

describe('nextPhase', () => {
  it('returns the next phase in the given pipeline', () => {
    const pipeline = ['plan', 'build', 'validate', 'ship'] as const;
    expect(nextPhase(pipeline as unknown as string[], 'plan')).toBe('build');
    expect(nextPhase(pipeline as unknown as string[], 'validate')).toBe('ship');
  });

  it('returns undefined when current phase is the last one', () => {
    const pipeline = ['plan', 'build', 'validate', 'ship'] as const;
    expect(nextPhase(pipeline as unknown as string[], 'ship')).toBeUndefined();
  });

  it('returns undefined when current phase is not in the pipeline', () => {
    const pipeline = ['plan', 'build'] as const;
    expect(nextPhase(pipeline as unknown as string[], 'validate')).toBeUndefined();
  });
});
```

### Step 2: Run test to confirm it fails

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run src/lib/phaseRouter.test.ts
```
Expected: FAIL — "Cannot find module './phaseRouter'"

### Step 3: Write the implementation

```typescript
// apps/desktop/src/lib/phaseRouter.ts
// Note: if @poietai/shared is not a desktop dependency, replace the import with:
// type TicketPhase = string;
import type { TicketPhase } from '@poietai/shared';

const LOW: TicketPhase[] = ['plan', 'build', 'validate', 'ship'];
const MEDIUM: TicketPhase[] = ['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship'];
const HIGH: TicketPhase[] = ['brief', 'design', 'review', 'plan', 'build', 'validate', 'qa', 'security', 'ship'];

export function phasesForComplexity(complexity: number): TicketPhase[] {
  if (complexity <= 3) return [...LOW];
  if (complexity <= 7) return [...MEDIUM];
  return [...HIGH];
}

export function nextPhase(phases: string[], current: string): string | undefined {
  const idx = phases.indexOf(current);
  if (idx === -1 || idx === phases.length - 1) return undefined;
  return phases[idx + 1];
}
```

### Step 4: Run tests to verify they pass

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run src/lib/phaseRouter.test.ts
```
Expected: PASS — 5 tests, all green

### Step 5: Commit

```bash
git add apps/desktop/src/lib/phaseRouter.ts apps/desktop/src/lib/phaseRouter.test.ts
git commit -m "feat(desktop): phaseRouter — complexity maps to TicketPhase pipeline"
```

---

## Task 3: Update ticketStore with phase support

**Files:**
- Modify: `apps/desktop/src/store/ticketStore.ts`
- Create: `apps/desktop/src/store/ticketStore.test.ts`

### Step 1: Read the current ticketStore

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/store/ticketStore.ts
```

### Step 2: Write the failing tests

```typescript
// apps/desktop/src/store/ticketStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTicketStore } from './ticketStore';

beforeEach(() => {
  useTicketStore.setState({ tickets: [] });
});

describe('addTicket', () => {
  it('computes phases from complexity and sets activePhase to first phase', () => {
    useTicketStore.getState().addTicket({
      title: 'Fix bug', description: 'desc', complexity: 2, acceptanceCriteria: [],
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.phases).toEqual(['plan', 'build', 'validate', 'ship']);
    expect(t.activePhase).toBe('plan');
    expect(t.artifacts).toEqual({});
    expect(t.status).toBe('backlog');
  });

  it('medium complexity ticket gets brief→ship pipeline', () => {
    useTicketStore.getState().addTicket({
      title: 'Feature', description: '', complexity: 5, acceptanceCriteria: [],
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.phases).toEqual(['brief', 'design', 'plan', 'build', 'validate', 'qa', 'ship']);
    expect(t.activePhase).toBe('brief');
  });
});

describe('advanceTicketPhase', () => {
  it('moves activePhase to the next phase in the pipeline', () => {
    useTicketStore.getState().addTicket({
      title: 'T', description: '', complexity: 2, acceptanceCriteria: [],
    });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().advanceTicketPhase(id); // plan → build
    expect(useTicketStore.getState().tickets[0].activePhase).toBe('build');
  });

  it('sets status to shipped when activePhase reaches ship', () => {
    useTicketStore.getState().addTicket({
      title: 'T', description: '', complexity: 2, acceptanceCriteria: [],
    });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().advanceTicketPhase(id); // plan → build
    useTicketStore.getState().advanceTicketPhase(id); // build → validate
    useTicketStore.getState().advanceTicketPhase(id); // validate → ship
    const t = useTicketStore.getState().tickets[0];
    expect(t.activePhase).toBe('ship');
    expect(t.status).toBe('shipped');
  });

  it('does nothing if ticket does not exist', () => {
    expect(() => {
      useTicketStore.getState().advanceTicketPhase('nonexistent');
    }).not.toThrow();
  });
});

describe('setPhaseArtifact', () => {
  it('stores artifact under the correct phase key', () => {
    useTicketStore.getState().addTicket({
      title: 'T', description: '', complexity: 2, acceptanceCriteria: [],
    });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().setPhaseArtifact(id, {
      phase: 'plan',
      content: '{"tasks":[]}',
      createdAt: '2026-02-24T00:00:00Z',
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.artifacts.plan?.content).toBe('{"tasks":[]}');
    expect(t.artifacts.plan?.phase).toBe('plan');
  });

  it('preserves existing artifacts when adding a new one', () => {
    useTicketStore.getState().addTicket({
      title: 'T', description: '', complexity: 5, acceptanceCriteria: [],
    });
    const id = useTicketStore.getState().tickets[0].id;
    useTicketStore.getState().setPhaseArtifact(id, {
      phase: 'brief', content: 'brief content', createdAt: '2026-02-24T00:00:00Z',
    });
    useTicketStore.getState().setPhaseArtifact(id, {
      phase: 'design', content: 'design content', createdAt: '2026-02-24T00:00:00Z',
    });
    const t = useTicketStore.getState().tickets[0];
    expect(t.artifacts.brief?.content).toBe('brief content');
    expect(t.artifacts.design?.content).toBe('design content');
  });
});
```

### Step 3: Run tests to verify they fail

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run src/store/ticketStore.test.ts
```
Expected: FAIL on missing `addTicket`, `advanceTicketPhase`, `setPhaseArtifact`

### Step 4: Implement the changes in ticketStore.ts

Key additions (apply to the existing file — do not rewrite from scratch):

**Add new types at the top of the file (after existing types):**
```typescript
import { phasesForComplexity, nextPhase } from '../lib/phaseRouter';

export type TicketPhase =
  | 'brief' | 'design' | 'review' | 'plan' | 'build'
  | 'validate' | 'qa' | 'security' | 'ship';

export interface Artifact {
  phase: TicketPhase;
  content: string;
  createdAt: string;
  agentId?: string;
}
```

**Add to Ticket interface:**
```typescript
phases: TicketPhase[];
activePhase?: TicketPhase;
artifacts: Partial<Record<TicketPhase, Artifact>>;
```

**Replace or augment `addTicket` — new signature accepts input without generated fields:**
```typescript
addTicket: (input: {
  title: string;
  description: string;
  complexity: number;
  acceptanceCriteria: string[];
}) => void;
```

**Implementation of addTicket:**
```typescript
addTicket: (input) => set((state) => {
  const phases = phasesForComplexity(input.complexity);
  const ticket: Ticket = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    complexity: input.complexity,
    status: 'backlog',
    assignments: [],
    acceptanceCriteria: input.acceptanceCriteria,
    phases,
    activePhase: phases[0],
    artifacts: {},
  };
  return { tickets: [...state.tickets, ticket] };
}),
```

**Add advanceTicketPhase:**
```typescript
advanceTicketPhase: (id: string) => set((state) => ({
  tickets: state.tickets.map((t) => {
    if (t.id !== id || !t.activePhase) return t;
    const next = nextPhase(t.phases, t.activePhase);
    if (!next) return t;
    return {
      ...t,
      activePhase: next,
      status: next === 'ship' ? 'shipped' : t.status,
    };
  }),
})),
```

**Add setPhaseArtifact:**
```typescript
setPhaseArtifact: (id: string, artifact: Artifact) => set((state) => ({
  tickets: state.tickets.map((t) =>
    t.id !== id ? t : { ...t, artifacts: { ...t.artifacts, [artifact.phase]: artifact } }
  ),
})),
```

### Step 5: Run tests to verify they pass

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm test -- --run src/store/ticketStore.test.ts
```
Expected: PASS — 6 tests, all green

### Step 6: Verify the full app builds (no TypeScript errors)

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm build
```
Expected: exits 0. If any existing component calls `addTicket` with the old signature, update those call sites to pass an input object.

### Step 7: Commit

```bash
git add apps/desktop/src/store/ticketStore.ts apps/desktop/src/store/ticketStore.test.ts
git commit -m "feat(desktop): ticketStore — phases, artifacts, advanceTicketPhase, setPhaseArtifact"
```

---

## Task 4: Phase-scoped context builder (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/src/context/builder.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

### Step 1: Read the current context builder

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src-tauri/src/context/builder.rs
```

### Step 2: Add TicketPhase enum to builder.rs

Add at the top of the file, before `ContextInput`:

```rust
#[derive(Debug, Clone, PartialEq, serde::Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TicketPhase {
    Brief,
    Design,
    Review,
    #[default]
    Build,
    Plan,
    Validate,
    Qa,
    Security,
    Ship,
}
```

### Step 3: Add phase_prompt_section() to the ContextInput impl block

Find the `impl ContextInput<'_>` block and add this method:

```rust
pub fn phase_prompt_section(&self, phase: &TicketPhase) -> String {
    match phase {
        TicketPhase::Brief => "\
## Your Task: BRIEF Phase
Extract structured requirements from the user's raw idea.
Produce a brief with these sections:
- **Problem statement** (1-2 sentences)
- **User stories** (\"As a ... I want ... so that ...\")
- **Constraints** (technical, scope, time)
- **Open questions** for the human to resolve
Keep it concise — this is the input to design, not the design itself.
Output as markdown.".to_string(),

        TicketPhase::Design => "\
## Your Task: DESIGN Phase
Produce a formal design document. Use the brief artifact as input.
Sections required:
- **Approach** (chosen solution and rationale)
- **Data models** (interfaces/types with field descriptions)
- **API contracts** (function signatures or HTTP endpoints)
- **Architectural decisions** (what you chose and what you rejected, and why)
- **Codebase grounding** (reference actual files/patterns from the project)
Ground every recommendation in the actual codebase. Do not recommend patterns
that don't exist in the project. Use Read tool to verify.".to_string(),

        TicketPhase::Plan => "\
## Your Task: PLAN Phase
Produce a structured execution plan as JSON. The plan must be so specific that
a build agent never needs to ask clarifying questions or search the web.
Rules:
- Each task group: ≤5 atomic tasks
- Every task: exact file path, code example showing the pattern to follow, named test cases with assertions
- Verify zero file conflicts between parallel groups before outputting
- Reference existing patterns by file:line (use Read tool to verify they exist)
Output the JSON plan wrapped in a ```json ... ``` fence.
If any requirement is unclear, stop and ask rather than guessing.".to_string(),

        TicketPhase::Build => "\
## Your Task: BUILD Phase
You have been given a complete execution plan. Follow it exactly.
Rules:
- Do NOT make design decisions — those were made in the PLAN phase
- Do NOT search the web — if the plan is insufficient, stop and report which task is unclear
- Do NOT modify files not listed in your task group
- Implement every task in your assigned group
- Run the test cases specified in the plan and confirm they pass
- Open a PR when all tasks are complete and tests pass".to_string(),

        TicketPhase::Validate => "\
## Your Task: VALIDATE Phase
You are an independent validator. You have not seen the build agent's reasoning.
You have two inputs: (1) the approved plan (source of truth), (2) the current code (target).
For every claim in the plan, verify it against the actual code.
Output format per claim:
  VERIFIED | <claim summary> | <file:line>
  MISMATCH | <claim summary> | Expected: <what plan says> | Found: <what code does> | CRITICAL|ADVISORY
A CRITICAL mismatch means the code violates an explicit plan requirement.
An ADVISORY mismatch means the code diverged in style but still satisfies intent.
Do not fix anything. Only report.".to_string(),

        TicketPhase::Qa => "\
## Your Task: QA Phase
Review the diff against project coding standards.
Check for: naming convention violations, missing error handling, dead code, insufficient tests.
Output format per finding:
  CRITICAL | <description> | <file:line>
  WARNING  | <description> | <file:line>
  ADVISORY | <description> | <file:line>
Do not fix. Only report.".to_string(),

        TicketPhase::Security => "\
## Your Task: SECURITY Phase
Review the diff for security vulnerabilities. Focus on OWASP Top 10.
Check for: injection vectors, authentication bypasses, sensitive data exposure, insecure dependencies.
Output format per finding:
  CRITICAL | <CVE/OWASP category> | <description> | <file:line>
  WARNING  | <description> | <file:line>".to_string(),

        TicketPhase::Review | TicketPhase::Ship => String::new(),
    }
}
```

### Step 4: Update the build() method signature to accept phase

Find the current `build()` method and add a `phase` parameter:

```rust
pub fn build(&self, phase: &TicketPhase) -> String {
    // existing build logic...
    // At the end, append the phase section:
    let phase_section = self.phase_prompt_section(phase);
    if phase_section.is_empty() {
        system_prompt  // existing return
    } else {
        format!("{}\n\n{}", system_prompt, phase_section)
    }
}
```

### Step 5: Read lib.rs and add phase field to StartAgentPayload

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src-tauri/src/lib.rs
```

Add to `StartAgentPayload`:
```rust
pub phase: Option<String>,  // defaults to "build" if absent
```

In `start_agent`, deserialize and use it:
```rust
let phase: TicketPhase = payload.phase
    .as_deref()
    .and_then(|p| serde_json::from_str(&format!("\"{}\"", p)).ok())
    .unwrap_or_default();  // TicketPhase::Build is the default

// Pass phase to context builder:
let system_prompt = context.build(&phase);
```

### Step 6: Verify Rust compiles cleanly

```bash
cd /home/keenan/github/poietai.ai/apps/desktop/src-tauri && cargo check
```
Expected: no errors. Warnings about unused variants are fine.

### Step 7: Commit

```bash
git add apps/desktop/src-tauri/src/context/builder.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tauri): phase-scoped context builder — TicketPhase enum, phase_prompt_section per phase"
```

---

## Task 5: Pass activePhase from frontend to start_agent

**Files:**
- Find: wherever `invoke('start_agent', ...)` is called in `apps/desktop/src`
- Modify that file

### Step 1: Find the invocation site

```bash
grep -r "start_agent" /home/keenan/github/poietai.ai/apps/desktop/src --include="*.ts" --include="*.tsx" -l
```

### Step 2: Read the file containing the invocation

```bash
cat <the file found above>
```

### Step 3: Add `phase` to the invoke payload

The ticket passed to start_agent should have `activePhase`. Add it:

```typescript
// In the invoke call, add:
phase: ticket.activePhase ?? 'build',
```

### Step 4: Verify the app builds end-to-end

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm build
```
Expected: exits 0

### Step 5: Commit

```bash
git add <modified file>
git commit -m "feat(desktop): pass activePhase to start_agent invocation"
```

---

## Task 6: PhaseBreadcrumb component

**Files:**
- Create: `apps/desktop/src/components/canvas/PhaseBreadcrumb.tsx`
- Modify: `apps/desktop/src/components/canvas/TicketCanvas.tsx`

### Step 1: Read TicketCanvas.tsx to understand current structure

```bash
cat /home/keenan/github/poietai.ai/apps/desktop/src/components/canvas/TicketCanvas.tsx
```

### Step 2: Create PhaseBreadcrumb component

```tsx
// apps/desktop/src/components/canvas/PhaseBreadcrumb.tsx
import type { TicketPhase } from '../../store/ticketStore';

const PHASE_LABELS: Record<TicketPhase, string> = {
  brief:    'Brief',
  design:   'Design',
  review:   'Review',
  plan:     'Plan',
  build:    'Build',
  validate: 'Validate',
  qa:       'QA',
  security: 'Security',
  ship:     'Ship',
};

interface Props {
  phases: TicketPhase[];
  activePhase?: TicketPhase;
}

export function PhaseBreadcrumb({ phases, activePhase }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-xs font-mono border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
      {phases.map((phase, i) => {
        const isActive = phase === activePhase;
        const isDone = activePhase
          ? phases.indexOf(activePhase) > i
          : false;

        return (
          <span key={phase} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-zinc-700 select-none">›</span>
            )}
            <span className={
              isActive
                ? 'text-violet-400 font-semibold'
                : isDone
                  ? 'text-zinc-600 line-through'
                  : 'text-zinc-600'
            }>
              {PHASE_LABELS[phase]}
            </span>
          </span>
        );
      })}
    </div>
  );
}
```

### Step 3: Add PhaseBreadcrumb to TicketCanvas

In `TicketCanvas.tsx`, import `PhaseBreadcrumb` and the ticket from the store. Render it as a fixed overlay above the ReactFlow canvas. The ticket's `phases` and `activePhase` come from `useTicketStore`.

The breadcrumb should appear at the top of the canvas area, above the node graph. Place it inside a `<div className="flex flex-col h-full">` wrapper, with breadcrumb first and `<ReactFlow ...>` second.

### Step 4: Verify the component renders

Run the dev server and open a ticket. Confirm the breadcrumb shows the ticket's phase pipeline with the active phase highlighted in violet.

```bash
cd /home/keenan/github/poietai.ai/apps/desktop && pnpm tauri dev
```

### Step 5: Commit

```bash
git add apps/desktop/src/components/canvas/PhaseBreadcrumb.tsx apps/desktop/src/components/canvas/TicketCanvas.tsx
git commit -m "feat(canvas): PhaseBreadcrumb — pipeline phases displayed above execution graph"
```

---

## M1 Complete — Verification Checklist

Before moving to M2, verify all of the following:

- [ ] `pnpm --filter @poietai/shared build` passes
- [ ] `pnpm test -- --run src/lib/phaseRouter.test.ts` — 5 tests green
- [ ] `pnpm test -- --run src/store/ticketStore.test.ts` — 6 tests green
- [ ] `cargo check` in `apps/desktop/src-tauri` — no errors
- [ ] `pnpm build` in `apps/desktop` — no TypeScript errors
- [ ] Dev server: new ticket with complexity 2 shows `Plan › Build › Validate › Ship` breadcrumb
- [ ] Dev server: new ticket with complexity 5 shows `Brief › Design › Plan › Build › Validate › QA › Ship` breadcrumb
- [ ] Dev server: starting an agent passes the `phase` field; console shows correct phase in agent output

---

## Milestone 2 Preview: Plan Artifact

After M1 ships, the next plan document will cover:

**Goal:** PLAN phase produces a structured JSON artifact that the BUILD agent consumes as its complete instruction set.

**New types:**
```typescript
interface PlanTask {
  id: string;
  action: 'create' | 'modify' | 'delete';
  file: string;
  description: string;
  patternReference?: string;   // "See src/services/report_service.ts:45-60"
  codeExample?: string;
  testCases?: Array<{ name: string; setup: string; input: string; assertion: string }>;
}
interface PlanTaskGroup {
  groupId: string;
  agentRole: string;
  tasks: PlanTask[];
  filesTouched: string[];
}
interface PlanArtifact {
  ticketId: string;
  designRef?: string;
  taskGroups: PlanTaskGroup[];
  fileConflictCheck: { conflicts: string[]; status: 'clean' | 'conflict' };
  parallelSafe: boolean;
}
```

**Canvas change:** When `activePhase === 'build'` and a `plan` artifact exists, render a "ghost graph" — translucent node cards for each task in the plan, which light up solid as the build agent completes them.

**Context change:** BUILD phase agent receives ONLY its assigned `PlanTaskGroup` as context payload, not the full ticket description or design rationale.
