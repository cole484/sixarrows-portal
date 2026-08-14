# Subcontractor Scheduling Agent

A working specification and status document. Written to be read cold by
someone who has not seen the conversations that produced it, including
another AI asked to help build it.

Last updated August 2026.

---

## 1. What this is

Six Arrows Construction is a custom home builder in Bowling Green, Kentucky.
Cost-plus contracts, roughly $700,000 to $3,000,000 per build, four to five
projects a year. Cole Borders is the founder and is the project manager on
every one of them. That is the constraint the whole system exists to relieve.

This tool is a project coordinator built in software. The goal is stated
plainly: **train it to do the things a project coordinator would do to line up
work for a job.** Not to advise, not to summarize, but to do the actual
preparation and chasing that currently only happens when Cole remembers.

It lives inside an existing client portal (`cole484/sixarrows-portal`) rather
than as a separate product, because the portal already holds the Notion,
Google Drive, Supabase and Gmail connections it needs.

---

## 2. The problem

The visible problem: **subcontractors commit verbally and then miss.** A two
day slip becomes a one week gap, because the next trade was booked around the
original date and now has to be re-fitted into a schedule that has moved.

The real problem is upstream of that. **Nobody notices that a task three weeks
out has no scope, no subcontractor and no cost until it is time to schedule
it and everyone is scrambling.** By then the options are bad ones. The work
that would have prevented it, filling in those fields while there was still
time, is exactly the work that gets postponed when the person doing it is also
running four job sites.

So the agent's first and most important job is not sending messages. It is
looking three weeks ahead and saying, specifically, what is not ready.

---

## 3. The three tiers

Built in order. Each tier is expected to be running on real jobs before the
next one starts.

### Tier 1: PREPARE

Read the Notion build sequence daily. Look at tasks entering the scheduling
window. For each one, check a readiness gate:

- Scope of work
- Completion standard
- Linked subcontractor
- A price the subcontractor actually gave us

If anything is missing, flag it to Cole with **what specifically is missing**
and **how many days out the task is**. If the gate passes, generate a
pre-filled work order and a draft outbound message.

**A human sends it.** No exceptions in tier 1.

**The work order is the primary document, not the quote request.** On most of
these jobs a price already exists: it arrived by email months ago and was saved
into the client's Drive folder. So before anything is sent, that folder is
searched for a quote from this subcontractor, and the work order goes out
pre-filled with the number they already gave. A quote request only goes out
when nobody has quoted the job. Sending one to a sub who quoted the work in
March is not automation, it is a system that does not know what the company
knows.

**Duration is not asked for and not gated on.** The window belongs to the
subcontractor: they know their crew and their backlog. The work order asks for
one and the returned commitment sets the Notion task's dates.

### Tier 2: SEND AND TRACK

Send the work order link. Watch for the submission to come back. Follow up on
silence.

### Tier 3: CLOSE THE LOOP

On submission, write the confirmed dates and payment schedule back to Notion,
set the task to Scheduled, file the signed PDF to Google Drive, and escalate
non-responders. At project completion, trigger the subcontractor report card.

---

## 4. Rules that are not up for reinterpretation

These came from Cole directly. They are constraints, not preferences, and a
contributor should treat changing one as requiring his explicit agreement.

### Channels

- **Text is primary.** Subs read a text within minutes. Work order links and
  24 hour nudges go by text.
- **Email is the record.** It delivers the document, carries plans and specs,
  and creates the paper trail.
- **Voice is escalation and accessibility only.** Exactly two uses: subs
  flagged "phone only" who will never fill out a form, and escalation after 48
  hours of silence across both text and email.

> "Never place an AI voice call as first contact. These are relationships I
> depend on and cannot easily replace. First contact is always text."

### Scope boundaries

- **No auto-send in tier 1.** A human approves every outbound message until
  the process is proven on real subs.
- **No payment processing.** The work order captures a payment schedule as
  data. It does not move money.
- **No procurement.** No vendor catalogs, no supplier integrations, no
  purchase orders, no shipment tracking. This is the category most likely to
  kill the project if it creeps in.
