# Six Arrows — Client Experience System Brief

> Repo: `cole484/sixarrows-portal`. This file lives in `/docs` and is imported into the repo-root `CLAUDE.md` via `@docs/CX_SYSTEM_BRIEF.md`, so Code loads it every session alongside the existing portal instructions. High-signal by design; the detail lives in the other files in `/docs`.

## Project overview
- This repo is the **Six Arrows client portal** (Netlify + Supabase) — the client's single pane of glass for a custom home build.
- We are building it into the delivery surface for an **8-system client experience architecture**. Full design is spec'd in `/docs`.
- **Goal:** make the CX system **field-ready for three pilot builds — Johnson, Howard, Nagornay — within ~1 month.** Field-ready = Eric & Lindsey run it daily without Cole pushing. NOT feature-complete.
- Cole is the owner/systems architect: he designs frameworks and delegates execution. Give him plans and gap analyses to approve, not surprises.

## ⚑ Start here — research before you build (required, every new work session)
Before writing any code:
1. **Read every spec in `/docs`** (master architecture + the individual system specs).
2. **Audit the existing codebase** — portal pages, Supabase schema/tables, Netlify functions, the Wave Selections App — and inventory what's actually built vs. what the specs call for.
3. **Note the non-code assets** that live outside this repo: the Notion schedule engine, the sub report-card workflow, the Google Drive photo flow, the Google Sheets budget. Reach Notion via its connector if available; otherwise work from the specs.
4. **Produce a gap analysis + proposed build order** — map each system's MVP items to what exists, flag the integration points, propose a sequence. **Show it to Cole before building anything.**

Why: the architecture's core finding is that most remaining work is **wiring and connecting what already exists**, not net-new building. A discovery pass that maps existing → specs is the highest-leverage first move, and it prevents rebuilding things that are already done.

## Source-of-truth rule
- `/docs` specs = source of truth for **design intent** (what to build and why).
- The codebase = source of truth for **current state** (what exists).
- When they conflict, **surface it to Cole** — don't silently follow one over the other.

## The architecture in brief (detail in /docs)
Philosophy: **align the client's expectations with reality · push not pull · one source of truth · an owner per system.**
Experiential pillars: Predictability · Trust · Mastery on Display · Feeling in Control.

The eight systems:
1. **Onboarding / expectation-setting** — Roadmap + kickoff talk track
2. **Communication cadence** — the weekly heartbeat (load-bearing)
3. **Selections / decisions** — sequenced, paced, curated (Wave app)
4. **Financial transparency** — cost-plus made legible
5. **Schedule / milestone visibility** — + proactive slip-notification
6. **Quality / proof on display**
7. **Exception handling** — three-tier triage
8. **Closeout / warranty** — deferred for the sprint

Plus the **work order engine** (sub commitment loop — the supply side of expectation accuracy) and the **measurement layer** (leading vs. lagging indicators).

## Existing assets / integration map
- **Portal (this repo):** pages incl. dashboard, budget, timeline, selections, selections-app, documents, updates, admin. Supabase tables incl. clients, selections, updates, budget_categories, change_orders, milestones, documents. Netlify functions for Notion sync, auth, selections, updates, admin CRUD. *(Verify exact names during the audit — this is from memory, not authoritative.)*
- **Wave Selections App** — embedded; curated selections + allowance-at-choice.
- **Notion** — build-sequence schema, scheduling dashboard, work order + report-card workflow, CPM 57-task library. (Non-code; reach via connector or specs.)
- **Google Drive** — per-phase photo system feeding the portal.
- **Google Sheets** — budget-vs-actual source (column-Z tag sync).

## The known gaps — likely the actual build focus
- **Notion → portal milestone auto-sync** (today largely manual).
- **The recurring-execution trigger layer** — weekly-update reminder, proactive slip notification, work-order reconfirmation cadence. These must fire on their own, not on someone's memory. This is the highest-value new automation and the least glamorous — do not deprioritize it in favor of polishing the impressive pieces.

## MVP scope (this sprint)
Spine, live before first ground-break: **Onboarding · Weekly cadence · Milestone visibility · Work order engine · Financial basics.**
Deferred: Closeout (System 8) — no pilot reaches it within the month.
Start dates for the three pilots are forthcoming; the trigger/integration work is **date-independent** — proceed on it.

## Locked decisions
- Cost surprise **> $1,000** → Tier 3 (direct contact before related work proceeds). Below it → flows to the live budget + weekly update.
- Significant schedule slip = **> 1 week, or any move-in change** → Tier 3 direct; smaller slips ride the weekly update.
- The client **Roadmap** is a chapter inside the **Build Ready Kit** (one artifact).

## Working rules
- **Don't break the deployed portal.** It's live for real clients — treat production with care.
- **Ask before:** Supabase schema changes, destructive operations, new external dependencies, or changes to client-facing single-source-of-truth behavior.
- **MVP-vs-full discipline:** build the boring, reliable version first. A reliable simple thing beats an impressive fragile one.
- **Match existing patterns** — extend the repo's conventions rather than introducing new ones without reason.
- Keep the client's single pane of glass coherent: money, schedule, photos, decisions, and updates in one place.

## Team / roles
- **Cole** — owner, systems architect.
- **Eric Salmons** — construction exec, primary client contact, functional CX owner.
- **Lindsey Turley** — scheduling & coordination.
- **Ben Holton** — design lead (selections).
