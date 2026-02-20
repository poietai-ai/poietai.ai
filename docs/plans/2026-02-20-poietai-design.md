# poietai.ai — Product Design Document

> *A software team at your fingertips.*

**Origin:** This product was born from a real workflow — a solo CTO running a rapidly growing SaaS (Roof Report Pro) using Claude Code + CI Claude (GitHub Actions) to build and review production code. The loop works. The PRs ship. The reviews are domain-specific and precise. What doesn't exist is an interface for that loop — something that makes it feel like a team, not a terminal.

**Core thesis:** The moat isn't the AI. Anyone can call the Claude API. The moat is context — the dense, project-specific knowledge (CLAUDE.md files, architectural decisions, deployment pipelines, domain expertise) that transforms a generic model into a team member who *knows your codebase*. poietai.ai generates, maintains, and operationalizes that context. Everything else — the canvas, the channels, the marketplace — is the interface built around that core.

---

## The Problem

A solo technical founder running AI agents today juggles:

- Multiple terminal sessions (one per agent, per project)
- GitHub for PRs and CI review
- Slack/Discord for communication that isn't connected to the code
- Linear/Jira for tickets that aren't connected to the agents
- Their own head for tracking which agent is doing what, what decisions were made, and where things stand

The cognitive overhead isn't the work. It's the orchestration. And as you add projects (a main SaaS, a side plugin, client websites), the context switching compounds. Every switch costs focus. Focus is the actual scarce resource.

---

## The Vision

poietai.ai is a desktop application — a spatial IDE and agent orchestration layer — that makes running multiple AI engineering teams feel like managing a live, bustling company. You walk in every morning and the office is already active. DMs are waiting. Agents have been working overnight. The ticket board has moved.

It is not a code editor with AI bolted on.
It is not a chatbot.
It is not a project management tool.

It is all of them — unified into a single surface where the unit of work is an agent with a mission, and the unit of collaboration is a team with a shared context.

---

## Mental Model — Three Layers, One Surface

The entire app is one zoomable canvas. Navigation is zoom, not navigation. You drill in, you zoom out. No modes. No separate windows.

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: Project Workspace                                 │
│  Ticket board · Agent roster · Slack channels · Rooms       │
│                    ↓ click ticket                           │
│  LAYER 2: Ticket Canvas (Red String Graph)                  │
│  File nodes · Wires · Agent presence · Live chat            │
│                    ↓ click file node                        │
│  LAYER 3: File Editor                                       │
│  Monaco · Clean · No cursors · Agent comments at gutter     │
│                    ↑ back arrow zooms out                   │
└─────────────────────────────────────────────────────────────┘
```

Every transition is a zoom animation — the same continuous surface, different scale. The mental model is Figma: frames on a canvas, you zoom into a frame to work, zoom back out to see the whole picture.

---

## Layer 1: The Project Workspace

### Workspace Switcher

Top bar. Each workspace is a project:
- `RRP` — Roof Report Pro (Go API monorepo + Next.js frontend)
- `neovim-plugin` — Personal plugin repo
- `KJ Clients` — Folder of client websites

Each workspace has its own team, its own board, its own channel list, its own agent context. Switching workspaces is like switching between companies. The Slack layer, the board, the agents — everything changes. The app chrome stays the same.

### The Ticket Board

The default view when you enter a workspace. Kanban columns:

```
BACKLOG → REFINED → ASSIGNED → IN PROGRESS → IN REVIEW → SHIPPED
```

Each ticket card shows:
- Title + complexity score (1–10)
- Assigned agent avatar + name
- Status indicator
- Unread comment badge (from canvas or chat)

Complexity drives autonomy:

| Score | What happens |
|---|---|
| 1–2 | Agent picks it up, implements, CI reviews, merges. You get a DM when it's done. |
| 3–4 | Agent implements, DMs you for approval before merge. |
| 5–6 | Agent checks in at key decision points via ticket chat. |
| 7–8 | Brief design conversation in a room, then implements. |
| 9–10 | Brainstorm room session before any code is written. |

You set the thresholds. Some founders want to review everything above 3. Others trust the system up to 7.

### The Slack Layer (Left Sidebar)

This is the heartbeat of the app. It makes it feel like a live company, not a tool. When you open poietai.ai, things are happening.

**Channels** — persistent, team-wide:
- `#general` — all agents, all conversations
- `#incidents` — production issues, auto-fed from monitoring integrations
- `#new-hires` — *when an agent is hired from the marketplace, they appear here and the team greets them* (more below)
- User-created: `#frontend`, `#backend`, `#q4-sprint`, anything