- **No report card automation** until tiers 1 through 3 are running.

### Standards

- **No em dashes anywhere.** Code, UI copy, outbound messages, documentation.
- **Brand:** `#2e2e2e` charcoal, `#757f69` sage, `#ebe9de` cream. Industry Bold
  for headings, Work Sans for body.
- **Outbound messages to subs must read as though Lindsey wrote them.** Direct,
  professional, no corporate padding.
- **Every status change is append-only.** Never overwrite. Write a new row with
  a timestamp and an actor.
- **Work orders are reachable by token link.** No subcontractor login, ever.

### Decisions made after the original brief

- **The pilot project is Johnson**, not Kandaswamy. Get everything right on one
  job, then apply it to others.
- **Compliance emails are the one deliberate exception to no-auto-send.** They
  come from Cole, not Lindsey, they send automatically, they include W9
  requests, and they follow up until the document arrives.
- **A compliance email names no project, no task and no date.** Cole's call. A
  certificate is a standing requirement for working with Six Arrows at all, not
  a condition attached to Thursday's rough-in, and the earlier version that
  named the task invited the reply "we can sort that out closer to the time".
  The email says what is needed, gives the address to list Six Arrows as
  additionally insured, and stops. The project and task are still recorded on
  the `compliance_requests` row, because that is how we know which job put the
  sub in the window.
- **Every interval in the follow-up ladder is business days**, and the sweep
  will not send on a weekend. An agent does not issue certificates on a
  Saturday, and a follow-up that arrives before anybody could have acted on the
  first one burns one of the three we are ever going to send.
- **Six Arrows must be listed as additionally insured** on every certificate.
  The address subs should use is: Six Arrows Construction, PO Box 10059,
  Bowling Green, KY 42102.
- **Johnson's job site address is 106 Reynolds Ln.**
- **Slack is deferred to the end.** Notifications go by email until the rest is
  working, then the Slack app gets added.
- **Existing quotes are found, not re-requested.** Cole: on a lot of these
  projects we have received quotes and they are in the customer's budget and
  billing spreadsheet or in their Google Drive. The Drive folder turned out to
  be the real source; see section 9 on why the spreadsheet is not.
- **Duration (days) is ignored.** The sub gives the window on the returned work
  order and the Notion task moves to match it.
- **Document reading is automated, not manual.** Cole was explicit: he does not
  want to open every certificate and type in an expiration date. When the
  system cannot read one, it asks a person; it does not hand the whole pile
  back.

---

## 5. Where things stand

### Working

**Notion schema, Johnson.** Hoops is the canonical schema and Johnson has been
brought up to it: 21 fields added, 4 dropped, 9 trades added, 18 tasks
retagged, 63 project relations linked. Johnson's readiness window went from
6 blocked and 0 ready to 4 blocked and 2 ready.

**Tier 1 readiness gate** (`netlify/functions/scheduling-gate.js`). Runs
weekdays at 12:00 UTC. Reports which tasks in the window are not ready and
exactly which field is missing. Never writes to Notion unless `apply=1` is
passed by hand.

**Work order generation** (`netlify/functions/notion-work-order.js`). Joins the
timeline task, the Trade Templates row and the subcontractor row into one
document, plus universal site standards.

**Work order submission** (`netlify/functions/submit-work-order.js`). Records a
subcontractor's committed dates to an append-only Supabase table and mirrors
them into Notion. Reads the page's properties first and sends only fields that
exist, because Notion rejects an entire update if one property name is unknown.

**Compliance email wording** (`netlify/functions/lib/compliance-email.js`).
Approved by Cole. Escalation is bounded: initial request, follow up at 3 days,
again at 7, then stop and hand it to a person at 10 days or 2 days before the
work starts, whichever comes first.

**Gmail sending** (`netlify/functions/lib/gmail.js`). OAuth2 refresh token flow,
threads follow-ups onto the original message. Setup walkthrough in
`docs/gmail-setup.md`.

