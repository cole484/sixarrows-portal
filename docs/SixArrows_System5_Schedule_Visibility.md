# Schedule & Milestone Visibility System
### System 5 — Time certainty

*Internal operating system. Primary pillar: Predictability. Owner: Lindsey owns the schedule; Eric communicates slips.*

---

## The principle

Clients can absorb a delay. What they cannot absorb is **discovering it themselves.** A move-in date that slips two weeks, revealed by Eric a month out with a reason, is competence. The same slip discovered by the client on a Saturday site visit is a betrayal. The entire value of this system is **lead time** — catching a schedule change early enough that the client always hears it from us, with the why, before they could ever notice.

Two components: what the client *sees* (the milestone view), and what happens when it *moves* (the slip-notification protocol). The second is the centerpiece.

---

## Part 1 — The client milestone view

### Show milestones, not tasks
Internally, the schedule is the 57-task CPM across 9 phases — Lindsey's domain. **The client never sees that.** Raw task detail invites anxiety: every time a two-day task shuffles, an untrained eye reads "delay." The client sees the **milestone layer above it** — roughly ten big beats that map exactly to the phases you taught them in onboarding.

The milestone set (mirrors the Roadmap journey, so onboarding → portal → weekly update all speak the same language):

1. Site work & foundation
2. Framing
3. Dry-in (roof, windows, exterior)
4. Rough-ins complete (mechanical, electrical, plumbing)
5. Insulation & drywall
6. Interior finishes (trim, cabinets)
7. Surfaces (paint, flooring, tile, counters)
8. Fixtures & final systems
9. Punch list
10. Completion / move-in

### "You are here"
The current milestone shows prominently. The single most reassuring thing a client can see is *where they are* in a process they understand. Past = done, current = in progress, future = upcoming with target dates.

### Date precision scales with distance — *important*
Don't show false precision on far-out dates. A specific day attached to milestone 8 while you're in milestone 2 is a broken promise waiting to happen.

- **Far out** (several milestones away): show a **month or a range** — "Surfaces: late Q3."
- **Approaching** (next 1–2 milestones): tighten to a **specific window or date.**

This is how you stay *predictable without being wrong.* A range you hit builds more trust than a precise date you miss.

---

## Part 2 — The slip-notification protocol *(the centerpiece)*

### The filter: not every slip is client-facing
The CPM has float. A task slipping *within its slack* doesn't move a client milestone — Lindsey absorbs it internally, the client never needs to know. The protocol fires **only when a client-visible milestone date actually moves, or is forecast to.** Same triage logic as the exception system: internal jiggle = absorbed; milestone move = communicated.

### The routing: minor vs. significant
When a milestone *does* move, it routes by impact — this is the exact boundary between the cadence system and the exception system:

**Minor slip → rides the weekly update (System 2, section 3).**
A few days, no downstream ripple, doesn't touch a date the client is emotionally anchored on.
> *"Windows pushed three days by the supplier; we've adjusted and dry-in moves from the 12th to the 15th. No downstream impact."*

**Significant slip → Tier 3 direct contact (System 7), promptly.**
Material time, a downstream ripple to later milestones, or it touches a date the client anchored on — **especially completion / move-in.** Do not wait for Friday.
> Triggers for "significant": moves **completion/move-in** at all (automatically significant) · pushes any milestone **more than 1 week** · creates a downstream ripple · lands on a date the client told us matters.

### The craft of a slip notification
Whatever the channel, five elements — same DNA as exception communication:

1. **What** moved — plainly.
2. **Why** — the reason is everything. "Backordered by the supplier" is absorbable; a naked "it's delayed" reads as incompetence.
3. **The new date** — or the date by which you'll have the new date.
4. **Downstream impact** — what it does (or doesn't do) to later milestones, explicitly. "No downstream impact" is one of the most reassuring sentences you can write.
5. **What we're doing** about it.

### Keep the portal in lockstep — *never show a date you know is wrong*
The moment a milestone moves, **Lindsey updates the portal milestone view** — in the same beat as the notification, never after. The client must never see a stale date in the portal that contradicts what Eric just told them, and must never discover a slip *because* the portal quietly changed. Update and notify together. Single source of truth only works if it's true.

---

## Lead time is manufactured upstream

This is the through-line worth seeing: the slip protocol is only as good as the lead time feeding it, and that lead time is *manufactured* by the work order reconfirm loop.

> Work order **T-5 reconfirm** catches a sub problem
> → before it becomes a visible slip
> → which gives Eric days of lead time
> → to notify the client *ahead* of the change
> → and the portal updates in lockstep.

Systems 5, 2, 7, and the work order loop are one connected **schedule-trust machine:** reconfirm catches it early → triage routes it (minor vs. significant) → cadence or direct call delivers it → portal stays true. None of them works alone.

---

## Ownership

| Role | Responsibility |
|---|---|
| **Lindsey** | Owns the schedule; manages internal float; identifies when a milestone actually moves; updates the portal view in lockstep |
| **Eric** | Communicates slips to the client (single voice); owns the direct call on significant slips |
| **Cole** | Sets the "significant" threshold; reviews on-time-milestone % and proactive-vs-discovered rate monthly |

---

## The metric

Two numbers feed Cole's monthly review:
- **On-time milestone hit rate** — how often milestones land in their stated window.
- **Proactive-vs-discovered rate** — what share of slips the client heard from us *first.* The target is 100%. A single "discovered" slip is the early warning that this client's trust is eroding, long before a survey would catch it.

---

## MVP for Johnson / Howard / Nagornay

- [ ] The ~10 client milestones defined per project, mapped to the Roadmap phases
- [ ] Milestone view shown in the portal (manual updates fine to start)
- [ ] Date-precision-by-distance applied (ranges far out, specifics near term)
- [ ] Slip protocol understood: float absorbed internally; milestone moves communicated
- [ ] Minor-vs-significant routing agreed: **>1 week or any move-in change = significant** (Tier 3 direct)
- [ ] Lockstep rule locked: portal updates the moment a milestone moves, paired with the notification

**Full build (backlog):** live Notion → portal milestone auto-sync · forecast-based early warning (CPM flags a projected milestone move *before* it happens) · auto-push slip notifications · sequencing validator.

---

*Predictability isn't never slipping. It's that the client never finds out from anyone but you.*
