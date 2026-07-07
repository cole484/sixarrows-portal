# Staging environment — one-time setup runbook

Goal: a **separate Supabase project + Netlify context** so the CX build never
reads or writes production data. Production Supabase ref `mtvcahscwpralmlqlnzg`
is **off-limits** — nothing here touches it.

Everything ongoing (schema, seed, functions, triggers, deploys) is automated
after this. What only *you* can do is the account-root setup below, because it
starts from accounts you own and my container is network-blocked from
Supabase/Netlify APIs.

---

## The one irreducible thing: credentials

Generate these once. Where they go depends on the path you pick (A/B/C).

| Token | Where to generate |
|---|---|
| **Supabase personal access token** | supabase.com → Account → Access Tokens → Generate |
| **Netlify personal access token** | app.netlify.com → User settings → Applications → Personal access tokens |

Notion/Google sandboxes: **I handle these myself** via the connectors already
authorized in this session — no token needed from you.

---

## Path A — open egress + tokens  (recommended, most hands-off)

1. In this environment's **network policy**, allow these hosts:
   `api.supabase.com`, `*.supabase.co`, `api.netlify.com`
   (docs: https://code.claude.com/docs/en/claude-code-on-the-web)
2. Add the two tokens to the environment as:
   `SUPABASE_ACCESS_TOKEN`, `NETLIFY_AUTH_TOKEN`
3. Tell me it's done. I then, live from here:
   - create the `sixarrows-staging` Supabase project (I'll pick region + a
     generated DB password and report them back),
   - apply schema in the order below (I'll show you the SQL first — you asked
     to approve schema changes),
   - run `staging/seed-staging.sql`,
   - duplicate the needed Notion DBs to a sandbox and wire their ids,
   - create/point the Netlify branch-deploy context with staging env vars.

## Path B — GitHub Actions

1. Add the two tokens as **repo secrets**: `SUPABASE_ACCESS_TOKEN`,
   `NETLIFY_AUTH_TOKEN`.
2. I commit a workflow that provisions + migrates + deploys from CI (GitHub is
   reachable even though my container isn't). You approve the first run.

## Path C — you create projects, I build

1. Create a Supabase project `sixarrows-staging` and a Netlify context.
2. Drop the **staging-only** keys into the environment:
   `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`
   (+ service role key if you want me to seed via REST).
3. I build/push all code and set up Notion. Schema changes come to you as
   paste-ready SQL for the Supabase SQL editor.

---

## Schema apply order (fresh staging DB)

Run the existing repo SQL, skipping prod data files:

1. `supabase/schema.sql`
2. `supabase/add-budget-link.sql`
3. `supabase/add-contacts-gbdate.sql`
4. `supabase/add-review-columns.sql`
5. `supabase/add-product-meta.sql`
6. `supabase/add-roadmap-stop-settings.sql`
7. `supabase/add-roadmap-vendors.sql`
8. `staging/seed-staging.sql`   ← scrubbed, safe

**Skip** `supabase/seed.sql` and `supabase/fix-woods-budget.sql` — those carry
real client data.

---

## Pointing the build at staging (not prod)

Prod URL + anon key are **hardcoded** in `portal/admin.html` and
`portal/share.html`. To avoid the staging deploy hitting prod, I'll introduce a
single `portal/config.js` the pages read from, so environment picks the target.
This touches client-facing files, so it lands on the build branch only and I'll
flag it before merge — it never changes prod behavior until you approve.

---

## Security notes (surfaced, not blocking)

- Production RLS is enabled but every policy is wide-open `anon_all`, and client
  passwords are plaintext. Staging inherits this from the same schema — fine for
  a throwaway DB with fake data, but it's the reason we do **not** copy real
  creds into staging. Tightening RLS/hashing is a separate, later track.
- My container physically cannot reach prod Supabase/Netlify (allowlist blocks
  it), so there is no path for this build to mutate production data.