**Rooms** — structured sessions with a purpose and an end:
- **Brainstorm** — open-ended exploration, agents riff from their perspectives, tickets emerge naturally from the conversation
- **Design Review** — PM presents user need, engineers propose solutions, staff engineer evaluates fit, group converges, decision is captured
- **Standup** — agents report status, flag blockers, surface dependencies, done in minutes
- **War Room** — production incident or urgent issue, all relevant agents focus on one problem

Rooms produce artifacts: decisions, action items, tickets. Nothing that happens in a room gets lost.

**Group Messages** — ad-hoc multi-agent threads. `@StaffEngineer @QA — quick thought on this approach before I commit.`

**Direct Messages** — 1:1 with any agent. The primary notification surface. Agents don't send system toasts — they DM you. `"Just flagged something on the billing canvas before you get there — worth 2 minutes."` That's not a notification. That's a colleague.

### The Notification System

Notifications don't float above the app — they arrive through the Slack layer. An agent finishing a PR review sends you a DM. An agent leaving a canvas comment sends you a DM with a deep link. You click it, the canvas opens, the comment is highlighted. The notification *is* the agent talking to you. It has their voice, their role, their context.

Badge counts on channels and DMs. Toast for urgent things (agent blocked, CI failed, production incident). Inbox for everything else.

---

## Layer 2: The Ticket Canvas (The Red String Graph)

Click a ticket on the board and you zoom into its canvas — a node graph built in real time as work happens. This is the most original idea in the product.

### The "Red String" Model

The canvas is the detective's corkboard. The ticket is the case. Every file touched is a piece of evidence. The connections are the red string.

Two types of connections, like Unreal Engine Blueprint's two wire types:

**Structural wires** (subtle, always present):
File A imports File B. Function in A calls function in B. Type defined in B used in A. Drawn from static analysis — they represent the *shape* of how the code is connected. They exist whether or not anyone has touched the files.

**Touch wires** (bold, build over time):
File A was opened first. Then B. Then C was created. Then A was edited again. These wires build up as work happens — they tell the *story* of how the ticket was solved. This is the red string.

Together: you can see both *why* files are related and *how* the change unfolded.

### File Nodes

Each node is a file card:
- File path and language badge
- Last touched by (agent name + color, or "you")
- A minimap preview of the file contents
- **Comment pins** visible on the minimap at their line positions
- **Highlight bands** visible on the minimap for section-level comments
- Agent avatar indicator if an agent is currently "at" this node

Untouched but structurally connected files appear in a muted style — part of the context, not part of the story yet.

### Agent Presence on the Canvas

Agent cursors live here, not in the editor. Each agent has a color and a name label. Their cursor drifts between nodes as they work. You can see at a glance:
- Your staff engineer is at `billing_service.go`
- Your QA agent is hovering over `billing_test.go`
- Your backend engineer just created a new node: `billing_handler.go`

You're not reading a log. You're watching a team work.

### Figma-Style Comment Bubbles

Three levels of specificity, all surfaced on the canvas:

**File-level** — a bubble pinned to the node header. "This service needs refactoring before we add to it — the token deduction logic is spread across three methods."

