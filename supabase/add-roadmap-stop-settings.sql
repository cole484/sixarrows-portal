-- ─────────────────────────────────────────────────────────────
--  Selections Roadmap — stop settings
-- ─────────────────────────────────────────────────────────────
-- One row per stop. Stores admin-editable fields that previously
-- lived in portal/roadmap.html as hardcoded data:
--   - touch: 'yes' (Must Touch) | 'rec' (Recommended) | 'dig' (Digital OK)
--   - why:   the "why this matters" callout shown under the stop
-- The client portal falls back to hardcoded defaults if the row
-- is missing, so deleting a row is safe.
-- ─────────────────────────────────────────────────────────────

create table if not exists roadmap_stop_settings (
  stop_id    text primary key,
  touch      text not null default 'rec',   -- 'yes' | 'rec' | 'dig'
  why        text default '',
  updated_at timestamptz default now()
);

alter table roadmap_stop_settings enable row level security;

drop policy if exists "anon_all" on roadmap_stop_settings;
create policy "anon_all" on roadmap_stop_settings
  for all using (true) with check (true);

-- Auto-bump updated_at on edit (reuse touch() fn pattern)
create or replace function roadmap_stop_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roadmap_stop_settings_updated_at on roadmap_stop_settings;
create trigger roadmap_stop_settings_updated_at
  before update on roadmap_stop_settings
  for each row execute function roadmap_stop_settings_touch();

-- ─────────────────────────────────────────────────────────────
-- Seed with the defaults hardcoded in portal/roadmap.html so the
-- admin UI has something to edit on day one. Only seeds if the
-- table is empty, so re-running is safe.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from roadmap_stop_settings limit 1) then
    insert into roadmap_stop_settings (stop_id, touch, why) values
      ('fireplace',   'yes', 'Firebox dimensions and gas line locations affect framing. These must be locked before framing begins — changes after framing are expensive.'),
      ('appliances',  'rec', 'Appliance dimensions drive cabinet opening sizes and utility rough-in locations. Selecting early prevents costly cabinet and rough-in corrections.'),
      ('windows',     'yes', 'Windows have a 10–14 week lead time and their dimensions lock the framing package. This is always the first critical appointment — no exceptions.'),
      ('exterior',    'yes', 'Brick, stone, and siding affect framing details, flashing specs, and drainage plane design. Exterior framing cannot close without these locked.'),
      ('roof',        'rec', 'Roof type affects structural load and truss design. Changes after the truss package is engineered create re-engineering fees.'),
      ('cabinets',    'yes', 'Custom cabinets take 10–14 weeks to fabricate. Kitchen and bath rough-in locations cannot be confirmed until the cabinet layout is finalized.'),
      ('flooring',    'yes', 'Flooring type and thickness determine subfloor preparation, transitions, and threshold heights throughout the home.'),
      ('tile',        'yes', 'Shower pan design and backer board spec depend on tile weight and format. Grout lines and texture don''t translate from photos — must be seen in person.'),
      ('plumbing',    'rec', 'Rough-in locations are set before walls close. Moving plumbing rough-in after framing is one of the most expensive corrections in a build.'),
      ('lighting',    'rec', 'Electrical rough-in box locations and switch placements depend on fixture selections. Scale and finish don''t come through in photos.'),
      ('countertops', 'yes', 'Every slab is unique — photos cannot replace walking the yard. Template happens after cabinet install. Reserve your slab early so it doesn''t sell.'),
      ('hardware',    'dig', 'Door hardware, cabinet pulls, and bath accessories. Many great options online once your finish direction is set from plumbing selections.'),
      ('paint',       'dig', 'Large color boards read very differently from small chips. Coordinate after flooring and countertops so all colors work together.');
  end if;
end $$;
