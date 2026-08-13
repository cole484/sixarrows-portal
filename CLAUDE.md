# Six Arrows Construction — Client Portal

Custom client portal for a small home builder. SAB™ (Six Arrows Blueprint) is
the pre-construction phase; once construction starts, clients flip from `sab`
to `construction` status and the portal swaps modes (different tracker, live
budget feed, Notion-driven timeline, AI updates).

## Stack

- **Frontend:** static HTML/JS in `portal/`, no framework. Each page is a
  standalone HTML file that loads `app.js` (auth + sidebar/topbar layout) and
  optionally `data.js` (legacy in-memory PROJECTS object — fallback only).
  Pages mount via `mountLayout(activeKey, pageLabel, contentHtml, TS)`.
- **Backend:** Netlify functions in `netlify/functions/*.js` (ES modules).
  Auth uses `SUPABASE_ANON_KEY`; the function set deliberately stays small.
- **Database:** Supabase Postgres. Schema in `supabase/schema.sql`. Migrations
  are individual SQL files (`supabase/add-*.sql`) the user runs by hand in
  the Supabase SQL editor — there is no migration tool.
- **Deploy:** auto from `main` to Netlify. Live at
  `https://sparkly-baklava-bb8c92.netlify.app/`.

## Top-level layout

```
admin.html                  # legacy redirect — real admin lives in portal/
data.js                     # legacy — same caveat
portal/
  app.js                    # AUTH, layout, sidebar, topbar, mobile nav
  data.js                   # in-memory PROJECTS seed (fallback when Supabase fails)
  dashboard.html            # client Command Center (HOME)
  tracker.html              # SAB tracker (Phase steps + Notion sync for remodel)
  budget.html               # SAB category status OR live billing feed
  timeline.html             # Notion-driven schedule (construction phase)
  selections.html           # entry to selections-app.html
  selections-app.html       # Wave 1/2/3 selections form (the big one)
  documents.html, photos.html, updates.html, decisions.html
  share.html                # post-build review collection
  design-book.html          # auto-generated style book from selections
  visual-selections.html    # staff pin editor over floor plans / elevations
  lib/parse-selections.js   # canonical derivation of discrete selection
                            #   records from the Wave Selections blob
  roadmap.html              # vendor-appointment checklist (read by admin too)
  guide-admin.html          # in-app admin docs (sticky TOC, mobile FAB)
  guide-client.html         # in-app client docs
  admin.html                # the admin SPA — every other page hangs off this
netlify/functions/
  client-auth.js            # email/password login → session cookie
  selections-storage.js     # Supabase-backed read/write for selections suffixes
                            #   ans = answers, sav = saved categories,
                            #   rms = rooms, fpu = fireplace units,
                            #   pfx = plumbing fixture selection,
                            #   ltx = lighting type selection,
                            #   spc = specialty trim selection,
                            #   rdm_state = roadmap progress,
                            #   rdm_vendors = per-client vendor overrides,
                            #   dbi = design book image overrides (in progress)
  notion-tracker.js         # remodel-mode dynamic tracker pulled from Notion
  notion-timeline.js        # construction-mode timeline → Command Center card
  notion-clients.js         # batch client metadata sync from a Notion clients DB
  generate-updates.js       # LEGACY Claude-authored drafts. Kept for reference,
                            #   cron disabled — replaced by notion-weekly-update.
  notion-weekly-update.js   # PRIMARY weekly update generator (Version C).
                            #   Deterministic — no LLM, no invention. Pulls
                            #   from per-client Notion timeline DB, buckets
                            #   per spec §4, formats per §6, drops draft into
                            #   updates table with approved=false. Cron: Sun
                            #   11 UTC (~6am CT). Also exposes GET manual
                            #   trigger + dryRun preview for the admin UI.
  notion-updates.js         # related; reads recent Notion task changes
  sheet-budget-sync.js      # construction-phase live billing feed from Google Sheets
  sheet-sab-budget-sync.js  # SAB-phase budget category import from sheets
  sheet-billing-sync.js     # construction-phase billing detail
  drive-photos.js           # build photos pulled from Drive folders
  roadmap-vendors.js        # vendor defaults + per-client overrides + stop settings
  product-meta.js           # design book auto image fetch (OG/JSON-LD + Microlink fallback)
  selections-export.js      # CSV export of every selection
  selection-items-sync.js   # projects the selections blob into
                            #   selection_items rows so pins can FK to them
  visual-selections.js      # plans + pins CRUD, signed storage uploads
  plan-convert-background.js # PDF to PNG on upload (mupdf wasm, 15 min budget)
  debug-sheet.js            # one-off sheet diagnostic
  scheduling-gate.js        # Tier 1 of the sub scheduling agent. Looks ahead at
                            #   tasks entering the window, checks the readiness
                            #   gate, notifies. Cron: weekdays 12 UTC. Never
                            #   writes to Notion unless apply=1 is passed.
  compliance-sweep.js       # matches Drive COI/W9 files to Notion sub rows,
                            #   reads each certificate, refreshes Notion, and
                            #   emails subs whose documents are missing or
                            #   expired ahead of scheduled work. Cron: daily
                            #   13 UTC. Manual runs send nothing without send=1.
  lib/doc-ai.js             # reads a COI or W9 with Claude: expiry, insured
                            #   name, and whether Six Arrows is actually listed
                            #   as additionally insured. Per-run read budget.
  lib/doc-cache.js          # append-only cache of document reads, keyed on
                            #   Drive file id + modifiedTime
  lib/compliance-docs.js    # Drive listing, name matching, and the three-layer
                            #   read: cache, then PDF text, then Claude
  lib/compliance-email.js   # the approved wording for compliance emails
  lib/gmail.js              # OAuth2 refresh-token send, returns threadId
  lib/slack.js              # digest delivery (not wired up yet)
  lib/trade-aliases.js      # timeline trade names to Trade Template titles
supabase/
  schema.sql                # baseline tables
  add-*.sql                 # individual migrations, run in order in Supabase SQL editor
```