**Section-level** — a colored highlight band on the minimap, bubble pinned to the side of the node. Visible at canvas zoom without opening the file.

**Line-level** — a pin dot on the minimap at the specific line. Bubble on hover or click.

You can read, reply to, and resolve every agent comment from the canvas without ever opening a file. The canvas communicates enough. The editor stays clean.

### Live Ticket Chat

A panel on the ticket canvas. Agents arrive when they have something to say and leave when they're done — like a Discord voice channel, but text. Not a log. Not a terminal. A live conversation tied to this specific piece of work.

Agents can `@mention` files: `"@billing_service.go line 47"` becomes a deep link that pans the canvas to that node and highlights the relevant comment. Agents communicate intent: `"I'm about to refactor the token deduction into its own method — should be cleaner and easier to test."` You can reply or not. They continue either way.

### Real-Time Graph Construction

When an agent picks up a ticket and starts working, you can watch the graph build:
1. Agent opens `billing_handler.go` → first node appears
2. Agent reads `billing_service.go` (it imports it) → structural wire drawn
3. Agent reads `subscription.go` → new node, structural wire
4. Agent edits `billing_handler.go` → touch wire appears, node pulses
5. Agent creates `billing_test.go` → new node, touch wire from handler
6. Agent leaves a section comment on `billing_service.go` → highlight band appears on minimap

Every step is visible. You understand what's happening without asking. When you check in, you don't need context — the graph gives it to you.

---

## Layer 3: The File Editor

Click a file node and it expands to fill the screen. Monaco editor. Clean.

**No agent cursors.** The social layer lives on the canvas. The editor is focus mode.

Agent comments that reference specific lines appear as subtle gutter indicators — a small colored dot at the line number. Click it to open the comment thread. The comment is the same object as the canvas comment bubble; this is just a secondary access point.

**The interrupt threshold:** If an agent has a high-confidence, time-sensitive concern while you're editing — something that will cause a real problem if you continue — it can appear as a non-blocking inline suggestion. Not a popup, not a modal. A faint annotation: `⚠ staff-engineer: this breaks the service layer pattern (see comment)`. Dismissible with one keystroke. This is rare. Agents don't interrupt unless it matters.

**On-pause annotations:** When you stop typing for ~3 seconds, agents can drop lower-priority observations — faded gutter indicators that appear without sound or motion. You look up and see them when you're ready.

---

## The Agent System

### Agent Anatomy

Every agent has:
- **Role** — PM, Frontend Engineer, Backend Engineer, Fullstack Engineer, Staff Engineer / Architect, Designer, QA, DevOps, Technical Writer, Security / Compliance, Custom
- **Personality** — Pragmatic (ships fast, favors proven patterns) · Perfectionist (catches edge cases, pushes for clean abstractions) · Ambitious (bold ideas, pushes scope forward) · Conservative (questions scope, asks "do users actually need this?") · Devil's Advocate (challenges assumptions, finds holes)
- **System prompt** — the dense project-specific context that makes them domain-aware. This is the CLAUDE.md in agent form. poietai.ai helps generate and maintain this.
- **Communication style** — how verbose they are, how often they interject, formality level
- **Status** — idle · working · reviewing · blocked · waiting

Agents are persistent team members, not chat sessions. They remember the project. They remember past decisions. They have working relationships with other agents.

### Team Templates

Starting points, not prescriptions:

**Solo SaaS Founder** — 1 PM (balanced) · 2 Full-Stack Engineers (one pragmatic, one detail-oriented) · 1 Staff Engineer · 1 QA

**API-First Startup** — 1 PM · 1 API Design · 2 Backend Engineers · 1 Frontend Engineer · 1 DevOps · 1 Staff Engineer

**Agency / Multi-Client** — 1 Project Manager · 3 Full-Stack Engineers · 1 Designer · 1 QA

**Enterprise / Compliance** — 1 PM · 2 Engineers · 1 Staff Engineer · 1 Security/Compliance · 1 Technical Writer · 1 QA

