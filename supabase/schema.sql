-- ============================================================
--  SIX ARROWS CLIENT PORTAL — Supabase Schema
--  Run this entire file in Supabase > SQL Editor > New Query
-- ============================================================

-- ── Clients ─────────────────────────────────────────────────
create table if not exists clients (
  id                     text primary key,  -- e.g. 'kandaswamy', 'hoops'
  email                  text unique not null,
  password               text not null,     -- plain text for now, hash in v2
  client_name            text not null,
  project_name           text not null default 'Custom Home',
  location               text not null default 'Bowling Green, KY',
  status_type            text not null default 'sab',  -- 'sab' | 'construction'
  phase_label            text not null default 'Phase 1 — Design & Architecture',
  notion_tracker_page_id text,
  notion_timeline_db_id  text,
  selections_client_key  text,
  groundbreaking_date    text,
  budget_total           numeric default 0,
  budget_committed       numeric default 0,
  budget_allowance       numeric default 0,
  budget_contingency     numeric default 0,
  change_orders          numeric default 0,
  construction_pct       numeric default 0,
  timeline_start         text default 'TBD',
  timeline_target        text default 'TBD',
  team_lead              text default 'Cole Borders',
  team_phone             text default '(270) 782-5388',
  team_email             text default 'cole@sixarrowsconstruction.com',
  quick_summary          text default 'Welcome to your Six Arrows client portal.',
  next_decision          text default '',
  next_decision_due_days integer default 0,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ── Wave Selections ─────────────────────────────────────────
create table if not exists selections (
  id         bigserial primary key,
  client_id  text not null references clients(id) on delete cascade,
  suffix     text not null,   -- 'ans', 'sav', 'rms', 'pfx', 'ltx', 'fpu', 'spc'
  data       jsonb not null default '{}',
  updated_at timestamptz default now(),
  unique(client_id, suffix)
);

-- ── Project Updates ─────────────────────────────────────────
create table if not exists updates (
  id          bigserial primary key,
  client_id   text not null references clients(id) on delete cascade,
  title       text not null,
  body        text not null,
  date        text not null,
  approved    boolean default true,
  approved_at timestamptz,
  manual      boolean default true,
  created_at  timestamptz default now()
);

-- ── Budget Categories ────────────────────────────────────────
create table if not exists budget_categories (
  id         bigserial primary key,
  client_id  text not null references clients(id) on delete cascade,
  name       text not null,
  total      numeric default 0,
  spent      numeric default 0,
  status     text default 'pending',
  sort_order integer default 0,
  sub_categories jsonb default '[]'
);

-- ── Change Orders ────────────────────────────────────────────
create table if not exists change_orders (
  id          bigserial primary key,
  client_id   text not null references clients(id) on delete cascade,
  date        text not null,
  description text not null,
  amount      numeric default 0,
  created_at  timestamptz default now()
);

-- ── Milestones ───────────────────────────────────────────────
create table if not exists milestones (
  id         bigserial primary key,
  client_id  text not null references clients(id) on delete cascade,
  title      text not null,
  date       text not null,
  note       text default '',
  done       boolean default false,
  sort_order integer default 0
);

-- ── Documents ────────────────────────────────────────────────
create table if not exists documents (
  id        bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  name      text not null,
  category  text not null default 'other',
  url       text not null,
  type      text not null default 'link',
  date      text not null,
  note      text default '',
  created_at timestamptz default now()
);

-- ── Decisions ────────────────────────────────────────────────
create table if not exists decisions (
  id         bigserial primary key,
  client_id  text not null references clients(id) on delete cascade,
  title      text not null,
  due        text not null,
  status     text not null default 'active',
  note       text default '',
  sort_order integer default 0
);

-- ── RLS: Enable on all tables ────────────────────────────────
-- For now we use anon key with open policies (portal handles auth)
-- Lock this down further when real auth is added in v3

alter table clients          enable row level security;
alter table selections        enable row level security;
alter table updates           enable row level security;
alter table budget_categories enable row level security;
alter table change_orders     enable row level security;
alter table milestones        enable row level security;
alter table documents         enable row level security;
alter table decisions         enable row level security;

-- Allow all operations via anon key (portal handles its own auth)
create policy "anon_all" on clients          for all using (true) with check (true);
create policy "anon_all" on selections        for all using (true) with check (true);
create policy "anon_all" on updates           for all using (true) with check (true);
create policy "anon_all" on budget_categories for all using (true) with check (true);
create policy "anon_all" on change_orders     for all using (true) with check (true);
create policy "anon_all" on milestones        for all using (true) with check (true);
create policy "anon_all" on documents         for all using (true) with check (true);
create policy "anon_all" on decisions         for all using (true) with check (true);

-- ── Updated_at trigger ──────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger clients_updated_at
  before update on clients
  for each row execute function update_updated_at();

create trigger selections_updated_at
  before update on selections
  for each row execute function update_updated_at();