**Document reading infrastructure** (`lib/doc-ai.js`, `lib/doc-cache.js`,
`lib/compliance-docs.js`). Three layers, cheapest first: a cached result, a
local PDF text pass, then Claude. Reads are cached per file and modification
time, so a daily run costs nothing until a document changes.

### Partly working

**The compliance sweep** (`netlify/functions/compliance-sweep.js`). Matches
Drive files to Notion subcontractor rows, reads certificates, writes the truth
back to Notion, and emails subs whose documents are missing or expired ahead of
scheduled work. Runs daily at 13:00 UTC. It works end to end, but see section 9.

**The AI document reader.** All the plumbing is built and tested against mocks.
It has not yet successfully read a single real certificate, because every
attempt so far has hit an empty Anthropic API credit balance. Whether it reads
Six Arrows' actual documents accurately is genuinely unknown.

### Not started

- Tier 2 in full: token links, outbound texts in Lindsey's voice, follow-up on
  silence
- Tier 3: writeback of payment schedules, filing signed PDFs to Drive,
  escalation of non-responders
- The report card
- The Quote Request document. This matters more than its position in this list
  suggests: **nothing on Johnson is actually quoted.** The billing sheet shows
  "Need Estimate" on all ~90 lines, and the Bid Tracker has 38 rows with
  contractors named but every bid field blank. Every task is "To Be Quoted", so
  a quote request, not a work order, is the document most Johnson tasks
  actually need first.
- The Slack app

---

## 6. How it is put together

### Stack

- **Frontend:** static HTML and JS in `portal/`, no framework
- **Backend:** Netlify Functions, ES modules, Node 22, esbuild bundler
- **Database:** Supabase Postgres, accessed over its REST API with the anon key
- **Sources of record:** Notion (schedule, subcontractors, trade templates),
  Google Drive (compliance documents), Google Sheets (budget and billing)
- **Deploy:** push to `main`, Netlify builds automatically
- **Live at:** `https://sparkly-baklava-bb8c92.netlify.app/`

Two hard platform limits shape most of the design:

1. A synchronous function answers an HTTP request in **tens of seconds**.
   Anything that opens documents one at a time will exceed it.
2. A function whose filename ends in `-background` gets **fifteen minutes**,
   but returns 202 immediately and cannot return a result to the caller.

### Functions in this feature

| File | What it does |
|---|---|
| `scheduling-gate.js` | Tier 1. Readiness gate over the lookahead window. Cron weekdays 12:00 UTC. |
| `notion-work-order.js` | Builds a work order from task + trade template + sub. |
| `submit-work-order.js` | Records a sub's committed dates, mirrors to Notion. |
| `compliance-sweep.js` | Matches, reads, writes back, emails. Cron daily 13:00 UTC. |
| `read-compliance-docs-background.js` | Fills the read cache in bulk. No writes, no email, no decisions. |
| `lib/doc-ai.js` | Reads one COI or W9 with Claude. Per-run budget. |
| `lib/doc-cache.js` | Append-only cache of document reads. |
| `lib/compliance-docs.js` | Drive listing, name matching, the three-layer read. |
| `lib/compliance-email.js` | The approved outbound wording and escalation schedule. |
| `lib/gmail.js` | OAuth2 send, returns a thread id so follow-ups thread. |
| `lib/slack.js` | Written, not wired up. Deferred by decision. |
| `lib/trade-aliases.js` | Maps timeline trade names to Trade Template titles. |

### Endpoints and their switches

`compliance-sweep`:

| Parameter | Effect |
|---|---|
| (none) | Report only. Sends nothing. |
| `?send=1` | Actually send the due emails. |
| `?test=1` | One sample email to Cole. Nothing to any subcontractor. |
| `?syncOnly=1` | Refresh Notion from Drive, skip all email logic. |
| `?sub=artisan` | Narrow the **work**, not just the printout. |
| `?diag=1` | Per file: never opened, opened and failed, or read cleanly. Opens nothing. |
| `?aiLimit=N` | How many documents this run may open with Claude. Default 6. `0` means cached answers only. |
| `?rematch=1` | Open unmatched files and match on the name printed inside. |
| `?force=1` | Ignore cached reads. |
| `?maxWrites=20` | Ceiling on Notion writebacks per run. |
| `?budgetMs=18000` | Return a partial report rather than being killed. |
| `?days=45` | Lookahead window for scheduled work. |

