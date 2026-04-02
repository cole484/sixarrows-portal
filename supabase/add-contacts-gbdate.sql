-- Add dual contact columns and groundbreaking date to clients table
-- Run in Supabase > SQL Editor

alter table clients add column if not exists cx_name   text default '';
alter table clients add column if not exists cx_phone  text default '';
alter table clients add column if not exists cx_email  text default '';
alter table clients add column if not exists pm_name   text default '';
alter table clients add column if not exists pm_phone  text default '';
alter table clients add column if not exists pm_email  text default '';
alter table clients add column if not exists groundbreaking_date text default '';

-- Verify
select id, client_name, cx_name, pm_name, groundbreaking_date 
from clients 
order by client_name;
