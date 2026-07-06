# Six Arrows — Client Experience System (Build Tracker)

> Canonical backlog for the CX system build. Paste into the Notion tracker page, or keep this as source of truth and mirror to Notion.

**First live deployment:** Johnson · Howard · Nagornay
**Deadline:** ~1 month — field-ready (Eric & Lindsey run it daily without Cole pushing), not feature-complete
**Status:** ✅ Design phase complete — all 8 systems + work order engine + measurement layer are spec'd. Now moving to implementation (field ops manual + Code build).

## The frame

Align the customer's expectations with reality. Every system either sets the expectation up front or pulls reality and expectation back together the moment they drift.

- **Experiential (what the client feels):** Predictability · Trust · Mastery on Display · Feeling in Control
- **Operational (what we do):** the 8 systems + the work order engine
- **Measurement (how we know):** milestone NPS + four-pillar scorecard, mid-build pulse, post-build interview

Principles: **push not pull** · **one source of truth** (portal for the client, Notion for the schedule) · **an owner per system.**

## Status key
✅ Built / live · 🔨 In MVP scope · ✏️ Spec drafted · 📋 Backlog (full build) · 💡 Idea / parking lot

## Locked decisions
- **Cost surprise → Tier 3 escalation: $1,000.** Below it, the variance still flows to the live portal budget + weekly update.
- **Significant schedule slip: >1 week, or any move-in change** (auto-significant).
- **Roadmap + Build Ready Kit: one object** — the Roadmap is the forward-looking chapter inside the Kit, handed over at kickoff.

## Two implementation tracks (next phase)
- **Field track (humans):** consolidate specs into one field operations manual + per-system readiness checklist. Works day one, no code.
- **Code track (automation):** Notion→portal milestone sync + recurring-execution triggers (weekly-update reminder, slip notifications, reconfirmation cadence). Handoff via repo `CLAUDE.md` + `/docs` specs + research-first mandate.

## MVP spine (live before first ground-break)
1. 🔨 Onboarding — Kit printed (Roadmap chapter), talk track rehearsed, kickoff delivered, acknowledgment captured
2. 🔨 Weekly cadence — fixed-day update even on quiet weeks + Eric single contact *(make-or-break)*
3. 🔨 Milestone visibility — client milestone view + proactive slip-notification protocol
4. 🔨 Work order engine — scope + hard commit + reconfirmation + report card
5. 🔨 Financial basics — live budget-vs-actual + allowances + change-order discipline + monthly review

*Deferred for sprint: Closeout (System 8).*

---

## Running backlog

### System 1 — Onboarding / Expectation-setting ✏️
*Eric runs · Lindsey schedules & assembles · Cole owns standard*
- ✅ Client Roadmap draft · Eric kickoff talk track draft
- ✅ **Decided:** Roadmap = chapter inside the Build Ready Kit (one bound book, handed over at kickoff)
- 🔨 Finalize + print the Kit · rehearse talk track · live acknowledgment step
- 📋 Acknowledgment captured in portal · automated kit assembly
- 💡 Move Kit to designed/branded format once content locked

### System 2 — Communication cadence (heartbeat) ✏️
*Eric produces & posts · Lindsey backstops*
- ✅ Portal updates feed + approval workflow
- 🔨 Fixed-day weekly update (posts even on quiet weeks) · Eric single contact + SLA
- 📋 Templated weekly-update generator (AI-assisted) · automated reminder trigger · mid-build pulse

### System 3 — Selections / decisions ✏️
*Ben (design) + Eric · Lindsey times it*
- ✅ Wave Selections App v10 (embedded) · Design Book + six style profiles
- 🔨 Selection schedule (deadline = install − lead time − buffer) · decision calendar (drip) · allowance-before-commit
- 📋 Decision calendar auto-generated in portal · Fox AI guided selections (v2) · lead-time database

### System 4 — Financial transparency ✏️
*Cole/bookkeeping produce · Eric explains · monthly review*
- ✅ Portal budget-vs-actual + Google Sheets sync
- 🔨 Allowance-before-commit (fuse with Wave) · change-order-before-work gate · monthly money review
- 📋 Auto change-order doc + budget update · contingency draw-down · cash-flow forecast · QB fee recognition · engine ±5% calibration

### System 5 — Schedule / milestones (spine) ✏️
*Lindsey owns schedule · Eric communicates slips*
- ✅ Notion build-sequence schema + Scheduling Dashboard + CPM 57-task library
- 🔨 Client milestone view (big beats, date-precision-by-distance) · proactive slip-notification protocol
- 📋 Live Notion → portal milestone auto-sync · forecast early warning · sequencing validator · auto-push slip notifications

### System 6 — Quality / proof on display ✏️
*Eric/site captures → portal*
- ✅ Google Drive per-phase photo system
- 🔨 Reliable photo flow · buried-work capture before close-up · inspection passes surfaced · clean-site as proof
- 📋 Spec-adherence checklists · photo cadence on schedule triggers · finish schedule surfaced
- 💡 Client-permissioned buried-work record as marketing proof (Blueprint differentiator)

### System 7 — Exception handling ✏️
*Eric*
- ✅ Three-tier triage (Absorb / Inform / Escalate) + response loop + scripts · $1,000 auto-Tier-3 locked
- 🔨 Protocol walked with Eric + Lindsey · simple issue log stood up
- 📋 Issue log in portal + resolution tracking · lessons-learned database

### System 8 — Closeout / warranty ✏️ *(deferred for sprint)*
*Eric runs walkthrough · Lindsey warranty intake*
- ✅ Peak-end spec: internal pre-walk · punch that closes · warranty intake + SLA · ceremony/keepsake (bookends the Kit)
- 📋 Punch list in portal · warranty ticketing · keepsake assembly · post-build NPS + 90-day interview

### Work order engine (supply side of expectation accuracy) ✏️
*Lindsey issues/reconfirms · Eric scores/holds standard · Cole sets policy*
- ✅ Sub Report Card (schedule / cleanliness / budget / quality, 70-threshold, probation flow)
- 🔨 Work order w/ scope + expectations · **hard commit capture + reconfirmation before start** (highest-value new build)
- 📋 Site-readiness gating · auto bid-package generation · reliability records at sub-selection · automated reconfirm cadence

### Measurement / feedback ✏️
*Lindsey distributes/tracks · Eric functional CX owner · Cole monthly review*
- ✅ Spec: leading vs lagging indicators · measure-on-cadence · measure→review→act loop
- ✅ SAB Completion Survey draft · milestone NPS + four-pillar scorecard designed
- 🔨 Leading indicators tracked (streak · proactive-vs-discovered slip · report-card scores · cost accuracy) · monthly CX review
- 📋 Automated dashboard · cross-project trend analysis · mid-build pulse (non-PM) · post-build 90-day interview

### Integration / source of truth
- ✅ Portal (Netlify/Supabase) · Notion ops engine · Sheets budget · Drive photos
- 📋 Notion → portal milestone auto-sync
- 📋 Recurring-execution trigger layer (weekly update / slip / reconfirm)

---

## Parking lot 💡
- Public statement once 6+ months of sub-score data exists ("every Six Arrows sub maintains a minimum performance score…") — Blueprint differentiator
- Client-permissioned buried-work documentation as marketing proof
- *(new ideas land here as they come up)*
