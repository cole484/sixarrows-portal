# Six Arrows Client Experience System
## Master Architecture & Build Spec

*Planning file for the Code build. Living document. Last updated: this session.*

**First live deployment:** Johnson, Howard, Nagornay
**Deadline:** ~1 month (field-ready, not feature-complete)
**Keeper of the running backlog (final section):** Claude

---

## 0. Design philosophy

One idea runs through everything: **align the customer's expectations with reality.** Stress in a build comes from the gap between what the client pictures and what's actually happening. Every system below exists to close that gap — either by setting the expectation correctly up front, or by moving reality and the expectation back into alignment the moment they drift.

Three operating principles fall out of that:

1. **Push, don't pull.** A bad experience is one where the client has to ask. The answer should arrive before the question forms. Every recurring system has a *trigger* that fires on its own, not when someone remembers.
2. **One source of truth.** The client looks in one place — the portal. Internally, the schedule lives in one place — Notion. Money in one place, photos in one place, each flowing to the portal.
3. **Owner per system.** A system without a name attached decays. Every system below names who runs it.

### The three layers

- **Experiential layer (what the client feels):** Predictability · Trust · Mastery on Display · Feeling in Control. These are the goal.
- **Operational layer (what we do to produce the feeling):** the eight systems below + the work order engine.
- **Measurement layer (how we know it's working):** milestone NPS + four-pillar scorecard, mid-build pulse, post-build interview.

---

## 1. The eight client-facing systems

Status key: **Built** (deployed/working) · **Partial** (exists, incomplete) · **Designed** (specced, not built) · **Greenfield** (barely exists)

---

### System 1 — Onboarding / Expectation-Setting
**Pillar:** Predictability, Trust · **Owner:** Eric runs · Lindsey schedules & assembles kit · Cole owns the standard
**Status: Partial** — Client Roadmap and Eric's kickoff talk track drafted this session; Build Ready Kit exists as printed book.
**Job:** Transfer our mental model of the build into the client's head before dirt moves. Test: weeks 1–4 status-panic questions stay quiet.
**MVP (must hold for all 3):** Roadmap finalized + printed · talk track rehearsed · acknowledgment step live · kickoff delivered before each ground-break.
**Full:** Acknowledgment captured in portal · kit assembly automated · roadmap moved to designed/branded format.

### System 2 — Communication Cadence *(the heartbeat — load-bearing)*
**Pillar:** Predictability, Trust, Feeling in Control · **Owner:** Eric produces & posts · Lindsey backstops
**Status: Partial** — portal has `updates` feed + approval workflow; weekly-update concept and 24-hr response SLA defined. Reliable recurring execution is the known weak point.
**Job:** A fixed rhythm of contact the client can count on, firing whether or not there's news.
**MVP:** Weekly update on a fixed day, posted to portal, *even on quiet weeks* · Eric = single named contact · response SLA stated at onboarding. **This is the #1 MVP system — a cadence that fires 60% of the time is worse than none, because it breaks the expectation onboarding just set.**
**Full:** Templated update generator · automated reminder-to-Eric trigger · decision calendar surfaced · mid-build pulse check.

### System 3 — Decision / Selections Management
**Pillar:** Feeling in Control · **Owner:** Ben (design) + Eric · Lindsey times it
**Status: Built (strong)** — Wave Selections App v10 embedded; `selections-app.html` + storage live; Design Book; six style profiles defined; Selections v2 / "Fox" guided experience designed.
**Job:** Sequence decisions to the build, surface with lead time, show cost + deadline, present curated not infinite.
**MVP:** Selections sequenced to build with deadlines visible · allowance under/over shown *before* commit (Wave already does much of this).
**Full:** Decision calendar (next 3 decisions + due dates) in portal · Fox guided selections · automated decision reminders.

### System 4 — Financial Transparency
**Pillar:** Predictability, Trust · **Owner:** Cole/bookkeeping produce · Eric explains · monthly review
**Status: Built (partial)** — portal `budget.html` + `budget_categories`/`change_orders` tables; Google Sheets sync (column-Z tag detection); Estimating Engine v8 sets the original budget.
**Job:** Make real cost-plus numbers legible instead of scary. Teach that a moving budget = visibility, not chaos.
**MVP:** Live budget-vs-actual in portal per project · allowances shown · change-order process explained at onboarding and documented/approved before any work · monthly money review scheduled.
**Full:** Auto change-order doc generation + approval status + auto budget update · 90-day cash-flow forecast · QuickBooks management-fee recognition fix.

### System 5 — Schedule / Milestone Visibility *(spine)*
**Pillar:** Predictability · **Owner:** Lindsey owns schedule · Eric communicates slips
**Status: Built (partial)** — Notion build-sequence schema + Lindsey's Scheduling Dashboard; CPM 57-task library across 9 phases; `timeline.html` + `milestones` table; 3 active projects already migrated.
**Job:** Show the client the milestones they care about (not 57 tasks), and proactively tell them when something slips *and why* — before they notice.
**MVP:** Client-facing milestone view in portal (big beats only) · **proactive slip-notification protocol** (it moves → client hears why, from us, first).
**Full:** Live Notion → portal milestone sync · sequencing validator · auto-push slip notifications.

### System 6 — Quality / Proof on Display
**Pillar:** Mastery on Display, Trust · **Owner:** Eric/site captures → portal
**Status: Built (partial)** — Google Drive photo system (admin pastes per-phase folder URLs, auto-populates client photos); `documents.html`; Surface Finish Schedule; Elevation Surface Tagger.
**Job:** Convert invisible craftsmanship into felt reassurance. The difference between *trust me* and *look.*
**MVP:** Progress photos per phase flowing to portal reliably · inspection pass-offs visible.
**Full:** Spec-adherence checklists · photo cadence tied to schedule triggers · per-task quality checklists.

### System 7 — Exception Handling
**Pillar:** Trust · **Owner:** Eric
**Status: Greenfield** — defined in principle ("you hear it from us first, with a plan"), not built.
**Job:** Every build has problems; CX is decided by how they're handled. A defined path: caught → owned → plan → client told.
**MVP:** A written protocol Eric runs — issue logged, owner assigned, plan formed, client informed proactively. Minimal but real.
**Full:** Issue log in portal · resolution tracking · lessons-learned database across projects.

### System 8 — Closeout / Warranty
**Pillar:** Mastery on Display, Trust · **Owner:** Eric runs walkthrough · Lindsey warranty intake
**Status: Designed** — punch-list concept, Design Book keepsake, warranty intake conceptual.
**Job:** The peak-end rule. The last impression is weighted far above its share of the timeline.
**MVP for the sprint: LOW priority.** None of the three projects reach closeout within the month. Build it before the first one finishes, not now.
**Full:** Punch list in portal · warranty ticketing · post-build NPS + 90-day interview.

---

## 2. The work order engine *(supply side of expectation accuracy)*

Not a client-facing system — the upstream engine that feeds Systems 4, 5, and 6 (budget, schedule, quality — the exact three operational outputs the client experiences). If this engine is reliable, the customer's expectations stay true automatically.

**Status: Partial.** Built: Sub Report Card — four categories (**schedule, cleanliness, budget, quality**), 70-point threshold, written-feedback + one-project probation + removal flow, scored by Cole/Eric within 2 weeks of completion, sent by Lindsey, subs told up front. SOW library partial (57-task three-voice scope descriptions). Bid-package generation conceptual.

**The alignment to protect:** the four report-card categories *are* the customer's lived experience — schedule → predictability, budget → no surprises, quality + clean site → mastery on display. Keep them locked together.

**The critical gap — the commitment + reconfirmation loop:**
The report card grades *after* the work. It's the accountability **backstop.** What protects the customer's live schedule is *prevention*: a **hard commit** captured when the task is assigned, **site-readiness gating** (don't summon a sub to a site that isn't ready), and an **automated reconfirmation** a few days before each start date. This front-end is what stops the no-show that turns the portal schedule into a lie. **This is the highest-value new build in the whole engine.**

**MVP:** Work order issued per task with scope + explicit on-time / on-budget / quality expectations · hard commit captured · reconfirmation before start · report card scored at completion. Very doable across 3 projects.
**Full:** Auto-generated bid packages · reliability records surfaced at sub-selection · reconfirmation cadence automated · site-readiness gate wired to schedule.

---

## 3. Integration architecture — the single source of truth

| Layer | System | Owns | Flows to |
|---|---|---|---|
| Client pane of glass | **Portal** (Netlify / Supabase) | money, schedule, photos, decisions, updates, docs | the client |
| Internal ops engine | **Notion** | build sequence, scheduling dashboard, work order workflow, SOW library, ops manual | portal |
| Budget source | **Google Sheets** | budget-vs-actual (column-Z tags) | portal budget |
| Photo source | **Google Drive** | per-phase build photos | portal documents/photos |
| Database | **Supabase** | clients, selections, updates, budget_categories, change_orders, milestones, documents | portal |

**The connective tissue that's missing (where "pieces" becomes "system"):**
- Notion schedule → portal milestone **auto-sync** (today the milestone view is largely manual).
- Work order commitments → schedule confidence (the reconfirmation loop above).
- **The recurring-execution triggers** that fire on their own: weekly-update reminder, slip notification, reconfirmation cadence. *These are the load-bearing, least-glamorous builds. Protect them from being deprioritized in favor of polishing the portal or the estimating engine.*

---

## 4. The one-month MVP — gated to Johnson / Howard / Nagornay

Field-ready = Eric and Lindsey run it every day without Cole pushing. Smaller and more boring than the full vision, on purpose.

**The spine (must be live before ground-break):**
1. **System 1 — Onboarding:** roadmap printed, talk track rehearsed, kickoff delivered, acknowledgment captured.
2. **System 2 — Weekly cadence:** fixed-day update to portal + Eric as single contact + SLA. *The make-or-break.*
3. **System 5 — Milestone visibility:** client milestone view + slip-notification protocol.
4. **Work order engine:** scope + hard commit + reconfirmation + report card per task.
5. **System 4 — Financial basics:** live budget-vs-actual + allowances + change-order discipline + monthly review.

**Light for the sprint (fires later in these builds):**
- System 6 — get the photo flow reliable; that's enough for early phases.
- System 3 — Wave already strong; just sequence deadlines.
- System 7 — a one-page written protocol is enough for month one.
- System 8 — **defer.** Build before the first project finishes.
- Measurement — stand up the first milestone NPS + monthly CX review; the rest sequences in.

**What forces the scope:** the actual ground-break date of each project. Onboarding/cadence/schedule must be live first; quality/closeout can lag. *Need: ground-break date per project.*

---

## 5. RUNNING BACKLOG *(Claude owns this — every new idea lands here)*

Status: ✅ Built · 🔨 In MVP scope · 📋 Backlog (full build) · 💡 Idea / parking lot

### System 1 — Onboarding
- ✅ Client Roadmap draft
- ✅ Eric kickoff talk track draft
- 🔨 Finalize + print roadmap; rehearse talk track; live acknowledgment step
- 📋 Acknowledgment captured in portal
- 📋 Automated kit assembly
- 💡 Decide: is the Build Ready Kit the same object as the Roadmap, or two pieces?
- 💡 Move roadmap to designed/branded format once content locked

### System 2 — Communication cadence
- ✅ Portal updates feed + approval workflow
- 🔨 Fixed-day weekly update, posts even on quiet weeks
- 🔨 Eric as single named contact + stated response SLA
- 📋 Templated weekly-update generator
- 📋 Automated reminder-to-Eric trigger
- 📋 Mid-build pulse check (by someone other than the PM)

### System 3 — Selections / decisions
- ✅ Wave Selections App v10 (embedded)
- ✅ Design Book + six style profiles
- 🔨 Selections sequenced to build with visible deadlines + allowance under/over before commit
- 📋 Decision calendar (next 3 decisions + due dates) in portal
- 📋 Fox AI guided selections (v2)

### System 4 — Financial transparency
- ✅ Portal budget-vs-actual + Sheets sync
- 🔨 Allowances visible · change-order discipline · monthly money review scheduled
- 📋 Auto change-order doc + approval status + budget update
- 📋 90-day cash-flow forecast
- 📋 QuickBooks management-fee recognition fix

### System 5 — Schedule / milestones
- ✅ Notion build-sequence schema + Scheduling Dashboard + CPM 57-task library
- 🔨 Client milestone view (big beats) · proactive slip-notification protocol
- 📋 Live Notion → portal milestone auto-sync
- 📋 Sequencing validator
- 📋 Auto-push slip notifications

### System 6 — Quality / proof
- ✅ Google Drive per-phase photo system
- 🔨 Reliable photo flow per phase · inspection pass-offs visible
- 📋 Spec-adherence checklists · photo cadence on schedule triggers · per-task quality checklists

### System 7 — Exception handling
- 🔨 One-page written protocol (caught → owned → plan → client told)
- 📋 Issue log in portal + resolution tracking
- 📋 Lessons-learned database across projects

### System 8 — Closeout / warranty *(deferred for sprint)*
- 📋 Structured walkthrough + closing punch list
- 📋 Warranty intake + ticketing
- 📋 Punch list in portal
- 📋 Post-build NPS + 90-day interview

### Work order engine
- ✅ Sub Report Card (schedule / cleanliness / budget / quality, 70-threshold, probation flow)
- 🔨 Work order w/ scope + on-time/budget/quality expectations
- 🔨 **Hard commit capture + reconfirmation before start** ← highest-value new build
- 📋 Site-readiness gating wired to schedule
- 📋 Auto bid-package generation
- 📋 Reliability records surfaced at sub-selection
- 📋 Automated reconfirmation cadence

### Integration / source of truth
- ✅ Portal (Netlify/Supabase) as client pane of glass
- ✅ Notion ops engine · Sheets budget · Drive photos
- 📋 Notion → portal milestone auto-sync
- 📋 Recurring-execution trigger layer (weekly update / slip / reconfirm)

### Measurement / feedback
- ✅ SAB Completion Survey draft
- ✅ Milestone NPS + four-pillar scorecard designed
- 🔨 First milestone NPS live + monthly CX review cadence
- 📋 Mid-build pulse · post-build 90-day interview

### Parking lot 💡
- Public-facing statement once 6+ months of sub-score data exists ("every Six Arrows sub maintains a minimum performance score…") — differentiator for Blueprint materials/website
- (new ideas land here as they come up)
