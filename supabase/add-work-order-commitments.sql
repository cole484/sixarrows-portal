-- ─────────────────────────────────────────────────────────────
--  Work order commitments, append-only
-- ─────────────────────────────────────────────────────────────
-- One row per subcontractor submission. Never updated, never
-- deleted. A sub who resubmits creates a second row; the newest
-- row by created_at is the current commitment, and the older
-- rows are the history of what changed and when.
--
-- This replaces the old approach of writing a transcript into a
-- single `Sub Commitment` rich_text field on the Notion task,
-- which overwrote the prior commitment on every resubmission and
-- truncated at 2000 characters. That field was also absent from
-- most per-project timeline DBs, so the write returned 400 and
-- the submission failed outright.
--
-- The Notion task still gets Start and Status written to it, so
-- the schedule stays live where people work. This table is the
-- record of what was actually agreed.
-- ─────────────────────────────────────────────────────────────

create table if not exists work_order_commitments (
  id                 bigserial primary key,

  -- Identity
  task_id            text not null,          -- Notion timeline page id
  work_order_number  text,                   -- if set on the task
  project_name       text,
  trade              text,

  -- What the sub committed to
  committed_start    date not null,
  committed_end      date not null,
  working_days       integer,

  -- Money, with provenance. cost_source mirrors the Notion
  -- "Cost Source" select: Estimate | Bid Received | To Be Quoted.
  -- Anything other than 'Bid Received' means this number did not
  -- come from the sub, and should never have been signable.
  contract_value     numeric(12,2),
  cost_source        text,
  holdback_pct       numeric(5,2) default 0,
  payment_type       text,                   -- single | two | three
  payment_milestones jsonb default '[]'::jsonb,

  -- Free text from the sub
  pre_start_blockers text default '',
  notes              text default '',

  -- Who and when. signature_name is what the sub typed; actor is
  -- who the system believes submitted it.
  signature_name     text not null,
  actor              text default 'subcontractor',
  commitment_text    text,                   -- human-readable transcript

  -- Did the matching Notion write land? Recorded so a failed sync
  -- is visible without hunting through function logs.
  notion_synced      boolean default false,
  notion_error       text,

  created_at         timestamptz default now()
);

-- Newest commitment per task is the hot query.
create index if not exists work_order_commitments_task_idx
  on work_order_commitments (task_id, created_at desc);

alter table work_order_commitments enable row level security;

-- Append-only, enforced at the database rather than by convention.
-- Insert and select are permitted. There is deliberately no update
-- or delete policy, so RLS denies both even to the anon key.
create policy "anon_insert" on work_order_commitments
  for insert with check (true);

create policy "anon_select" on work_order_commitments
  for select using (true);
