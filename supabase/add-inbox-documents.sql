-- supabase/add-inbox-documents.sql
--
-- Every attachment the inbox watcher has already dealt with.
--
-- This table exists to answer one question: have we filed this before? Without
-- it the watcher re-uploads the same certificate on every run, and because
-- drive.file cannot overwrite, each run would add another copy beside the last.
-- A week of that and the COI folder is unusable.
--
-- Keyed on the Gmail message id plus the attachment id, so a reply carrying a
-- certificate and a W9 records two rows, and a sub who sends a corrected
-- certificate in a new email records a new row rather than being mistaken for
-- the old one.
--
-- Append-only, same as document_reads, quote_responses and compliance_requests:
-- insert and select policies only, no update, no delete. With row level
-- security on, an operation with no policy is denied, so the rule holds at the
-- database rather than by convention.
--
-- Run this in the Supabase SQL editor.

create table if not exists inbox_documents (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  -- Where it came from
  message_id        text not null,
  thread_id         text,
  attachment_id     text not null,
  from_email        text,
  from_name         text,
  subject           text,
  received_at       timestamptz,
  source_filename   text,
  mime_type         text,
  size_bytes        bigint,

  -- What we decided it was. kind is 'coi' | 'w9' | 'unknown'.
  kind              text,
  -- Who it belongs to, and how we worked that out. matched_via is one of
  -- 'thread' | 'sender' | 'subject' | 'document' | null. Recorded because the
  -- weaker routes deserve a second look and the stronger ones do not, and
  -- because a wrong match here files a certificate under the wrong sub.
  sub_id            text,
  sub_name          text,
  matched_via       text,
  match_confidence  text,

  -- Where it went
  drive_file_id     text,
  drive_file_name   text,
  drive_folder_id   text,
  uploaded          boolean default false,
  error             text
);

-- The lookup the watcher does on every run, once, for everything it has seen.
create index if not exists inbox_documents_key_idx
  on inbox_documents (message_id, attachment_id);

create index if not exists inbox_documents_sub_idx
  on inbox_documents (sub_id, created_at desc);

alter table inbox_documents enable row level security;

drop policy if exists inbox_documents_insert on inbox_documents;
create policy inbox_documents_insert on inbox_documents
  for insert to anon, authenticated with check (true);

drop policy if exists inbox_documents_select on inbox_documents;
create policy inbox_documents_select on inbox_documents
  for select to anon, authenticated using (true);

-- PostgREST answers from a cached picture of the schema and does not always
-- notice a new table on its own. Without this the API returns PGRST205 and the
-- table looks missing when it is right there.
notify pgrst, 'reload schema';

-- Says plainly whether this worked. Expect one row: inbox_documents  ready  2
select
  'inbox_documents' as table_name,
  case when exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'inbox_documents'
  ) then 'ready' else 'MISSING, the create above did not run' end as status,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'inbox_documents') as policies;
