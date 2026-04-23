-- ─────────────────────────────────────────────────────────────
--  Selections Roadmap — vendor defaults
-- ─────────────────────────────────────────────────────────────
-- One row per vendor option per stop. The client portal reads
-- these as global defaults. Per-client overrides live in the
-- existing `selections` table under suffix = 'rdm_vendors'.
-- Per-client progress state lives under suffix = 'rdm_state'.
-- ─────────────────────────────────────────────────────────────

create table if not exists roadmap_vendor_defaults (
  id         bigserial primary key,
  stop_id    text not null,      -- 'fireplace', 'appliances', 'windows', ...
  name       text not null,
  detail     text default '',
  tag        text,                -- 'recommended' | 'premium' | 'budget' | null
  sort_order integer default 0,
  is_active  boolean default true,
  updated_at timestamptz default now()
);

create index if not exists roadmap_vendor_defaults_stop_idx
  on roadmap_vendor_defaults (stop_id, sort_order);

alter table roadmap_vendor_defaults enable row level security;

drop policy if exists "anon_all" on roadmap_vendor_defaults;
create policy "anon_all" on roadmap_vendor_defaults
  for all using (true) with check (true);

-- Auto-bump updated_at on edit
create or replace function roadmap_vendor_defaults_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roadmap_vendor_defaults_updated_at on roadmap_vendor_defaults;
create trigger roadmap_vendor_defaults_updated_at
  before update on roadmap_vendor_defaults
  for each row execute function roadmap_vendor_defaults_touch();

-- ─────────────────────────────────────────────────────────────
-- Seed with the Bowling Green vendor defaults from the original
-- selections-roadmap-v3.html file. These can be edited anytime
-- from the admin portal; they only get inserted if the table is
-- currently empty (so re-running the migration is safe).
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from roadmap_vendor_defaults limit 1) then
    insert into roadmap_vendor_defaults (stop_id, name, detail, tag, sort_order) values
      -- Wave 1
      ('fireplace',   'BG Hearth & Home',              '1234 Campbell Lane, Bowling Green',             'recommended', 1),
      ('fireplace',   'Kentucky Fireplace Co.',         'Scottsville Rd — working displays',             null,          2),
      ('appliances',  'Southern Appliance Gallery',     'Pro-line brands: Sub-Zero, Wolf, Thermador',    'recommended', 1),
      ('appliances',  'Appliance Direct BG',            'Mid-range and builder-grade',                   'budget',      2),
      ('appliances',  'Able Kitchen & Bath',            'Full showroom, design services available',      null,          3),
      ('windows',     'BG Window Works',                'Andersen, Pella, Marvin lines',                 'recommended', 1),
      ('windows',     'Kentucky Window & Door',         'Pella & Milgard dealer',                        null,          2),
      ('exterior',    'Kentucky Stone & Siding',        'Walk-in yard — full brick, stone, LP siding',   'recommended', 1),
      ('exterior',    'BG Masonry Supply',              'Brick and block specialist',                    null,          2),
      ('exterior',    'Southern Exteriors',             'James Hardie dealer + masonry',                 null,          3),
      ('roof',        'Barren River Roofing Supply',    'Shingle, metal, and tile options',              'recommended', 1),
      ('roof',        'ABC Supply — BG',                'Full roofing material distributor',             null,          2),
      -- Wave 2
      ('cabinets',    'Crafted Cabinetry of BG',        'Semi-custom and full-custom lines',             'recommended', 1),
      ('cabinets',    'Southern Kitchen & Bath',        'Design studio — multiple lines',                null,          2),
      ('cabinets',    'Medallion Cabinets — BG',        'Builder to premium grade',                      'budget',      3),
      ('flooring',    'Heartland Floor Co.',            'Hardwood, LVP, carpet — full selection',        'recommended', 1),
      ('flooring',    'BG Flooring & Tile',             'Combined flooring and tile showroom',           null,          2),
      ('flooring',    'Floor & Decor — Nashville',      'Largest selection — worth the drive for tile',  null,          3),
      ('tile',        'BG Tile & Stone',                'Dedicated tile showroom, design help',          'recommended', 1),
      ('tile',        'Floor & Decor — Nashville',      'Massive selection, great for tile specifically', null,         2),
      ('tile',        'Daltile Studio — Nashville',     'Premium tile lines',                            'premium',     3),
      -- Wave 3
      ('plumbing',    'Ferguson — Bowling Green',       'Full showroom — Kohler, Moen, Delta, Brizo',    'recommended', 1),
      ('plumbing',    'Able Plumbing Supply',           'Mid-range plumbing fixtures',                   null,          2),
      ('plumbing',    'Waterworks — Nashville',         'Luxury fixtures and finishes',                  'premium',     3),
      ('lighting',    'Southern Lights Gallery',        'Full showroom — working displays',              'recommended', 1),
      ('lighting',    'Lighting Universe BG',           'Mid-range and builder-grade',                   'budget',      2),
      ('lighting',    'Visual Comfort — Nashville',     'Designer lighting lines',                       'premium',     3),
      ('countertops', 'Kentucky Marble & Granite',      'Walk-in slab yard — quartz, granite, quartzite','recommended', 1),
      ('countertops', 'BG Stone Works',                 'Fabricator with slab selection',                null,          2),
      ('countertops', 'Cambria Gallery — Nashville',    'Premium quartz only',                           'premium',     3),
      ('hardware',    'Emtek / Rejuvenation — Online',  'Best online hardware selection',                'recommended', 1),
      ('hardware',    'Hardware Resources — BG',        'Local cabinet hardware',                        null,          2),
      ('paint',       'Sherwin-Williams — BG',          'Scottsville Rd — design consult available',     'recommended', 1),
      ('paint',       'Benjamin Moore — BG',            'Aura and Regal lines',                          null,          2);
  end if;
end $$;
