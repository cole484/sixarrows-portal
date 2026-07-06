# Financial Transparency System
### System 4 — Making cost-plus legible

*Internal operating system. Primary pillars: Predictability, Trust. Owner: Cole/bookkeeping produce the numbers; Eric explains; monthly review is the ritual.*

> **Note:** Six Arrows already runs a version of this — portal budget-vs-actual, the Google Sheets sync, a change-order table, the Estimating Engine baseline. This document is the *target spec*: lay your current system against it and adjust where it adds discipline. The new muscle is mostly in three places, flagged below: **allowance-before-commit**, the **change-order-before-work gate**, and the **monthly review ritual.**

---

## The principle

Cost-plus is the honest way to build, and it comes with a structural tension: **the client sees real costs.** Most homeowners on a fixed-price build never see what anything actually costs — they get one padded number. Yours don't have the padding, which means they watch real numbers move. That exposure is either your biggest trust-builder or your biggest anxiety generator, and which one it becomes is entirely a function of this system.

The core reframe, taught at onboarding and reinforced every month: **a moving budget is visibility, not chaos. Seeing costs move is the feature, not the problem.**

But here's the sharp point — **transparency without a frame is just exposure.** Showing a client raw, moving numbers with no context manufactures anxiety. The system's real job isn't to *show* the numbers (that's easy); it's to *frame* them so they're legible: a credible baseline, always-current actuals, costs shown before they commit, changes as a known mechanism, and a monthly ritual that turns numbers from strangers into familiar ground. **The frame is what converts "exposed" into "in control."**

---

## The five components

### 1. The baseline — a credible anchor
The original budget comes from the Estimating Engine (the SAB estimate). This is the number the client was sold on and measures everything against, so its credibility is foundational. The north-star metric for the whole operation lives here: **completed-build actuals within ±5% of the SAB estimate.** Every finished build's actuals should feed back to calibrate the engine — that loop is what makes the baseline trustworthy on the *next* client, which is what makes all of this work.

### 2. Live budget-vs-actual — always current, never a monthly surprise
The portal shows, per category: budgeted · actual · remaining. Fed continuously by the Sheets sync so the picture is **never stale.** The discipline that matters: actuals flow in *continuously*, not in a month-end dump. A client who looks on the 14th and sees current numbers trusts the system; a client who finds the budget hasn't updated in three weeks stops trusting all of it. The always-current state is the product.

### 3. Allowances — shown *before* the client commits *(the big one)*
Allowances are budgeted amounts for things the client selects later — flooring, fixtures, lighting, tile, counters. **The single biggest source of cost-plus shock is the allowance the client blew past without knowing.** The fix is a mechanic, not a conversation:

> When the client picks the $18/sf tile against a $12/sf allowance, they see the overage **in the moment of selecting**, before they commit — not at the end of the build.

This is where System 4 and System 3 (the Wave Selections App) fuse. Every selection surfaces its allowance status live: under, at, or over, by how much, and what it does to the total. The client chooses with eyes open. That single mechanic converts the #1 source of end-of-build betrayal into a series of small, owned, in-control decisions. **If you improve one thing in your current system, make it this.**

### 4. Change orders — a known mechanism, never a surprise
A change order happens when the client changes something after it's priced. The discipline, locked to the $1,000 exception rule:

**Documented → priced → approved by the client → *then* work proceeds.** Never the reverse.

Each change order carries: what, why, cost, schedule impact, and the client's recorded approval — and on approval it **updates the live budget** so the baseline-vs-current picture stays honest. The CX goal is that a change order *feels* like the known mechanism they were taught at kickoff, not a betrayal that arrived as an invoice. Status tracked: pending → approved → reflected in budget. (This is the change-order table you have — the spec just hard-gates "approval before work" and "auto-update the budget on approval.")

### 5. The monthly money review — the ritual
Once a month, Eric walks the budget *with* the client, live. This is the financial equivalent of the weekly heartbeat: a predictable rhythm that keeps the numbers from ever becoming a stranger. The agenda is fixed:

- Where we are vs. the baseline (and the ±5% frame)
- What moved this month, and why
- Allowance status across the open selections
- Any change orders, and where contingency stands
- What's financially ahead next month

A client who walks their budget every month never gets blindsided and never accumulates silent worry. **The review is where cost-plus trust is maintained** — same logic as the weekly update, applied to money.

---

## The structure made visible

The client should be able to see, plainly, how their money is organized:

- **Cost of construction** — actual costs, no markup on materials or subs.
- **Fixed management fee** — your fee, *fixed*, so it doesn't balloon with the budget. Worth making this explicit: as the cost of the home moves, your fee doesn't, which removes the suspicion that a builder benefits from overages. In cost-plus that reassurance is gold.
- **Contingency** — what it's for and how it draws down, explained up front so that *using* contingency reads as the plan working, not as an overage. (The engine's contingency + override architecture feeds this.)
- **Draws** — staged funding status if surfaced to the client: what's drawn, what's next.

---

## The integrity layer *(internal dependency)*

The client-facing budget is only as trustworthy as the bookkeeping beneath it. Two internal items support this system without being client-facing:

- **Management-fee recognition** — deposits split into cost portion vs. earned fee income, so the books reflect reality and the numbers shown to clients are sound. (Known QuickBooks correction — separate workstream, but this system depends on it.)
- **Continuous actuals entry** — the Sheets-to-portal sync only tells the truth if costs are entered promptly. The "always current" promise in Component 2 rests on this discipline.

---

## Connections

- **System 3 (Selections):** allowances surface in the selection moment — the fusion point.
- **System 7 (Exceptions):** any cost surprise over **$1,000** is Tier 3 — direct contact before related work proceeds.
- **System 2 (Cadence):** budget notes ride the weekly update (section 5); the monthly review is its own rhythm.
- **Estimating Engine:** sets the baseline; completed actuals feed the ±5% calibration loop.

---

## Ownership

| Role | Responsibility |
|---|---|
| **Cole / bookkeeping** | Produce and maintain accurate numbers; continuous actuals; fee recognition integrity |
| **Eric** | Explains the budget; runs the monthly review; communicates change orders & overages |
| **Client** | Approves change orders before work; makes selections with allowance status in view |
| **Cole** | Reviews the ±5% accuracy metric per completed build; owns the standard |

---

## MVP for Johnson / Howard / Nagornay

- [ ] Baseline loaded from the engine into each project's portal budget
- [ ] Live budget-vs-actual reliable per project (sync current, actuals entered continuously)
- [ ] **Allowance status visible at the moment of selection** — under/over before commit (the priority upgrade)
- [ ] Change-order discipline enforced: documented → priced → approved → *then* work; budget auto-updates on approval
- [ ] Monthly review scheduled and run, fixed agenda
- [ ] $1,000 cost-surprise rule wired to the exception system

**Full build (backlog):** auto change-order doc generation + approval status + auto budget update · contingency draw-down visualization · 90-day cash-flow forecast · engine calibration loop from completed actuals · QuickBooks management-fee recognition fix.

---

*In cost-plus, you can't hide the numbers — so the whole game is making them legible. A client who understands their budget feels in control. A client who's merely shown it feels exposed.*
