# Work Order & Sub Commitment System
### The supply side of customer expectation accuracy

*Internal operating system. Sits upstream of Systems 4, 5, and 6 (budget, schedule, quality).*

---

## Why this system exists

The customer holds three expectations in their head: **when** their home progresses, **what** it costs, and **how good** the work is. Their experience is great when reality matches that picture. But you don't keep those promises — your subs do. The milestone date in the client's portal is only as true as the subcontractor's commitment behind it.

So a work order is not paperwork. **It's the moment a customer-facing promise becomes a sub-facing commitment.** This system's entire job is to make that conversion reliable, so the schedule the customer reads stays true.

The alignment is already built into how you grade: your report card scores subs on **schedule, cleanliness, budget, quality** — which is exactly what the customer experiences (schedule → predictability, budget → no surprises, quality + a clean site → mastery on display). Keep those locked together. This system adds the missing front half: the report card grades *after* the work (the accountability **backstop**); this adds the *before* (the **prevention** loop that stops the no-show in the first place).

---

## Setting expectations with the sub — the three dimensions

Every work order makes three expectations explicit and non-negotiable, in writing, before the sub ever sets foot on site. Vague expectations are broken expectations.

1. **Time** — exact start date, expected duration, hard completion target. Not "next week." A date.
2. **Budget** — the agreed amount / PO, and the rule that any deviation is flagged *before* the work, never after.
3. **Quality** — the acceptance criteria for *this* task, in plain language, plus the standing standard: leave the site clean.

A sub who receives all three, every time, in the same format, learns that Six Arrows is a professional operation that keeps score — which is exactly the reputation that gets you better pricing and first call on their calendar.

---

## The loop — lifecycle of a work order

This is the system. Five steps, each with a trigger and an owner.

### 1. ISSUE *(trigger: task becomes active on the schedule)*
A work order is generated from the scheduled task and sent to the sub. It carries: scope (pulled from the SOW library), the three expectation dimensions above, and the **site-readiness conditions** that must be true before they arrive (what predecessor work will be complete).
*Owner: Lindsey.*

### 2. HARD COMMIT *(trigger: work order issued)* ← **the missing piece**
The sub confirms **in writing** that they can perform at the stated date and price. No verbal "yeah, should be fine." A captured, dated, written yes. This single step is what converts a hoped-for schedule into a committed one — and it's the front-end your system doesn't have yet.
*Owner: Lindsey captures; no task is "scheduled" in reality until the hard commit exists.*

### 3. SITE-READINESS GATE *(trigger: ~3–5 days before start)*
Before the sub is summoned, confirm the site is actually ready for them — predecessors complete, access clear, materials staged. **Never call a sub to an unready site.** Doing so burns the relationship, wastes a trip, and unfairly tanks their report card for a delay that was yours. The gate protects both the schedule *and* the fairness of your scoring.
*Owner: Eric/site confirms readiness; Lindsey releases.*

### 4. RECONFIRM *(trigger: automated cadence before start — e.g. T-5 days and T-1 day)*
A reconfirmation goes to the sub ahead of the start date. They re-confirm, or they flag a problem. **If they flag, this is the early-warning system firing exactly as designed** — the schedule adjusts, and because we caught it days out, the customer hears about it proactively, from us, with a plan, before they ever notice. *(This is the handoff into System 5's slip-notification protocol.)*
*Owner: Lindsey sends; if a flag comes in, Eric owns the client communication.*

### 5. COMPLETE & SCORE *(trigger: task completion)*
The existing report card fires — schedule, cleanliness, budget, quality, scored within 2 weeks. The score feeds the sub's reliability record, which over time informs who gets called first on the next project.
*Owner: Cole/Eric score; Lindsey sends.*

---

## How this protects the customer (the chain)

> Hard commit + site-readiness gate + reconfirmation
> → the sub actually shows when the schedule says
> → the milestone dates in the portal stay true
> → **the customer's expectations match reality**
> → and on the rare miss, the reconfirm catches it early enough that the customer is told *before* they'd ever discover it.

That's the whole point. A reliable sub-commitment loop is invisible to the customer — and that invisibility *is* the great experience. They never feel the schedule slip because it didn't, or because they heard about it first.

---

## The work order document — fields

What every work order contains:

- **Project / address** and **task name** (from the schedule)
- **Sub / trade**
- **Scope of work** — pulled from the SOW library; specific to this task, no scope gaps
- **Start date · expected duration · completion target**
- **Agreed amount / PO #** — and the flag-before-you-deviate rule stated on the order
- **Quality / acceptance criteria** — what "done right" means for this task
- **Site-readiness conditions** — what will be true when you arrive
- **Clean-site expectation** — standing requirement, scored
- **Hard-commit confirmation** — date + method captured here
- **Reconfirmation log** — T-5 / T-1 confirmations recorded

---

## Reconfirmation message templates

**T-5 days:**
> *"Confirming you're set for [Trade] at [Address] starting [Date]. Scope and PO are in your work order. The site will be ready: [predecessor] complete, access clear. Reply to confirm, or flag now if anything's changed on your end — the earlier we know, the easier it is for everyone."*

**T-1 day:**
> *"You're on for [Address] tomorrow, [Date]. Site's confirmed ready. See you there."*

**On a flag (internal trigger):**
> Sub flags → Lindsey adjusts schedule → **Eric notifies the client proactively** with the new date and the why → portal milestone updated. Never let a sub flag sit without the client hearing it from us.

*Note the language: every message restates the expectation (date, scope, readiness) and rewards early flagging. You're training reliability, not just confirming attendance.*

---

## Ownership summary

| Step | Owner |
|---|---|
| Issue work order | Lindsey |
| Capture hard commit | Lindsey |
| Confirm site readiness | Eric (site) → Lindsey releases |
| Reconfirmation cadence | Lindsey (Eric owns client comms on a flag) |
| Score report card | Cole / Eric |
| Policy & standard | Cole |

---

## MVP for Johnson / Howard / Nagornay

Do not wait for automation. The manual version works on day one:

- [ ] Work order document standardized with all fields above
- [ ] Hard-commit capture (written confirmation, even if it's a saved text/email) on every issued order
- [ ] Site-readiness check built into Lindsey + Eric's routine before any sub is released
- [ ] Reconfirmation at T-5 and T-1 (manual sends are fine to start)
- [ ] Flag → client-notification handoff wired to Eric
- [ ] Report card continues as-is at completion

**Full build (backlog):** automated reconfirmation cadence · site-readiness gate wired to the schedule · reliability records surfaced at sub-selection · auto-generated bid packages from plans/specs.

---

*This is the engine room. The customer never sees it — and that's exactly why it works. A schedule kept is a schedule the customer never has to worry about.*