## Conventions worth knowing

1. **Supabase is the source of truth for admin.** `loadAllClientsFromSupabase`
   in `portal/admin.html` builds the in-memory `PROJECTS` map from the
   `clients` table on every admin login. It now prunes anything in
   `data.js` that isn't in Supabase, so a delete sticks.
2. **Saves are await-and-show-real-error.** `saveProjectInfo` waits for the
   Supabase upsert and surfaces the actual error message (no silent green
   checkmark). Every other admin save path should follow this pattern.
3. **Adding a column to `clients` requires both a migration AND wiring up
   `loadAllClientsFromSupabase` to map it.** A column that exists in
   Supabase but isn't read in the loader means it'll never make it into
   the form on the next page load — looks like a save bug but it isn't.
4. **Selections storage is keyed by `client_id` + `suffix`** in the
   `selections` table. New "areas" of selections data get a new suffix
   rather than a new table.
4b. **Wave Selections has no per-selection row.** Everything lives in
   one jsonb blob per client under suffix `ans`, as a flat map of form
   field ids. There is no selection entity, no uuid, no cost field, no
   vendor field, and no approval state beyond `sav`, which is just a
   per-category "saved" boolean. Anything that needs to reference an
   individual selection has to go through `selection_items` (see below).
4c. **Visual Selections is a projection, not a second system.**
   `selection-items-sync.js` re-derives items from the blob and upserts
   them into `selection_items` matched on `item_key`, so each selection
   gets a stable uuid for `pins.selection_item_id` to point at. Field
   ownership is the rule that keeps it honest: category, wave, room,
   label, product, image_url and detail are owned by the blob and
   refreshed on every sync; vendor, cost, product_link and notes are
   owned by the pin UI and are never written by the sync. Keys are built
   from ids that do not change (category + room id + fixture id), never
   from display labels, because a renamed room would otherwise orphan
   every pin under it. Items that vanish from the blob are archived, not
   deleted, so existing pins still resolve.
5. **Notion integrations must be shared per-database.** When a new client's
   Notion tracker or timeline DB is created, it has to be added to the
   portal's integration via the database's `···` → Connections menu, or
   the Notion API returns 404/empty. The `notion-timeline` function now
   surfaces a clear message when it detects this.
6. **Cron schedule lives in `netlify.toml`.** Currently:
   - **Sun 11 UTC (~6am CT)** — `notion-weekly-update` drops a draft for
     every active construction client, keyed off T = next Monday.
   - Legacy Mon/Fri crons for `generate-updates` are commented out.
