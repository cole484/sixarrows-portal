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
  generate-updates.js       # Claude-API drafted client updates (Mon/Fri cron + admin manual)
  notion-updates.js         # related; reads recent Notion task changes
  sheet-budget-sync.js      # construction-phase live billing feed from Google Sheets
  sheet-sab-budget-sync.js  # SAB-phase budget category import from sheets
  sheet-billing-sync.js     # construction-phase billing detail
  drive-photos.js           # build photos pulled from Drive folders
  roadmap-vendors.js        # vendor defaults + per-client overrides + stop settings
  product-meta.js           # design book auto image fetch (OG/JSON-LD + Microlink fallback)
  selections-export.js      # CSV export of every selection
  debug-sheet.js            # one-off sheet diagnostic
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
5. **Notion integrations must be shared per-database.** When a new client's
   Notion tracker or timeline DB is created, it has to be added to the
   portal's integration via the database's `···` → Connections menu, or
   the Notion API returns 404/empty. The `notion-timeline` function now
   surfaces a clear message when it detects this.
6. **Cron schedule lives in `netlify.toml`.** Currently:
   - Mon 5:00 AM CT (10:00 UTC) — `generate-updates` for week preview
   - Fri 1:00 PM CT (18:00 UTC) — `generate-updates` for weekly recap
   - Midweek update is admin-manual-trigger only.
7. **Voice/tone for client updates** is hardcoded in
   `netlify/functions/generate-updates.js` — see the `systemPrompt` and
   `typeInstructions` objects. Calls Claude (`claude-sonnet-4-5`).
   Drafts land in `updates` table with `approved=false` until admin
   approves.

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
- `ANTHROPIC_API_KEY` — generate-updates (and product-meta query polish,
  optional)

Optional, for product-meta image fetching cascade:
- `MICROLINK_API_KEY` — Microlink Pro for antibot retailer bypass.
  Without it, Microlink uses ~50/day shared anonymous tier, which doesn't
  bypass antibot (so Lowe's, Home Depot etc. still fail). Free tier signup
  works for friendly sites.
- `BRAVE_SEARCH_API_KEY` — required to enable image-search fallback for
  plain-text products with no URL. Free tier: 2000 queries/month. Sign
  up at brave.com/search/api. Without this set, plain-text products
  always render as placeholders (no fallback).

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
  are usually the same string.
