-- ============================================================
--  VISUAL SELECTIONS: phase 1 (staff only)
--  Run this entire file in Supabase > SQL Editor > New Query
--
--  Three new tables plus one storage bucket.
--
--  selection_items is the identity layer the pin model needs.
--  Wave Selections stores every selection for a client inside a
--  single jsonb blob (selections.data where suffix = 'ans'), so
--  there is no per-selection row to point a foreign key at. This
--  table gives each selection a real uuid. It is populated by
--  netlify/functions/selection-items-sync.js, which re-derives
--  items from the blob and upserts them matched on item_key, so
--  the uuid stays stable across re-syncs and pins never detach.
--
--  The Wave Selections app is not modified. The blob remains the
--  source of truth for the fields it owns (product, image, room,
--  label). Fields it has never had (vendor, cost, product_link)
--  are authored in the pin UI and are never overwritten by sync.
-- ============================================================

-- ── Selection items ─────────────────────────────────────────
create table if not exists selection_items (
  id           uuid primary key default gen_random_uuid(),
  client_id    text not null references clients(id) on delete cascade,

  -- Stable derived key, built from IDs that never change
  -- (category + room id + fixture/type id) rather than from
  -- display labels, so renaming a room does not orphan pins.
  -- Null for items created directly in the pin UI.
  item_key     text,
  source       text not null default 'wave',   -- 'wave' | 'pin'

  -- Mirrors of the Wave Selections model. wave is the integer
  -- index into the WAVES array in portal/selections-app.html
  -- (0 = Structure, 1 = The Shell, 2 = The Jewelry).
  category     text not null,
  wave         integer not null default 0,
  room         text not null default '',
  room_id      text not null default '',
  label        text not null default '',

  -- Owned by the blob, refreshed on every sync
  product      text not null default '',
  image_url    text not null default '',
  detail       jsonb not null default '{}',    -- material, color, finish, style, grout...

  -- Owned by the pin UI, never touched by sync
  vendor       text not null default '',
  cost         numeric,
  product_link text not null default '',
  notes        text not null default '',

  -- Set when an item disappears from the blob (client unchecked a
  -- fixture). The row is kept so existing pins still resolve.
  archived     boolean not null default false,

  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- One row per derived item per client. Pin-authored rows have a
-- null item_key and are excluded from the constraint.
create unique index if not exists selection_items_client_item_key
  on selection_items (client_id, item_key)
  where item_key is not null;

create index if not exists selection_items_client_idx
  on selection_items (client_id);

-- ── Plans ───────────────────────────────────────────────────
-- One row per sheet. A multi-page PDF produces one row per page.
create table if not exists plans (
  id           uuid primary key default gen_random_uuid(),
  client_id    text not null references clients(id) on delete cascade,
  plan_type    text not null default 'floor',    -- 'floor' | 'elevation'
  label        text not null default 'Plan',
  image_url    text not null default '',
  source_url   text not null default '',         -- original PDF when converted
  page         integer not null default 1,
  image_width  integer,
  image_height integer,
  status       text not null default 'ready',    -- 'converting' | 'ready' | 'failed'
  error        text not null default '',
  sort_order   integer not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists plans_client_idx on plans (client_id);

-- ── Pins ────────────────────────────────────────────────────
-- One pin per physical fixture. There is no quantity field.
-- Four identical sconces are four pins pointing at one
-- selection_item, so editing the selection updates all four.
create table if not exists pins (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references plans(id) on delete cascade,
  selection_item_id uuid not null references selection_items(id) on delete cascade,

  -- Percentage of plan width and height, 0 to 100. Never pixels.
  -- The plan is viewed at different sizes and zoom levels.
  x                 double precision not null,
  y                 double precision not null,

  room              text not null default '',
  created_from      uuid references pins(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  constraint pins_x_pct check (x >= 0 and x <= 100),
  constraint pins_y_pct check (y >= 0 and y <= 100)
);

create index if not exists pins_plan_idx on pins (plan_id);
create index if not exists pins_item_idx on pins (selection_item_id);

-- ── RLS ─────────────────────────────────────────────────────
-- Matches the posture of every other table in this schema: open
-- via the anon key, with the portal enforcing its own auth in the
-- frontend. Tighten alongside the rest of the schema, not alone.
alter table selection_items enable row level security;
alter table plans           enable row level security;
alter table pins            enable row level security;

drop policy if exists "anon_all" on selection_items;
drop policy if exists "anon_all" on plans;
drop policy if exists "anon_all" on pins;

create policy "anon_all" on selection_items for all using (true) with check (true);
create policy "anon_all" on plans           for all using (true) with check (true);
create policy "anon_all" on pins            for all using (true) with check (true);

-- ── updated_at triggers ─────────────────────────────────────
-- update_updated_at() is defined in schema.sql.
drop trigger if exists selection_items_updated_at on selection_items;
create trigger selection_items_updated_at
  before update on selection_items
  for each row execute function update_updated_at();

drop trigger if exists plans_updated_at on plans;
create trigger plans_updated_at
  before update on plans
  for each row execute function update_updated_at();

drop trigger if exists pins_updated_at on pins;
create trigger pins_updated_at
  before update on pins
  for each row execute function update_updated_at();

-- ── Storage bucket for plan images ──────────────────────────
-- Public read so <img src> works without signed URLs, consistent
-- with how documents and build photos are already served. Paths
-- carry a uuid, so they are not guessable.
insert into storage.buckets (id, name, public)
values ('plans', 'plans', true)
on conflict (id) do update set public = true;

drop policy if exists "plans_read"   on storage.objects;
drop policy if exists "plans_write"  on storage.objects;
drop policy if exists "plans_update" on storage.objects;
drop policy if exists "plans_delete" on storage.objects;

create policy "plans_read"   on storage.objects for select
  using (bucket_id = 'plans');
create policy "plans_write"  on storage.objects for insert
  with check (bucket_id = 'plans');
create policy "plans_update" on storage.objects for update
  using (bucket_id = 'plans') with check (bucket_id = 'plans');
create policy "plans_delete" on storage.objects for delete
  using (bucket_id = 'plans');