7. **Weekly updates are deterministic and Notion-driven.** No LLM in the
   default path. `notion-weekly-update.js` reads each client's timeline
   DB, buckets tasks (recently completed / this week / in progress /
   coming up / decisions / potential blockers), pulls a Mon–Fri weather
   forecast (Open-Meteo, free, no key), and formats sections per the
   spec, omitting empty ones. Drafts land in the `updates` table with
   `approved=false`. Field names vary per client — the per-project
   field map is at the top of the function file. To onboard a new
   construction client for weekly updates: (a) set their Notion
   timeline DB ID in admin Project Info, (b) share the DB with the
   Six Arrows Notion integration, (c) optionally add their address to
   the Projects Notion DB (`222b7d0a-...`) so the weather line
   populates — else it falls back to the first task's Job Site Location.

## Common commands

```bash
# Add a node syntax check before committing function changes —
# Netlify will return 502 on every call if a function fails to parse.
node --check netlify/functions/<file>.js

# Deploy = git push to main
git push origin main

# Direct fetch to verify a function (replace YOUR_DOMAIN)
curl 'https://YOUR_DOMAIN/.netlify/functions/<fn>?<args>'
```

## Environment variables (Netlify)

Required for core function:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — every function uses these
- `GOOGLE_API_KEY` — sheet-budget-sync, sheet-billing-sync, sheet-sab-budget-sync
- `NOTION_TOKEN` — notion-tracker, notion-timeline, notion-clients,
  notion-updates, generate-updates
