-- ============================================================
--  SIX ARROWS — STAGING seed (SAFE / SCRUBBED)
--  Run ONLY against the staging Supabase project — never prod.
--  Contains NO real client PII, emails, access codes, or Notion IDs.
--  Run AFTER schema.sql + all add-*.sql migrations.
-- ============================================================

-- ── Fake pilots (pre-construction) + one construction test build ──
-- The three pilots mirror the real roster names only so the UI reads
-- naturally; every credential and external ID below is a placeholder.
-- notion_* ids are left as 'STAGING-*' placeholders — fill them with
-- the sandbox Notion database ids after those dupes are created.

insert into clients (
  id, email, password, client_name, project_name, location,
  status_type, phase_label, notion_tracker_page_id, notion_timeline_db_id,
  selections_client_key, groundbreaking_date,
  budget_total, budget_committed, construction_pct,
  timeline_start, timeline_target, quick_summary
) values

-- Pilot 1 — SAB / pre-construction
('johnson', 'johnson@staging.local', 'staging-johnson',
 'James & Dana Johnson (STAGING)', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 2 — Selections & Specifications',
 'STAGING-TRACKER-JOHNSON', null,
 'johnson', 'TBD', 0, 0, 0, 'TBD', 'TBD',
 'STAGING data — not a real client portal.'),

-- Pilot 2 — SAB / pre-construction
('howard', 'howard@staging.local', 'staging-howard',
 'Derek & Amanda Howard (STAGING)', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 'STAGING-TRACKER-HOWARD', null,
 'howard', 'TBD', 0, 0, 0, 'TBD', 'TBD',
 'STAGING data — not a real client portal.'),

-- Pilot 3 — SAB / pre-construction
('nagornay', 'nagornay@staging.local', 'staging-nagornay',
 'Amber & Alex Nagornay (STAGING)', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 'STAGING-TRACKER-NAGORNAY', null,
 'nagornay', 'TBD', 0, 0, 0, 'TBD', 'TBD',
 'STAGING data — not a real client portal.'),

-- Construction test build — REQUIRED to exercise the milestone /
-- slip-notification / weekly-cadence / work-order-reconfirm triggers,
-- which only run for status_type='construction' with a timeline db.
('stagingbuild', 'build@staging.local', 'staging-build',
 'Staging Test Build', 'Custom Home', 'Bowling Green, KY',
 'construction', 'Under Construction',
 null, 'STAGING-TIMELINE-DB',
 'stagingbuild', '2026-03-02',
 500000, 260000, 45, 'Mar 2026', 'Dec 2026',
 'STAGING construction test build — drives trigger testing.')

on conflict (id) do nothing;

-- ── Default budget categories for the construction test build ──
-- Mirrors the 8-category structure the portal expects.
insert into budget_categories (client_id, name, total, spent, status, sort_order, sub_categories) values
('stagingbuild', 'Design & Planning',            15000,  15000, 'complete', 1, '[]'),
('stagingbuild', 'Construction Costs',          260000, 118000, 'active',   2, '[]'),
('stagingbuild', 'Mechanical Systems',           60000,      0, 'pending',  3, '[]'),
('stagingbuild', 'Interior Finishes',            80000,      0, 'pending',  4, '[]'),
('stagingbuild', 'Exterior Work',                45000,      0, 'pending',  5, '[]'),
('stagingbuild', 'Utilities & Hookups',          20000,      0, 'pending',  6, '[]'),
('stagingbuild', 'Miscellaneous',                15000,      0, 'pending',  7, '[]'),
('stagingbuild', 'Other Costs & Management Fee', 30000,      0, 'pending',  8, '[]')
on conflict do nothing;

-- ── A couple of manual milestones so the timeline view renders ──
insert into milestones (client_id, title, date, note, done, sort_order) values
('stagingbuild', 'Foundation Poured', '2026-03-20', 'Footings + stem walls complete', true,  1),
('stagingbuild', 'Framing Complete',  '2026-05-15', 'Rough framing + roof deck',       false, 2),
('stagingbuild', 'Dry-In',            '2026-06-10', 'Windows + roofing watertight',    false, 3)
on conflict do nothing;