Every template is a starting point. Add, remove, customize, scale.

---

## The Agent Marketplace

### Hiring Agents

Users publish agents they've built and configured to the marketplace. Other users can browse and "hire" them into their project.

When you hire an agent:
1. They appear in your agent roster
2. A message is posted to `#new-hires`: the new agent introduces themselves
3. Your existing agents greet them — the staff engineer offers to share codebase context, the PM welcomes them to the current sprint
4. The new agent is immediately available for tickets and channels

This isn't a metaphor. It's the actual UX. The `#new-hires` channel is where your team grows. It makes agents feel like people who joined, not configurations you applied.

### Agent Cards in the Marketplace

Each agent listing shows:
- Role + personality
- Specializations (e.g., "SOC2 Compliance Reviewer", "Roofing Industry Domain Expert", "Go / pgx backend specialist")
- Hired-by count and ratings
- Sample review comments or messages (so you can evaluate their voice)
- Free or paid (agent creators earn revenue share)

### Editing Hired Agents

Any agent — marketplace or self-created — can be edited after hiring:
- Adjust personality
- Add domain context (paste in your CLAUDE.md, describe your stack)
- Tune communication frequency
- Change role emphasis

The marketplace agent is a starting point. You shape them for your project.

---

## The Context Layer (The Real Moat)

Every workspace has a context document — the living CLAUDE.md equivalent for that project. It contains:
- Stack and architecture decisions
- File structure index (key files, what they do, where things live)
- Coding patterns and conventions
- Deployment pipeline
- Domain knowledge (e.g., SOC2 policies for RRP, roofing industry for a roofing SaaS)

poietai.ai:
- **Generates** an initial context doc from the codebase on first open (reads structure, infers patterns)
- **Maintains** it as agents work — when a new pattern is established, it's captured; when a file moves, it's updated
- **Injects** it into every agent's context on every task

This is what makes CI Claude at RRP catch that `accounts.training_data_opt_out` doesn't exist yet when reviewing a policy doc. It's not magic. It's context. poietai.ai operationalizes that context at scale, across every project, without you having to maintain it manually.

---

## What's Different

| Tool | What it does | What's missing |
|---|---|---|
| Cursor / Copilot | AI in your editor | Single player, no team, no persistence, no presence |
| Linear / Jira | Ticket board | No agents, no code, no context |
| Slack / Discord | Channels | Not connected to code, tickets, or agents |
| GitHub + CI | Async PR review | No real-time presence, no orchestration |
| Claude Code | Agent that builds | No team, no UI, no cross-project management |
| **poietai.ai** | All of it, one canvas | — |

The thing none of them have: **presence**. You can't see anyone working. poietai.ai makes work visible — spatially, in real time, across files and tickets and conversations — in a way that feels like a team, not a sequence of prompts.

---

## What Gets Built First (v1 Scope)

The vision is large. The v1 is the slice that makes the experience feel alive.

**Must have:**
1. Workspace switcher (multi-project)
2. Ticket board (create, assign, move)
3. Agent roster (create agents, assign roles/personalities)
4. The ticket canvas — node graph, file nodes, touch/structural wires
5. Monaco file editor (clean, opens from canvas node)
6. DM channels (agent → user notifications)
7. One working agent loop: ticket assigned → agent implements → PR created → CI review → comes back to you for merge approval

**The moment that proves the product:** You assign a ticket to an agent. You go do something else. A DM arrives: agent has a question about the error handling approach. You answer in two sentences. They continue. Thirty minutes later: "PR is up, CI Claude reviewed it, two minor issues I've already addressed. Ready for your merge approval." You look at the canvas — the node graph shows exactly what they touched and why. You merge.

That moment is the product. The marketplace, the rooms, the graph view — those come after.

---

*Design finalized: 2026-02-20*
*Origin conversation: poietai.ai brainstorming session*
