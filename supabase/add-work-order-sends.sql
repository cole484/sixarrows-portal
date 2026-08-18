-- ─────────────────────────────────────────────────────────────
--  Work order links and their event log
-- ─────────────────────────────────────────────────────────────
-- Tier 2 is send and track, and neither half was possible before
-- this. The work order page took a raw Notion page id in the URL,
-- so there was no record of who a work order went to, whether it
-- was ever opened, or whether the silence afterwards meant the
-- sub was thinking about it or never got it.
--
-- Two tables, because they answer different questions:
--
--   work_order_links    one row per link minted. Who it is for,
--                       which task, how to reach them. The token
--                       is the only thing a subcontractor ever
--                       holds: no login, ever, per Cole's rule.
--
--   work_order_events   append-only log of everything that has
--                       happened to that link. Drafted, approved,
--                       sent, opened, submitted, cancelled. The
--                       current state is the newest event, and
--                       nothing is ever overwritten, so "we sent
--                       it twice and they opened it three days
--                       later" is still readable a month on.
-- ─────────────────────────────────────────────────────────────

create table if not exists work_order_links (
  token          text primary key,       -- what goes in the URL

  -- What it is for
  task_id        text not null,          -- Notion timeline page id
  project_name   text,
  trade          text,
  task_name      text,
  starts_on      date,                   -- the scheduled start at mint time

  -- Who it is for. Copied rather than referenced, because the point
  -- of this row is what we believed when we sent it.
  sub_id         text,                   -- Notion subcontractor page id
  sub_name       text,
  contact_name   text,
  to_phone       text,
  to_email       text,

  -- A link that has been superseded or called off. Set once and
  -- only ever to true, so this stays honest about append-only:
  -- the reason lives in a cancelled event.
  revoked        boolean default false,

  created_at     timestamptz default now(),
  created_by     text default 'agent'
);

-- Finding the live link for a task, which is what the follow-up
-- cron and the admin queue both do.
create index if not exists work_order_links_task_idx
  on work_order_links (task_id, created_at desc);

create table if not exists work_order_events (
  id             bigserial primary key,
  token          text not null,

  -- drafted     the message is written and waiting for a person
  -- approved    a person said send it
  -- sent        it actually left
  -- send_failed the transport refused, with the reason
  -- opened      the subcontractor loaded the page
  -- submitted   they committed to dates
  -- cancelled   it was called off before it went
  kind           text not null,

  channel        text,                   -- 'sms' | 'email'
  attempt        integer default 1,      -- 1 = the work order, 2+ = nudges
  purpose        text,                   -- 'work_order' | 'nudge' | 'escalation'

  -- What was actually said, kept because a message that has been
  -- sent is a record, not a template that can be re-derived later
  -- once the task has moved.
  to_address     text,
  subject        text,
  message        text,

  -- Outcome
  provider_sid   text,                   -- Twilio message sid, or Gmail id
  error          text,

  actor          text default 'agent',   -- who caused it
  meta           jsonb default '{}'::jsonb,
  created_at     timestamptz default now()
);

create index if not exists work_order_events_token_idx
  on work_order_events (token, created_at desc);

-- The queue: everything drafted and not yet resolved.
create index if not exists work_order_events_kind_idx
  on work_order_events (kind, created_at desc);

alter table work_order_links  enable row level security;
alter table work_order_events enable row level security;

-- Links are insert and select, plus the one narrow update that
-- revoking needs. Everything else about a link is immutable.
create policy "anon_insert" on work_order_links for insert with check (true);
create policy "anon_select" on work_order_links for select using (true);
create policy "anon_revoke" on work_order_links for update using (true) with check (revoked = true);

-- Events are append-only, enforced by RLS rather than convention.
-- Insert and select only; there is deliberately no update or delete
-- policy, the same as compliance_requests and work_order_commitments.
create policy "anon_insert" on work_order_events for insert with check (true);
create policy "anon_select" on work_order_events for select using (true);

-- ─────────────────────────────────────────────────────────────
--  Added after the first real follow-up draft
-- ─────────────────────────────────────────────────────────────
-- The job address, copied onto the link at mint time.
--
-- Without it a follow-up had nothing to name the place with and fell back to
-- the project name, so the first message read "at 106 Reynolds Ln" and the
-- nudge two days later read "at Johnson". Same job, two names, and the sub is
-- the one who has to work out they are the same. A location is copied rather
-- than looked up for the same reason as everything else on this row: it should
-- say what we told them, not what Notion says today.
alter table work_order_links add column if not exists job_address text;
