-- supabase/add-document-reads.sql
--
-- What the reader saw in a compliance document, cached so the daily sweep
-- does not pay to re-read certificates that have not changed.
--
-- Keyed on the Drive file id plus its modification time. Replacing a
-- certificate in Drive changes the modification time, which misses the cache
-- and triggers a fresh read. There is nothing to invalidate by hand.
--
-- Append-only, same as compliance_requests and work_order_commitments: insert
-- and select policies only, no update, no delete. A read is a record of what
-- the system believed about a document at a moment in time. Overwriting it
-- would destroy the only evidence of why an email went out.
--
-- Run this in the Supabase SQL editor.

create table if not exists document_reads (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),

  -- Which document
  file_id              text not null,
  file_name            text,
  modified_time        text not null default '',
  kind                 text not null default 'coi',      -- 'coi' | 'w9'

  -- How it was read: 'text' for the local PDF text pass, 'ai' for Claude
  method               text,
  model                text,

  -- Certificate fields
  expiry               date,
  insured_name         text,
  business_name        text,
  certificate_holder   text,
  additional_insured   text,                             -- 'yes' | 'no' | 'unclear'
  six_arrows_is_holder boolean default false,
  policies             jsonb default '{}'::jsonb,

  confidence           text,                             -- 'high' | 'low' | 'none'
  notes                text,
  error                text
);

-- The lookup the sweep does on every document, every run.
create index if not exists document_reads_lookup_idx
  on document_reads (file_id, modified_time, created_at desc);

create index if not exists document_reads_kind_idx
  on document_reads (kind, created_at desc);

alter table document_reads enable row level security;

-- Insert and select only. The absence of update and delete policies is the
-- enforcement: with RLS on, an operation with no policy is denied, so the
-- append-only rule holds at the database rather than by convention.
drop policy if exists document_reads_insert on document_reads;
create policy document_reads_insert on document_reads
  for insert to anon, authenticated with check (true);

drop policy if exists document_reads_select on document_reads;
create policy document_reads_select on document_reads
  for select to anon, authenticated using (true);

-- PostgREST answers the REST API from a cached picture of the schema. It
-- usually notices a new table on its own, but when it does not, every request
-- comes back PGRST205 "Could not find the table in the schema cache" and the
-- table looks missing even though it is right there. This forces the reload.
-- Harmless to run when nothing changed.
notify pgrst, 'reload schema';

-- Says plainly whether this worked, so nobody has to go and poke an endpoint
-- to find out. Expect one row reading: document_reads  ready
select
  'document_reads' as table_name,
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'document_reads'
  ) then 'ready' else 'MISSING, the create above did not run' end as status,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'document_reads') as policies;
