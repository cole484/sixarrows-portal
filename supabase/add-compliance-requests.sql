-- ─────────────────────────────────────────────────────────────
--  Compliance document requests, append-only
-- ─────────────────────────────────────────────────────────────
-- One row per outbound request for a subcontractor's certificate
-- of insurance or W9. Never updated, never deleted.
--
-- This is what makes the follow-up cadence work. Before sending
-- anything the sweep counts prior rows for that sub and document
-- set, so it knows whether this is the first ask, a follow-up, or
-- the point where it should stop emailing and hand the problem to
-- a person. Without a durable record it would either re-send the
-- initial request every morning or forget to follow up at all.
--
-- Escalations are recorded here too, with sent = false, so the
-- history shows the chase ending rather than just going quiet.
-- ─────────────────────────────────────────────────────────────

create table if not exists compliance_requests (
  id                bigserial primary key,

  -- Who
  sub_id            text not null,          -- Notion Subcontractors page id
  sub_name          text,
  to_email          text,

  -- What was missing at the time of the request
  doc_needs         text not null,          -- 'coi' | 'w9' | 'coi+w9'
  coi_state         text,                   -- 'ok' | 'expired' | 'missing'
  coi_expiry        date,

  -- Why it mattered: the job that was about to start
  project           text,
  task_id           text,
  task_name         text,
  start_date        date,

  -- The message
  attempt           integer not null default 1,
  subject           text,
  body              text,

  -- Outcome. sent = false with an action of 'escalate' means the chase
  -- stopped and a person was told, which is a real event worth recording.
  action            text not null default 'send',   -- 'send' | 'escalate'
  sent              boolean default false,
  gmail_message_id  text,
  gmail_thread_id   text,
  error             text,

  created_at        timestamptz default now()
);

-- The cadence check reads history per sub, newest first.
create index if not exists compliance_requests_sub_idx
  on compliance_requests (sub_id, created_at desc);

alter table compliance_requests enable row level security;

-- Append-only, enforced by RLS rather than convention. Insert and select
-- only; there is deliberately no update or delete policy.
create policy "anon_insert" on compliance_requests
  for insert with check (true);

create policy "anon_select" on compliance_requests
  for select using (true);