- `ANTHROPIC_API_KEY` — generate-updates, and the compliance document reader
  (`lib/doc-ai.js`). Without it the sweep still runs, but scanned and
  photographed certificates come back `unreadable` instead of being read.
  `COI_READER_MODEL` overrides the model; it defaults to `claude-opus-5`.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` — outbound
  compliance email. Setup walkthrough is in `docs/gmail-setup.md`.
- `COI_FOLDER_ID`, `W9_FOLDER_ID` — the two Drive folders, which must be
  shared as "anyone with the link" because these authenticate with an API key.

Optional, for product-meta image fetching cascade:
- `MICROLINK_API_KEY` — Microlink Pro for antibot retailer bypass.
  Without it, Microlink uses ~50/day shared anonymous tier, which doesn't
  bypass antibot (so Lowe's, Home Depot etc. still fail). Free tier signup
  works for friendly sites.
- `BRAVE_SEARCH_API_KEY` — required to enable image-search fallback
  for plain-text products with no URL. Brave's "free tier" is actually
  a $5/month free credit on their Search plan ($5 per 1k requests), so
  effectively ~1,000 free requests/month. Signup requires a credit
  card (anti-fraud measure — not charged unless you exceed credits).
  Sign up at brave.com/search/api. Without this set, plain-text
  products always render as placeholders (no fallback).

## Recent / in-flight work (May 2026)

- **Design Book image auto-fetch** — `product-meta.js` reads OG/JSON-LD,
  falls back to Microlink for blocked retailers. Free tier doesn't cover
  Lowe's/Home Depot antibot. Manual image override (per-client `dbi`
  suffix) is the next add.
- **Selections Roadmap** — vendor checklist with per-client vendor
  overrides AND admin-editable touch level + "why this matters" text.
  Tables: `roadmap_vendor_defaults`, `roadmap_stop_settings`.
- **HVAC selections** — added as Wave 1 category alongside Fireplace,
  Appliances, Exterior Finishes.
- **Auto-updates** (in flight, separate session) — Cole is iterating on
  `generate-updates.js` voice/tone and the cron + manual-trigger UX.
  See the systemPrompt in that file for the current voice rules.

- **Visual Selections phase 1** (shipped): staff pin editor at
  `portal/visual-selections.html`, reachable from the admin sidebar.
  Upload a plan or elevation, drop pins, duplicate pins for repeated
  fixtures, cluster on overlap, filter by category and wave. Pin
  coordinates are percentages of plan width and height, never pixels.
  One pin per physical fixture, no quantity field. Migration:
  `supabase/add-visual-selections.sql`.
  Deliberately out of scope, and the thing most likely to kill the
  project if it creeps in: vendor catalogs, automatic product lookup,
  purchase orders, procurement, shipment tracking, supplier
  integrations. Staff type the item and paste a screenshot.
  Phases 2 to 4 (client read-only view, approval in place with threaded
  comments, guided wave walkthrough and room mood boards) are not built.

## Subcontractor scheduling agent

The full specification, current status, design invariants and open decisions
live in `docs/subcontractor-scheduling-agent.md`. Read that before changing
anything in `scheduling-gate.js`, `compliance-sweep.js`, the work order
functions, or `lib/doc-*.js`. It is written to be read cold and covers the
channel rules and scope boundaries that are Cole's decisions rather than
implementation choices.

## Subcontractor compliance documents

Certificates arrive as clean PDFs, scans, phone photos, and re-prints from
whatever template the agency uses. Reading is three layers deep, cheapest
first:

1. **Cache** (`document_reads`, keyed on Drive file id + `modifiedTime`).
   Replacing a file in Drive changes the modification time and misses the
   cache, so a fresh read happens on its own. Nothing to invalidate by hand.
2. **PDF text pass** (`unpdf` + a date-pair heuristic). Free and instant.
   Works on a PDF with a real text layer, fails on everything else.
3. **Claude** (`lib/doc-ai.js`). Opens the document the way a person would.
   Also answers the one question the other layers cannot: whether Six Arrows
   is listed as **additionally insured** or is merely the certificate holder.
   Those look identical in extracted text and mean very different things.

Rules that matter:

- **Four COI states, not three.** `missing` / `unreadable` / `expired` / `ok`.
  `unreadable` means we hold a certificate and could not read it, and it
  **never** emails the sub. Telling a sub who sent a certificate that we do
  not have one is the most damaging thing this system could say.
- **The controlling expiry is the earliest of general liability and workers
  comp**, not the latest date on the page. Auto and umbrella are ignored.
- **`?aiLimit=N`** caps how many documents one run may open with Claude
  (default 6). `0` means read nothing new at all: no downloads, no parsing,
  cached answers only.
- **A failure that was not about the document is never cached.** Out of
  credit, rate limited, overloaded, bad key, dropped connection, budget spent:
  all facts about the moment, not the file. Caching one turns a readable
  certificate permanently unreadable, and nobody would know to look again
  after the real problem was fixed. `errorLooksTransient()` also matches the
  reason recorded on existing rows, so any already written that way heal
  themselves rather than needing to be found and cleared by hand.
- **`?rematch=1`** opens files that no filename matched and matches them on
  the name printed inside instead. That is what fixes the unmatched pile.
- **`?sub=` narrows the work, not the printout.** No document outside the
  filter is opened, no Notion row outside it is written, and nobody outside
  it is emailed. It used to narrow only what got rendered, so checking one
  sub quietly read documents for the other seventy.
- **The read cache is loaded once per run, never per document.** A lookup per
  file meant seventy-odd sequential round trips before the sweep could start,
  which killed the endpoint outright. `loadCacheIndex()` is one query;
  `opts.cache` carries it into every read.
- **Notion writebacks are capped per run** (`?maxWrites=20`) and the sweep
  gives up gracefully on a deadline (`?budgetMs=18000`), returning a partial
  report with `truncated` set. A partial answer tells you what is happening;
  a dead connection tells you nothing.
- **A backlog is drained by `read-compliance-docs-background.js`, not by the
  sweep.** The sweep answers an HTTP request and has seconds; `aiLimit` above
  about six will time out. The background function has minutes and only
  fills the read cache: no Notion writes, no email, no decisions.
- A **new email variant needs Cole's approval** before it sends. A certificate
  that is current but does not name Six Arrows as additionally insured is
  reported as `review`, not emailed, for exactly that reason.

## When in doubt

- **Bug isn't sticking across browsers / fields disappear on refresh** →
  check the column is mapped in `loadAllClientsFromSupabase`. Or check
  the Supabase upsert payload for unknown columns.
- **Function returns 502** → `node --check` the file. ES2020 doesn't
  allow mixing `&&` with `??` in the same expression without explicit
  parens around each grouping.
- **Notion query returns "no tasks found"** → the database isn't shared
  with the Six Arrows portal Notion integration. Owner has to add it
  via the database's `···` → Connections menu.
- **Selections client key vs project ID** → most things use `p.id`,
  but selections persistence uses `p.selectionsClientKey || p.id`. They
  are usually the same string. `selection-items-sync.js` resolves this
  explicitly: it reads the blob by `selections_client_key` and writes
  `selection_items.client_id` as `clients.id`.
- **Pins show up detached, or a category has no pinnable items** → run
  a resync from the Visual Selections top bar. If items are still
  missing, the parser in `portal/lib/parse-selections.js` does not know
  that answer key yet. Lighting and plumbing are driven from the `ltx`
  and `pfx` suffixes rather than a guessed fixture list, so a new
  fixture type needs adding to the arrays at the top of that file.
