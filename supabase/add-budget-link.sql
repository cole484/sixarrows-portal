-- Add budget_link column to clients table
-- Run in Supabase > SQL Editor

alter table clients add column if not exists budget_link text default '';

-- Verify
select id, client_name, budget_link from clients order by client_name;
