# Design Polish — Design Document

**Date:** 2026-02-21
**Approach:** Surgical swap (A) — change colors and icons in-place, no architectural refactor

---

## Goal

Polish the app's visual identity to feel premium and focused (Linear/Vercel style): deep dark shell, one distinctive accent color, Lucide SVG icons throughout, and a light canvas that reads like a design tool whiteboard.

---

## 1. Color System

### Shell (dark chrome)

Replace all `neutral-*` with `zinc-*` across the entire app shell, sidebar, panels, and modals. The palettes are visually similar but `zinc` is consistent and cooler-toned, which reads more premium.

| Token | Value |
|---|---|
| Deepest bg (sidebar, project switcher) | `zinc-950` |
| Panel / modal bg | `zinc-900` |
| Card / input / hover bg | `zinc-800` |
| Borders | `zinc-700` / `zinc-600` |
| Muted text | `zinc-400` / `zinc-300` |
| Primary text | `zinc-100` / `zinc-50` |

### Accent

Replace all `indigo-*` with `violet-*`:

| Token | Usage |
|---|---|
| `violet-600` | Active nav item, primary buttons, active rings |
| `violet-500` | Hover state |
| `violet-400` | Icon tint in dark contexts |
| `violet-950` / `violet-900` | Tinted backgrounds (e.g. thought node header) |

Also update the shadcn CSS variable `--primary` in `index.css` (dark mode) to violet's OKLch value to keep the design system in sync.

### Canvas (light)

The TicketCanvas background flips to light — like a design tool whiteboard. The dark app shell frames it.

| Element | Value |
|---|---|
| Canvas background | `bg-zinc-50` |
| Dot grid | `zinc-200` |
| Node base | white (`bg-white`) with `zinc-200` border |
| Node accent | 3px left border bar per node type (see below) |

#### Node left-bar accent colors

| Node type | Left bar color | Icon color |
|---|---|---|
| Thought / agent message | `violet-500` | `violet-600` |
| File read | `blue-500` | `blue-600` |
| File edit | `green-500` | `green-600` |
| File write | `emerald-500` | `emerald-600` |
| Bash command | dark card (`zinc-900` bg) — terminal stays dark | `zinc-100` |
| Awaiting user | `amber-500` | `amber-600` |

---

## 2. Icons

Replace all emoji and unicode symbols with Lucide SVG icons. All icons: `size={16}`, `strokeWidth={1.5}`.

### Sidebar navigation

| Current | Lucide component | View |
|---|---|---|
| ⌂ | `LayoutDashboard` | Dashboard |
| ◉ | `Hash` | Rooms |
| ▦ | `Columns3` | Board |
| ⬡ | `GitBranch` | Graph |
| ✉ | `Inbox` | Messages |
| ⚙ | `Settings2` | Settings |

### Canvas nodes

| Current | Lucide component | Node |
|---|---|---|
| 💭 | `Sparkles` | Thinking / agent message |
| 📄 | `FileText` | File read |
| ✏️ | `FilePen` | File edit |
| 🆕 | `FilePlus2` | File write |
| (unicode) | `Terminal` | Bash command |
| (unicode) | `MessageCircleQuestion` | Awaiting user |

### Agent status indicators

| Status | Lucide component | Color |
|---|---|---|
| `idle` | `Circle` (small, filled) | `green-500` |
| `working` | `Loader2` + `animate-spin` | `violet-400` |
| `waiting_for_user` | `MessageCircleQuestion` | `amber-400` |
| `reviewing` | `Eye` | `blue-400` |
| `blocked` | `CircleAlert` | `red-500` |

### Misc UI

| Current | Lucide component |
|---|---|
| `▼` / `▲` expand/collapse | `ChevronDown` / `ChevronUp` |
| `✕` close buttons | `X` |

---

## 3. Typography & Spacing

- Add `antialiased` to `<body>` in `index.css`
- Canvas node headers: `text-xs font-medium tracking-wide text-zinc-500 uppercase` label above content
- Ticket card titles: `font-medium` (up from default weight)
- Muted text: standardize on `text-zinc-400` everywhere

---

## 4. Files to Update

| File | Changes |
|---|---|
| `apps/desktop/src/index.css` | Update `--primary` CSS var to violet; add `antialiased` to body |
| `apps/desktop/src/components/layout/Sidebar.tsx` | Lucide icons; `indigo-*` → `violet-*` |
| `apps/desktop/src/components/layout/ProjectSwitcher.tsx` | `indigo-*` → `violet-*` |
| `apps/desktop/src/components/canvas/TicketCanvas.tsx` | Light canvas bg (`zinc-50`) |
| `apps/desktop/src/components/canvas/nodes/ThoughtNode.tsx` | White card + violet left bar; `Sparkles` icon |
| `apps/desktop/src/components/canvas/nodes/FileNode.tsx` | White cards + colored left bars; Lucide icons |
| `apps/desktop/src/components/canvas/nodes/BashNode.tsx` | Dark terminal card refined; `Terminal` icon |
| `apps/desktop/src/components/canvas/AskUserOverlay.tsx` | `indigo-*` → `violet-*`; `X` icon |
| `apps/desktop/src/components/board/TicketCard.tsx` | `neutral-*` → `zinc-*`; `indigo-*` → `violet-*` |
| `apps/desktop/src/components/agents/AgentPickerModal.tsx` | `indigo-*` → `violet-*`; Lucide status icons |
| `apps/desktop/src/components/ui/ToastContainer.tsx` | `violet-*` accents |
| `apps/desktop/src/components/layout/SettingsPanel.tsx` | `neutral-*` → `zinc-*`; `indigo-*` → `violet-*` |
| `apps/desktop/src/components/onboarding/OnboardingWizard.tsx` | `neutral-*` → `zinc-*`; `indigo-*` → `violet-*` |
| `apps/desktop/src/components/onboarding/StepConnectGitHub.tsx` | Same as above |
| `apps/desktop/src/components/messages/DmList.tsx` | `neutral-*` → `zinc-*`; `indigo-*` → `violet-*` |

---

## Out of Scope

- Font changes (system font stack stays)
- Sidebar labels (stays icon-only)
- shadcn CSS variable migration (future pass)
- Light/dark mode toggle (stays dark-shell, light-canvas)
- Animation system changes
