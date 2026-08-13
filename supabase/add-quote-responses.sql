-- supabase/add-quote-responses.sql
--
-- Every quote a subcontractor sends back, exactly as they sent it.
--
-- Append-only, same as work_order_commitments, compliance_requests and
-- document_reads: insert and select policies only, no update, no delete. With
-- row level security on, an operation with no policy is denied, so the rule
-- holds at the database rather than by convention.
--
-- Append-only matters more here than anywhere else in this system. This table
-- is the record of what a subcontractor said a job would cost, on a date, in
-- their own words. If a number is later disputed, an overwritten row would
-- have destroyed the only evidence.
--
-- Several subs may quote the same task. That is the normal case, not an error,
-- so nothing here is unique per task.
--
-- Run this in the Supabase SQL editor.

create table if not exists quote_responses (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  -- What was quoted
  task_id           text not null,
  task_name         text,
  project           text,
  trade             text,

  -- Who quoted it. sub_id may be null: a request can be sent to somebody who
  -- is not yet linked on the task, and refusing their number for that reason
  -- would be absurd.
  sub_id            text,
  sub_name          text,
  contact_name      text,
  contact_email     text,

  -- The number, and how they arrived at it
  amount            numeric,
  labor_amount      numeric,
  material_amount   numeric,
  exclusions        text,
  inclusions        text,
  notes             text,

  -- What they can commit to
  lead_time_days    integer,
  earliest_start    date,
  valid_until       date,
  can_hold_window   boolean,

  -- Provenance
  signature_name    text,
  submitted_from    text,

  -- Whether this number reached Notion, and why not if it did not. Recorded
  -- rather than retried silently, so a broken mirror is visible in the data
  -- instead of only in a log nobody reads.
  notion_synced     boolean default false,
  notion_error      text,
  wrote_cost        boolean default false
);

create index if not exists quote_responses_task_idx on quote_responses (task_id, created_at desc);
create index if not exists quote_responses_sub_idx  on quote_responses (sub_id, created_at desc);

alter table quote_responses enable row level security;

drop policy if exists quote_responses_insert on quote_responses;
create policy quote_responses_insert on quote_responses
  for insert to anon, authenticated with check (true);

drop policy if exists quote_responses_select on quote_responses;
create policy quote_responses_select on quote_responses
  for select to anon, authenticated using (true);

-- PostgREST answers from a cached picture of the schema and does not always
-- notice a new table on its own. Without this the API returns PGRST205 and the
-- table looks missing when it is right there.
notify pgrst, 'reload schema';

-- Says plainly whether this worked. Expect one row: quote_responses  ready  2
select
  'quote_responses' as table_name,
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'quote_responses'
  ) then 'ready' else 'MISSING, the create above did not run' end as status,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'quote_responses') as policies;
