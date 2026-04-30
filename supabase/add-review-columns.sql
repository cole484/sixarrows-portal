-- Add review-card columns to clients table
-- These were referenced in admin saveProjectInfo but never had a column added,
-- which caused every project-info save to fail silently (Supabase rejected the
-- whole upsert because of the unknown column names — including the budget link
-- and contact info on the same payload).
--
-- Run in Supabase > SQL Editor.

alter table clients add column if not exists show_review_card boolean default false;
alter table clients add column if not exists review_left      boolean default false;

-- Verify
select id, client_name, show_review_card, review_left
from clients
order by client_name;
