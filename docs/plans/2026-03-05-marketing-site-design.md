# poietai.ai Marketing Site — Design Document

*Design finalized: 2026-03-05*

---

## Overview

Public-facing marketing website for poietai.ai — a desktop application that gives you a virtual engineering organization powered by AI agents. The marketing site establishes the brand, explains the product, and collects waitlist signups while the product is in active development.

---

## Domain Architecture

| Domain | Purpose | Implementation |
|---|---|---|
| **poietai.ai** | Primary marketing site | Next.js on Vercel |
| **poietai.com** | Redirect to poietai.ai | Vercel redirect rule |
| **poietai.dev** | Developer hub — docs, API reference, community | Future, separate repo |
| **poietai.app** | User accounts, dashboard, billing | Future, separate repo |

All DNS managed in Vercel. The `.com` redirect is day-one. The `.dev` and `.app` are placeholders until ready (redirect to `.ai`).

---

## Repo Strategy

| Repo | Domain | Purpose |
|---|---|---|
| `poietai-ai/marketing` | poietai.ai + poietai.com | Marketing site, blog, waitlist |
| `poietai-ai/docs` | poietai.dev | Developer docs, API reference, community hub |
| `poietai-ai/app` | poietai.app | User accounts, dashboard, billing |
| `poietai-ai/server` | — | Backend API (future) |
| `poietai-ai/poietai.ai` | — | Desktop app (existing) |

All separate repos, all deploying to Vercel independently. Only `poietai-ai/marketing` is built now.

---

## Target Audience

Two distinct audiences, both served by one site:

1. **Technical founders / indie hackers** — already using Claude Code, running AI agents in terminals, juggling multiple sessions. They immediately get the value prop.
2. **Non-technical creators** — have business ideas but can't code. The platform staffs their team with the right agents (including security, architecture, DevOps) so they don't need to know what they're missing.

The homepage must land for both without feeling like it's trying too hard for either.

---

## Site Architecture

All pages have real content for SEO indexing. All CTAs funnel to email waitlist.

```
poietai.ai/
├── /                   Home
│   ├── Hero — tagline, sub-copy, waitlist CTA, product teaser visual
│   ├── Problem — the pain of orchestrating AI agents today
│   ├── Solution — "A SaaS company at your fingertips"
│   ├── Features overview — canvas, agents, DMs, tickets, context layer
│   ├── Audience split — technical founders AND non-technical creators
│   ├── Social proof / testimonials (placeholder)
│   └── Final CTA — waitlist
├── /features           Deep dive
│   ├── Agent system — roles, personalities, marketplace
│   ├── Ticket board — kanban, complexity-driven autonomy
│   ├── Ticket canvas — red string graph, file nodes, wires
│   ├── Communication — DMs, channels, rooms
│   └── Context layer — CLAUDE.md generation, the moat
├── /pricing            Coming soon state
│   └── "We're still building. Join the waitlist to be first."
├── /blog               Building in public
│   └── MDX-based posts
├── /about              Origin story
│   └── Solo CTO, RRP, Claude Code, the workflow that sparked the idea
├── /changelog          Shipped features
│   └── Versioned updates
└── /contact            Simple form or email
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Blog | MDX (next-mdx-remote or @next/mdx) |
| Email/Waitlist | Resend (audience list) |
| Hosting | Vercel |
| Package manager | pnpm |

### Repo Structure

```
poietai-ai/marketing
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── features/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── blog/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── about/page.tsx
│   │   ├── changelog/page.tsx
│   │   └── contact/page.tsx
│   ├── components/
│   │   ├── layout/        nav, footer, waitlist banner
│   │   ├── home/          hero, features preview, audience sections
│   │   ├── ui/            buttons, inputs, cards
│   │   └── blog/          MDX rendering, post cards
│   └── lib/
│       ├── resend.ts      waitlist email collection
│       └── blog.ts        MDX content loading
├── content/
│   └── blog/              .mdx files
├── public/
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### SEO (Day One)

- Static generation for all pages
- Meta tags, Open Graph, Twitter cards per page
- Auto-generated sitemap.xml and robots.txt
- JSON-LD structured data for org and blog posts

---

## Waitlist & Email

**Collection:**
- Waitlist form component reused across pages (hero, footer, pricing)
- Single field: email address
- Next.js server action calls Resend API to add contact to audience
- Success state: "You're on the list. We'll keep you posted as we build."

**Data:**
- Resend audience as source of truth (no separate database)
- Tag contacts by source page for future segmentation

**Future capability (not automated yet):**
- "Building in public" update emails
- Feature announcements
- Early access invitations

---

## Agent-Driven Brand Exploration

Before building the site visually, we run a structured brand exploration using AI agent personas — mirroring the product's own concept.

### The Team

| Agent | Role | Perspective |
|---|---|---|
| **Mara** | Visual Designer (Minimalist) | Systems thinking, dark palettes, typography-driven, dev-tool precision. References: Linear, Vercel, Raycast |
| **Jules** | Visual Designer (Emotional) | Warmth, the "alive team" feeling, illustration-friendly, approachable to non-technical users. References: Notion, Loom, Pitch |
| **Priya** | Conversion Designer | Scroll psychology, CTA placement, waitlist optimization, landing page best practices |
| **Alex** | Product Manager | Synthesizer. Resolves tensions between the three designers. Keeps messaging focused on both audiences. Makes final recommendations |

### The Process

1. Each designer agent produces a brand concept — color palette, typography direction, visual tone, homepage layout philosophy, handling the technical/non-technical audience split
2. The PM agent reviews all three, identifies what works from each, proposes a synthesized direction
3. User picks the winner or asks for iterations
4. Winning direction becomes a brand guide used to build the actual site

### Output

Each agent writes a structured brief (concepts, references, rationale — not code). Run as parallel prompts with distinct system prompts per persona.

---

## What's NOT in Scope

- The `.dev` docs site (future repo)
- The `.app` account portal (future repo)
- The backend API/server (future repo)
- Payment/billing integration
- Agent marketplace pages (part of product, not marketing)
- Actual visual design (handled by brand exploration process above)
