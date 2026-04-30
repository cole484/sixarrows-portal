-- Add review-card columns to clients table
-- These were referenced by admin save paths but never had columns added,
-- which caused every project-info save to fail silently. The PostgREST
-- upsert rejects the whole payload when even one column is unknown, so
-- every other field on the same save (budget link, contact info,
-- groundbreaking date, status type, etc.) was lost too.
--
-- Run in Supabase > SQL Editor. Safe to re-run (uses if not exists).

alter table clients add column if not exists show_review_card boolean default false;
alter table clients add column if not exists review_left      boolean default false;
alter table clients add column if not exists review_draft     text    default '';

-- Verify all three new columns exist on every client
select id, client_name, show_review_card, review_left,
       coalesce(review_draft, '') <> '' as has_draft
from clients
order by client_name;
