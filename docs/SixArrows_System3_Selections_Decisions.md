# Selections & Decision Management System
### System 3 — The cognitive-load manager

*Internal operating system. Primary pillar: Feeling in Control. Owner: Ben (design lead) + Eric; Lindsey times it.*

> **Note:** Six Arrows already runs the Selections App (curated, guided choosing with cost attached) plus the Design Book and six style profiles. This spec builds on that. The new muscle is in two layers the app doesn't fully cover: the **sequencing backbone** (every decision tied to a deadline driven by the build) and the **decision-calendar pacing layer** (the client faces what's next, not everything at once).

---

## The principle

Selections is the part of the build the client *drives* — every other system informs them about a process happening to their house; this is the process they author. That makes it the system most tied to **Feeling in Control**, and also the one most able to overwhelm.

Here's the key truth: **selection stress isn't caused by the number of decisions. It's caused by decisions arriving the wrong way.** Three failure modes, and the system is built to defeat each:

1. **Too late** → rushed, pressured choices, or a schedule slip.
2. **All at once** → paralysis. Dumping the whole universe of decisions at kickoff freezes people.
3. **No framework** → the open ocean. "Here's the entire catalog, pick something" produces decision fatigue and regret.

The opposite of those three *is* the system: **sequenced, paced, and curated** — with cost attached at the moment of choice. Do that and the most empowering part of the build stays empowering instead of becoming the most stressful.

---

## The four components

### 1. The selection schedule — sequencing to the build *(the backbone)*
Every selection decision is mapped to three things:
- the **build task/phase** it feeds,
- its **lead time** (order-to-install),
- and therefore its **decision deadline** = install date − lead time − buffer.

This is the piece the app doesn't generate on its own, and it's the foundation. A selection isn't "due when we get to it" — it's due far enough ahead that the ordered item *arrives* in time. A 10-week-lead item has to be decided 10+ weeks before its install. The deadlines fall out of the CPM schedule (System 5) crossed with material lead times.

### 2. The decision calendar — pacing *(the cognitive-load manager)*
The client-facing view shows **what's next, not everything** — the next handful of decisions with their deadlines, surfaced with real lead time. Not the 200-item master list; just "here's what's on deck for the next few weeks." This single move — drip instead of dump — is what prevents paralysis. It lives in the portal, and the upcoming deadlines also ride the weekly update (System 2, section 4: "anything from you").

### 3. Curated presentation — the framework for choosing
This is what the Selections App, Design Book, and six style profiles already do well: each decision arrives as a **guided, narrowed set aligned to the client's style**, not an open catalog. This is the design-authority position made tangible — Six Arrows isn't a catalog, it's a guide that pre-curates a confident shortlist. (Fox / guided v2 deepens this later.) The principle: shrink the choice space to "great options that fit *your* home," which removes both fatigue and second-guessing.

### 4. Cost at the moment of choice — allowance-before-commit
The fusion with System 4. Every option shows its price and its effect on the allowance **before the client commits** — *"this tile is $6/sf over allowance: +$1,800."* The client chooses with full information. This is the mechanic that converts the single biggest source of end-of-build financial shock into a series of small, owned, in-control decisions. (The app largely does this; keep it locked to the live budget.)

---

## Lock-in → the rest of the build

Once a selection is made, it's **recorded, locked, and flows two directions:**
- to the **work order / finish schedule** (System 6), so the sub installs exactly what was chosen — and the locked finish schedule is what prevents the "I thought we picked X" dispute later;
- to the **budget** (System 4), reconciling the allowance.

A clear "decided" state matters. And any change *after* lock becomes a **change order** (documented, priced, approved before work) — not a quiet swap. That keeps selections honest with both the schedule and the budget.

---

## The deadline is two-way accountability

The Roadmap asks the client to keep their decisions ahead of the build. The decision calendar + Ben's proactive guidance are how Six Arrows holds up *its* end — giving the client genuine lead time and a curated path. That symmetry matters: when Six Arrows reliably surfaces a decision with weeks of runway, a missed deadline is clearly the client's tradeoff to own, and the resulting delay gets communicated as *their* choice — not as a Six Arrows failure. This protects the schedule expectation and keeps slip-attribution honest (the most common client-caused delay is the late decision).

---

## Connections

- **System 5 (Schedule):** deadlines derive from the build schedule + lead times; a missed selection deadline is a slip.
- **System 4 (Financial):** allowance-before-commit; over-allowance choices reconcile to budget; post-lock changes = change orders.
- **System 2 (Cadence):** upcoming decisions surface in the weekly update.
- **System 6 (Quality/Proof):** the locked finish schedule confirms what was selected and prevents disputes.
- **North star:** selections is expectation alignment for the *finishes* — the client's mental picture of their home gets locked to reality, decision by decision, with cost known, heading off "this isn't what I pictured" at the end.

---

## Ownership

| Role | Responsibility |
|---|---|
| **Ben (design)** | Curates the options; guides each decision; owns the style fit |
| **Lindsey** | Builds the selection schedule from the build + lead times; maintains the decision calendar; times the asks |
| **Eric** | Connects selections to budget & schedule; handles post-lock changes as change orders |
| **Client** | Decides ahead of deadlines, with allowance status in view |

---

## MVP for Johnson / Howard / Nagornay

- [ ] Selection schedule built per project — each decision mapped to its task, lead time, and deadline
- [ ] Decision calendar surfaced to the client (even a simple "next 3 decisions + dates"), echoed in the weekly update
- [ ] Selections App delivering curated, style-aligned options with **allowance status before commit**
- [ ] Ben proactively guiding each decision with real lead time
- [ ] Locked selections flow to the finish schedule (sub installs the right thing) and reconcile to budget
- [ ] Post-lock changes routed through the change-order process

**Full build (backlog):** decision calendar auto-generated from the schedule + lead times in the portal · Fox AI guided selections (v2) · automated deadline reminders · a material lead-time database per category.

---

*The client isn't shopping — they're authoring their home. Sequence it, pace it, curate it, and price it in the moment, and they finish feeling like a confident author instead of an exhausted shopper.*