`scheduling-gate`:

| Parameter | Effect |
|---|---|
| `?dryRun=1` | Report only. This is the default. |
| `?apply=1` | Also set Status to "Needs Info" on blocked tasks. |
| `?dbId=<id>` | Run against one timeline database. |
| `?days=60` | Lookahead window. |
| `?format=text` | Plain text digest instead of JSON. |

`read-compliance-docs-background`: `?limit=200`, `?kind=coi|w9`, `?force=1`.

### Supabase tables

All three are **append-only**, enforced at the database rather than by
convention: with row level security on, an operation with no policy is denied,
so having only insert and select policies makes update and delete impossible.

| Table | Migration | Holds |
|---|---|---|
| `work_order_commitments` | `add-work-order-commitments.sql` | What a sub committed to, and when |
| `compliance_requests` | `add-compliance-requests.sql` | Every compliance email sent, with its thread id |
| `document_reads` | `add-document-reads.sql` | What the reader saw in each document |

Migrations are individual SQL files run by hand in the Supabase SQL editor.
There is no migration tool. `add-document-reads.sql` ends with a schema reload
and a verification query, because a migration that cannot report whether it
worked costs a full round trip to find out.

---

## 7. The Notion data model

### Databases

- **Trade Templates** (`be4cee0b-6334-492b-a2d4-e6eeb2ec5edc`), workspace-wide.
  Default scope and completion standards per trade.
- **Subcontractors** (`1944737b-ea6f-8086-8f45-f6b479ed36bb`), workspace-wide.
  Name, contact, email, status, Insurance on File, COI Expiration, W9 on File.
- **Per-project timeline databases.** Johnson is
  `437bb594-ae27-437b-9014-48c5e6739e8c`.

**A trap worth naming.** Notion exposes two different ids per database: a data
source or collection id (what the MCP tooling and `collection://` URLs hand
you) and a database id (what the REST API wants). Passing the wrong one returns
404 with a message about sharing the database with your integration, which
sends you hunting for a permissions problem that does not exist. Every id in
this codebase is a database id.

The other genuine sharing requirement: each new per-project database must be
added to the portal's Notion integration through the database's `···` →
Connections menu, or the API returns empty results.

### Two trade vocabularies

Timelines say "Excavation" and "Trim". Trade Templates say "Excavation &
Footings" and "Trim & Molding Work". An exact-title lookup silently returns no
template, which looks like a missing template rather than a naming mismatch.
`lib/trade-aliases.js` bridges them, and names the four trades that genuinely
have no template (Windows/Doors, Surveying, Cleaning, Other) rather than
failing quietly on them.

Hoops is the reference implementation and uses the Trade Templates vocabulary
natively. Johnson and Kandaswamy drifted from it.

### The readiness gate, precisely

Recomputed in code rather than read from Notion's "Ready to Schedule" formula,
for two reasons: the formula is not readable through the query API on these
databases, and the digest has to say *which field* is missing rather than just
pass or fail.

**Out of scope:** Completed, On Hold. "Scheduled" is deliberately **not**
excluded, because a task marked Scheduled is claiming a sub has committed, and
that claim is worth checking. Johnson had a Scheduled task with no
subcontractor assigned at all.

**Blockers** mean a work order cannot be produced:

- no Trade set
- no Definition of done
- no Start date
- no Subcontractor assigned
- no Estimated Cost **and** no quote on file for that sub on that project
- the sub's certificate is missing, expired at the task's start date, or does
  not name Six Arrows as additionally insured on general liability

**Flags** mean a work order can be produced, but sending it as-is would be a
mistake:

- `quote_on_file`: a current quote exists in the client's Drive folder. Put the
  number on the task and send a work order, not a quote request.
