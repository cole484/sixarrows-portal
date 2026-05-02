-- ─────────────────────────────────────────────────────────────
--  Product metadata cache for the Design Book
-- ─────────────────────────────────────────────────────────────
-- Clients paste retailer URLs into the selections "exact product"
-- fields (Lowes, Home Depot, Menards, Ferguson, Moen, etc.). The
-- design book fetches each URL's Open Graph + JSON-LD metadata to
-- pull the product image, title, and price, and caches the result
-- here so subsequent loads don't re-scrape.
--
-- Schema notes:
--  - url_hash: SHA-256 of the canonical URL (lowercased, query
--    params normalized) so multi-byte URLs and signed query strings
--    map to a single row.
--  - price / price_currency: collected now even though we are not
--    displaying it on the design book yet. We can surface it on a
--    future pricing report without re-scraping.
--  - error: when set, the last fetch failed (404, blocked, no OG).
--    UI shows a placeholder; admin can click Refresh to retry.
-- ─────────────────────────────────────────────────────────────

create table if not exists product_meta (
  id             bigserial primary key,
  url_hash       text unique not null,
  url            text not null,
  retailer       text default '',     -- inferred from hostname
  title          text default '',
  image          text default '',
  price          numeric,             -- nullable
  price_currency text default '',
  error          text default '',     -- non-empty when last fetch failed
  fetched_at     timestamptz default now()
);

create index if not exists product_meta_fetched_at_idx
  on product_meta (fetched_at desc);

alter table product_meta enable row level security;

drop policy if exists "anon_all" on product_meta;
create policy "anon_all" on product_meta
  for all using (true) with check (true);

-- Auto-bump fetched_at on UPDATE so we can use it as a TTL signal
create or replace function product_meta_touch()
returns trigger language plpgsql as $$
begin
  new.fetched_at := now();
  return new;
end $$;

drop trigger if exists product_meta_updated_at on product_meta;
create trigger product_meta_updated_at
  before update on product_meta
  for each row execute function product_meta_touch();
