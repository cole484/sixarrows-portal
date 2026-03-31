-- ============================================================
--  Fix Woods budget categories — complete subcategory lists
--  Run in Supabase > SQL Editor
-- ============================================================

-- Update each category with the complete subcategory list

-- Design & Planning
update budget_categories
set sub_categories = '[
  {"name":"Surveying & Permits","total":1800,"spent":1800},
  {"name":"Interior Design","total":4000,"spent":4000}
]'::jsonb
where client_id = 'woods' and name = 'Design & Planning';

-- Construction Costs
update budget_categories
set sub_categories = '[
  {"name":"Foundation","total":18000,"spent":18000},
  {"name":"Framing","total":38000,"spent":38000},
  {"name":"Roofing","total":14500,"spent":14500},
  {"name":"Windows & Doors","total":12000,"spent":12000},
  {"name":"Exterior Siding & Masonry","total":7000,"spent":7000},
  {"name":"Porches & Accents","total":0,"spent":0},
  {"name":"Exterior Painting","total":0,"spent":0}
]'::jsonb
where client_id = 'woods' and name = 'Construction Costs';

-- Mechanical Systems
update budget_categories
set sub_categories = '[
  {"name":"Plumbing","total":14200,"spent":14200},
  {"name":"Electrical","total":13000,"spent":13000},
  {"name":"HVAC","total":11000,"spent":11000},
  {"name":"Insulation","total":0,"spent":0}
]'::jsonb
where client_id = 'woods' and name = 'Mechanical Systems';

-- Interior Finishes
update budget_categories
set sub_categories = '[
  {"name":"Drywall","total":8200,"spent":8200},
  {"name":"Paint & Staining","total":6400,"spent":6400},
  {"name":"Tile & Masonry","total":0,"spent":0},
  {"name":"Flooring","total":12000,"spent":7800},
  {"name":"Cabinetry","total":14000,"spent":9800},
  {"name":"Countertops","total":5800,"spent":5800},
  {"name":"Interior Doors","total":0,"spent":0},
  {"name":"Trim Work & Moldings","total":3400,"spent":0},
  {"name":"Fireplaces","total":0,"spent":0},
  {"name":"Electrical Fixtures","total":0,"spent":0},
  {"name":"Plumbing Fixtures","total":0,"spent":0},
  {"name":"Appliances","total":2600,"spent":0},
  {"name":"Bathroom Fixtures","total":0,"spent":0},
  {"name":"Closet Systems","total":0,"spent":0}
]'::jsonb
where client_id = 'woods' and name = 'Interior Finishes';

-- Exterior Work
update budget_categories
set sub_categories = '[
  {"name":"Dirt & Grading","total":6500,"spent":6500},
  {"name":"Rock & Concrete","total":5000,"spent":2700},
  {"name":"Final Grade & Landscaping","total":3000,"spent":0}
]'::jsonb
where client_id = 'woods' and name = 'Exterior Work';

-- Utilities & Hookups
update budget_categories
set sub_categories = '[
  {"name":"Water & Sewer Lines","total":4800,"spent":4800},
  {"name":"Septic System","total":0,"spent":0},
  {"name":"Water Meter","total":0,"spent":0},
  {"name":"Utility Trenching","total":0,"spent":0},
  {"name":"Gas Connection","total":3200,"spent":3200},
  {"name":"Electrical Connection","total":3200,"spent":3200}
]'::jsonb
where client_id = 'woods' and name = 'Utilities & Hookups';

-- Miscellaneous
update budget_categories
set sub_categories = '[
  {"name":"Contingency Fund","total":8400,"spent":8400}
]'::jsonb
where client_id = 'woods' and name = 'Miscellaneous';

-- Other Costs & Management Fee
update budget_categories
set sub_categories = '[
  {"name":"Temp Utilities","total":1200,"spent":1200},
  {"name":"Dumpsters & Toilet","total":2400,"spent":2400},
  {"name":"Site Clean Up & Builders Risk","total":2800,"spent":2800},
  {"name":"Six Arrows Management Fee","total":12000,"spent":4460}
]'::jsonb
where client_id = 'woods' and name = 'Other Costs & Management Fee';

-- Also fix status values to match portal expectations
-- (portal uses: pending / active / complete)
update budget_categories
set status = case
  when status = 'locked'    then 'complete'
  when status = 'reviewing' then 'active'
  else status
end
where client_id = 'woods';

select name, status, jsonb_array_length(sub_categories) as sub_count
from budget_categories
where client_id = 'woods'
order by sort_order;