- `quote_partial`: the quote's total does not cover the whole job. The carve-outs
  are listed so the work order can say so, because otherwise they arrive later
  as a change order and the sub is right.
- `quote_stale`: a quote exists and has passed its own expiration. That calls
  for a text asking whether the price still holds, not a fresh quote request.
- `quote_unread`: a document is on file and has not been opened yet.
- `quote_mismatch`: Notion says Bid Received and the quote on file says a
  different number. The document is the record.
- `needs_quote`: no quote anywhere, or a number with Cost Source other than
  "Bid Received" and nothing in the folder backing it up
- lead time versus start date
- the sub has no Insurance on File
- the sub's COI expires before the task starts
- the sub is marked Do Not Use or Inactive
- `status_inconsistent`: the task claims to be Scheduled, In Progress or
  Awaiting Confirmation while still failing the gate. The status is lying and
  that is worth saying out loud.

**Reminder trades** (currently just Material Ordering) are reminders to Six
Arrows rather than work sent to a sub, so they skip the sub, duration, cost and
provenance checks.

---

## 8. Design invariants

Each of these was learned by getting it wrong first. They are the parts most
likely to be broken by a well-meaning change.

**Four COI states, not three.** `missing`, `unreadable`, `expired`, `ok`.
`unreadable` means Six Arrows holds a certificate and could not read it, and it
**never** emails the subcontractor. Telling a sub who sent a certificate that
we do not have one is the single most damaging thing this system could say.

**The controlling expiry is the earliest of general liability and workers
comp**, not the latest date on the page. Auto and umbrella are ignored. Taking
the latest date can mark a lapsed certificate as live, which is the dangerous
direction to be wrong in.

**A failure that was not about the document is never cached.** Out of credit,
rate limited, overloaded, bad key, dropped connection, run budget spent: all
facts about the moment, not about the file. Caching one turns a readable
certificate permanently unreadable, and nobody would know to look again after
the real problem was fixed. This happened: 64 certificates were recorded as
unreadable because the API account ran out of credit. The check now also
matches the reason recorded on existing rows, so poisoned rows heal themselves.

**The read cache is loaded once per run, never per document.** A lookup per
file meant seventy-odd sequential round trips before the sweep could start,
which killed the endpoint outright.

**`?sub=` narrows the work, not the printout.** No document outside the filter
is opened, no Notion row outside it is written, and nobody outside it is
emailed. It used to narrow only what got rendered, so checking one sub quietly
read documents for the other seventy, and would have emailed them all.

**Bulk reading belongs in a background function.** The sweep answers an HTTP
request and has seconds. `aiLimit` above about six will time out.

**Everything degrades to a partial report, never to silence.** Both loops watch
a deadline and return what they have with `truncated` set. Cole cannot see
server logs, so an endpoint that dies quietly is close to undebuggable from
where he sits.

**Nothing that fails may fail invisibly.** The cache used to swallow its own
errors into a log nobody reads, which produced four rounds of debugging the
wrong thing. Errors that block the system are reported at the top level of the
response, in words, naming the fix.

**A new email variant needs Cole's approval before it sends.** A certificate
that is current but does not name Six Arrows as additionally insured is
reported as `review`, not emailed, for exactly this reason.

**A low confidence read never triggers an email.** Subs with upcoming work get
the full AI read, so low confidence means the reader had to squint at the date.
Telling a sub their certificate lapsed on a date nobody is sure of is the wrong
way to be wrong.

---

## 9. Known problems and open decisions

**The client budget spreadsheet is not a quote source, and treating it as one
would be worse than useless.** Cole's instruction was to search the customer's
budget and billing spreadsheet as well as their Drive. The Johnson Budget tab
does have the right shape for it, with Contractor / Vendor, Status and Cost
columns per line. But every one of its 59 rows reads Status "Need Estimate",
and its numbers are the estimator's, transcribed from
`johnson_estimate_draft5_homeowner.xlsx`, not the subs'. Where a quote also
exists in Drive the two disagree, sometimes badly:

