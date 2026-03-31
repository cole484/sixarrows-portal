-- ============================================================
--  SIX ARROWS — Seed Current Clients
--  Run AFTER schema.sql in Supabase > SQL Editor
-- ============================================================

-- ── Insert all current clients ──────────────────────────────

insert into clients (id, email, password, client_name, project_name, location, status_type, phase_label, notion_tracker_page_id, selections_client_key, groundbreaking_date, budget_total, budget_committed, construction_pct, timeline_start, timeline_target, quick_summary)
values

('kandaswamy', 'kandaswamy@client.com', 'build2026',
 'Kandaswamy Family', 'Custom Home', 'Elizabethtown, KY',
 'sab', 'Phase 2 — Selections & Specifications',
 '2fb4737b-ea6f-80dc-9b3b-c4fac53c95ff',
 'kandaswamy_family', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal.'),

('woods', 'woods@client.com', 'court2026',
 'Walter & Leslie Wood', 'Custom Home', 'Bowling Green, KY',
 'construction', 'Under Construction',
 null, 'walter_leslie_wood', '2025-10-14',
 238400, 211160, 58, 'Oct 2025', 'May 2026',
 'Your build is underway. Track progress, budget, and updates here.'),

('nagornay', 'nagornay@client.com', 'nagornay2026',
 'Amber & Alex Nagornay', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 '2d14737b-ea6f-8095-bd88-db56917e914f',
 'nagornay', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal.'),

('johnson', 'johnson@client.com', 'johnson2026',
 'James & Dana Johnson', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 2 — Selections & Specifications',
 '2d14737b-ea6f-8010-a5bf-dae373403326',
 'johnson', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal.'),

('hoops', 'hoops@client.com', 'hoops2026',
 'Joseph & Lisa Hoops', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 '2df4737b-ea6f-8011-b095-f3e5ac22137c',
 'hoops', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal.'),

('howard', 'howard@client.com', 'howard2026',
 'Derek & Amanda Howard', 'Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 '2f84737b-ea6f-80b8-90dc-edb340717f47',
 'howard', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal.'),

('testclient', 'test@client.com', 'test2026',
 'Test Client', 'Mock Custom Home', 'Bowling Green, KY',
 'sab', 'Phase 1 — Design & Architecture',
 '3324737b-ea6f-81d3-9c4f-d5fa8aebdeea',
 'testclient', '', 0, 0, 0, 'TBD', 'TBD',
 'Welcome to your Six Arrows client portal. We are just getting started!')

on conflict (id) do nothing;

-- ── Seed Woods budget categories ────────────────────────────
insert into budget_categories (client_id, name, total, spent, status, sort_order, sub_categories) values
('woods', 'Design & Planning',            5800,  5800,  'complete', 1, '[{"name":"Surveying & Permits","total":1800,"spent":1800},{"name":"Interior Design","total":4000,"spent":4000}]'),
('woods', 'Construction Costs',           89500, 89500, 'complete', 2, '[{"name":"Foundation","total":18000,"spent":18000},{"name":"Framing","total":38000,"spent":38000},{"name":"Roofing","total":14500,"spent":14500},{"name":"Windows & Doors","total":12000,"spent":12000},{"name":"Exterior Siding & Masonry","total":7000,"spent":7000}]'),
('woods', 'Mechanical Systems',           38200, 38200, 'complete', 3, '[{"name":"Plumbing","total":14200,"spent":14200},{"name":"Electrical","total":13000,"spent":13000},{"name":"HVAC","total":11000,"spent":11000}]'),
('woods', 'Interior Finishes',            52400, 38000, 'active',   4, '[{"name":"Drywall","total":8200,"spent":8200},{"name":"Paint & Staining","total":6400,"spent":6400},{"name":"Flooring","total":12000,"spent":7800},{"name":"Cabinetry","total":14000,"spent":9800},{"name":"Countertops","total":5800,"spent":5800},{"name":"Trim Work & Moldings","total":3400,"spent":0},{"name":"Appliances","total":2600,"spent":0}]'),
('woods', 'Exterior Work',                14500, 9200,  'active',   5, '[{"name":"Dirt & Grading","total":6500,"spent":6500},{"name":"Rock & Concrete","total":5000,"spent":2700},{"name":"Final Grade & Landscaping","total":3000,"spent":0}]'),
('woods', 'Utilities & Hookups',          11200, 11200, 'complete', 6, '[{"name":"Water & Sewer Lines","total":4800,"spent":4800},{"name":"Electrical Connection","total":3200,"spent":3200},{"name":"Gas Connection","total":3200,"spent":3200}]'),
('woods', 'Miscellaneous',                8400,  8400,  'complete', 7, '[{"name":"Contingency Fund","total":8400,"spent":8400}]'),
('woods', 'Other Costs & Management Fee', 18400, 10860, 'active',   8, '[{"name":"Temp Utilities","total":1200,"spent":1200},{"name":"Dumpsters & Toilet","total":2400,"spent":2400},{"name":"Site Clean Up & Builders Risk","total":2800,"spent":2800},{"name":"Six Arrows Management Fee","total":12000,"spent":4460}]')
on conflict do nothing;

-- ── Seed Woods milestones ────────────────────────────────────
insert into milestones (client_id, title, date, note, done, sort_order) values
('woods', 'Foundation Complete',       'Nov 2, 2025',  'Footings and slab poured.',                         true,  1),
('woods', 'Framing Complete',          'Nov 22, 2025', 'Frame dried in, roof sheathing done.',              true,  2),
('woods', 'Mechanicals Roughed In',    'Dec 12, 2025', 'Plumbing, electrical, HVAC rough-in complete.',     true,  3),
('woods', 'Insulation & Drywall',      'Jan 8, 2026',  'Walls closed in, texture in progress.',             true,  4),
('woods', 'Flooring & Cabinets',       'Mar 14, 2026', 'Hardwood install started, cabinets delivered.',     false, 5),
('woods', 'Punch List & Closeout',     'Apr 3, 2026',  'Closeout list and final trade touches.',            false, 6),
('woods', 'Target Completion',         'May 3, 2026',  'Project closeout and walkthrough.',                 false, 7)
on conflict do nothing;

-- ── Seed Woods updates ───────────────────────────────────────
insert into updates (client_id, title, body, date, approved, manual) values
('woods', 'Humidity Follow-Up',
 'Reviewing whether HVAC setup is running long enough to control moisture — dedicated dehumidifier may be needed.',
 'Mar 19, 2026', true, true),
('woods', 'Insulation and Airflow Review',
 'Team reviewed building envelope conditions and began evaluating causes for the reported humidity level.',
 'Mar 14, 2026', true, true)
on conflict do nothing;

-- ── Seed Kandaswamy updates ──────────────────────────────────
insert into updates (client_id, title, body, date, approved, manual) values
('kandaswamy', 'Budget Revision Posted',
 'We updated the working budget to reflect current assumptions around exterior materials, basement scope, and contingency planning.',
 'Mar 22, 2026', true, true),
('kandaswamy', 'Plan Review Complete',
 'We completed another review pass of the plan and identified the remaining decisions needed to finalize scope.',
 'Mar 20, 2026', true, true),
('kandaswamy', 'Wave 2 Selections Locked',
 'Cabinet, flooring, and tile selections are finalized. Wave 3 is now the active focus.',
 'Mar 14, 2026', true, true)
on conflict do nothing;

select 'Seed complete — ' || count(*) || ' clients loaded' as result from clients;

-- ── Seed default budget categories for SAB clients ──────────
insert into budget_categories (client_id, name, total, spent, status, sort_order, sub_categories)
values
('kandaswamy', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('kandaswamy', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('kandaswamy', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('kandaswamy', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('kandaswamy', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('kandaswamy', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('kandaswamy', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('kandaswamy', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]'),
('nagornay', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('nagornay', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('nagornay', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('nagornay', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('nagornay', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('nagornay', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('nagornay', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('nagornay', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]'),
('johnson', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('johnson', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('johnson', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('johnson', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('johnson', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('johnson', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('johnson', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('johnson', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]'),
('hoops', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('hoops', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('hoops', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('hoops', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('hoops', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('hoops', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('hoops', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('hoops', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]'),
('howard', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('howard', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('howard', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('howard', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('howard', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('howard', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('howard', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('howard', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]'),
('testclient', 'Design & Planning', 0, 0, 'pending', 1, '[]'),
('testclient', 'Construction Costs', 0, 0, 'pending', 2, '[]'),
('testclient', 'Mechanical Systems', 0, 0, 'pending', 3, '[]'),
('testclient', 'Interior Finishes', 0, 0, 'pending', 4, '[]'),
('testclient', 'Exterior Work', 0, 0, 'pending', 5, '[]'),
('testclient', 'Utilities & Hookups', 0, 0, 'pending', 6, '[]'),
('testclient', 'Miscellaneous', 0, 0, 'pending', 7, '[]'),
('testclient', 'Other Costs & Management Fee', 0, 0, 'pending', 8, '[]')
on conflict do nothing;