| Line | Budget sheet | Actual quote |
| --- | --- | --- |
| Garage Doors | $5,281.88 | $8,451.00 (Overhead Door, 5-11) |
| Gutters & Downspouts | $1,875.00 | $1,897.50 (Chaffin, 3-09) |
| Plumbing | $12,050.00 | $10,800.00 (Goodnight's, 5-12) plus water and sewer per foot |

The document is what a sub will invoice against; the sheet is what somebody
hoped it would cost. So the sheet is deliberately **not** read as a price
source. The one thing worth taking from it is the Contractor / Vendor column,
which names the intended vendor on lines where Notion has no Subcontractor
linked. That is not built.

**Every quote currently on file for Johnson has expired or gone stale.** Eleven
of the fourteen have passed their own stated validity window, several by
months. This was invisible before, and it is the single most useful thing the
quote reader surfaced: the prices the schedule is built on are not prices
anybody is still standing behind. Confirming them is a round of texts, not a
round of quote requests.

**Fifty of Johnson's 59 tasks have no Subcontractor linked.** Nothing else in
tier 1 can run on a task without one: no insurance check, no quote lookup, no
work order. This is the largest single blocker to tier 1 being useful across
the whole job rather than the next few tasks.

**Seven quotes match no subcontractor.** Sun Windows, Watson Metals, Mayhew
Brothers, Madisonville Garage Doors and SRS Building are prices Six Arrows
holds from vendors who have no row in the Subcontractors database. The matcher
is behaving correctly; the database is incomplete.

**The API credit balance is empty.** This is an account matter, not a code one.
The Anthropic API is billed separately from a Claude subscription, at
console.anthropic.com. Until it is topped up, every AI read fails. Reading all
98 documents once costs on the order of a couple of dollars.

**Five HEIC files cannot be read at all.** The API does not accept the format
and iPhones produce it by default. They need re-saving as PDF or JPEG by hand.
If HEIC keeps arriving, a converter is worth building; for five files it is
not.

**Thirty files are unmatched to any subcontractor.** The `rematch=1` path
exists to fix this by reading the name printed inside each document, but it has
not run successfully yet. The alternative is renaming the files by hand, which
is roughly twenty minutes of work and permanently removes a category of
guessing. Either is defensible.

**One subcontractor row has no name**, only an email address
(`ohernandez0823@icloud.com`).

**Johnson's Budget Link is unset** on the SAB Customers Tracker.

**Model choice is not settled.** The reader defaults to `claude-opus-5`,
overridable with `COI_READER_MODEL`. Reading a standard ACORD form probably
does not need the most capable model, but accuracy on an insurance certificate
is worth more than the model costs, so stepping down should follow evidence
rather than precede it.

**Testing requires a human in the loop.** The development environment's network
policy blocks outbound requests to the live site, so every test is run by Cole
in a browser and pasted back. This has been the single largest source of slow
diagnosis. Allowing that one host would remove it.

---

## 10. Environment variables

Required:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `NOTION_TOKEN`
- `GOOGLE_API_KEY`
- `COI_FOLDER_ID`, `W9_FOLDER_ID`. Both Drive folders must be shared as
  "anyone with the link", because this authenticates with a plain API key.
- `ANTHROPIC_API_KEY`. Without it the sweep still runs, but scanned and
  photographed certificates come back `unreadable` instead of being read.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

Optional:

- `COI_READER_MODEL`, defaults to `claude-opus-5`

---

## 11. Where help would actually be useful

In rough order of value:

1. **The Quote Request document.** Every Johnson task is "To Be Quoted".
   Without this, the work order flow has almost nothing to operate on. This is
   the highest-value unbuilt thing.
2. **Tier 2:** token links, outbound text in Lindsey's voice, follow-up on
   silence. The rules in section 4 are the specification.
3. **Verifying the reader against real certificates** and deciding whether a
   cheaper model holds up.
4. **Deciding the unmatched-files question** and closing it out either way.
5. **The subcontractor report card**, which is deliberately last and should
   stay last.

What would not be useful: anything that adds procurement, vendor catalogs,
supplier integrations or payment movement. Those are out of scope by decision,
not by omission.
