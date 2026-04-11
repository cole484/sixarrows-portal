-- ============================================================
--  SIX ARROWS — Task Template Library (57 tasks, 9 phases)
--  Run after schedule-schema.sql
--  Deterministic UUIDs: 00000000-0000-4000-8000-0000000000XX
-- ============================================================

-- Helper: short alias for the UUID pattern
-- seq 1  → 00000000-0000-4000-8000-000000000001
-- seq 57 → 00000000-0000-4000-8000-000000000057

INSERT INTO task_templates (id, task_name, phase, trade, workstream, default_duration_days, lead_time_days, is_long_lead, is_milestone, is_gate, sequence_order, selections_gate, default_blocked_by) VALUES

-- ── Phase 1: Preconstruction ────────────────────────────────
('00000000-0000-4000-8000-000000000001', 'Permits & approvals',
 'Preconstruction', 'GC', 'both', 14, 0, false, false, true, 1, NULL, '{}'),

('00000000-0000-4000-8000-000000000002', 'Survey & staking',
 'Preconstruction', 'Surveyor', 'exterior', 3, 7, false, false, false, 2, NULL,
 '{"00000000-0000-4000-8000-000000000001"}'),

('00000000-0000-4000-8000-000000000003', 'Temporary utilities setup',
 'Preconstruction', 'GC', 'both', 2, 0, false, false, false, 3, NULL,
 '{"00000000-0000-4000-8000-000000000001"}'),

('00000000-0000-4000-8000-000000000004', 'Material takeoffs & ordering',
 'Preconstruction', 'GC', 'both', 5, 0, false, false, false, 4, NULL,
 '{"00000000-0000-4000-8000-000000000001"}'),

('00000000-0000-4000-8000-000000000005', 'Long-lead material orders',
 'Preconstruction', 'GC', 'both', 1, 42, true, false, false, 5, NULL,
 '{"00000000-0000-4000-8000-000000000004"}'),

('00000000-0000-4000-8000-000000000006', 'Construction dumpster & portable toilet',
 'Preconstruction', 'GC', 'both', 1, 3, false, false, false, 6, NULL,
 '{"00000000-0000-4000-8000-000000000001"}'),

('00000000-0000-4000-8000-000000000007', 'Pre-construction meeting',
 'Preconstruction', 'GC', 'both', 1, 0, false, true, false, 7, NULL,
 '{"00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000004"}'),

-- ── Phase 2: Sitework ───────────────────────────────────────
('00000000-0000-4000-8000-000000000008', 'Clear & grub lot',
 'Sitework', 'Excavation', 'exterior', 2, 3, false, false, false, 8, NULL,
 '{"00000000-0000-4000-8000-000000000007"}'),

('00000000-0000-4000-8000-000000000009', 'Rough grade & pad prep',
 'Sitework', 'Excavation', 'exterior', 3, 0, false, false, false, 9, NULL,
 '{"00000000-0000-4000-8000-000000000008"}'),

('00000000-0000-4000-8000-000000000010', 'Utility trenching',
 'Sitework', 'Utilities', 'exterior', 3, 5, false, false, false, 10, NULL,
 '{"00000000-0000-4000-8000-000000000009"}'),

('00000000-0000-4000-8000-000000000011', 'Erosion control installation',
 'Sitework', 'GC', 'exterior', 1, 0, false, false, false, 11, NULL,
 '{"00000000-0000-4000-8000-000000000008"}'),

('00000000-0000-4000-8000-000000000012', 'Temporary drive / access road',
 'Sitework', 'Excavation', 'exterior', 1, 0, false, false, false, 12, NULL,
 '{"00000000-0000-4000-8000-000000000009"}'),

-- ── Phase 3: Foundation ─────────────────────────────────────
('00000000-0000-4000-8000-000000000013', 'Footings layout & dig',
 'Foundation', 'Foundation', 'both', 2, 0, false, false, false, 13, NULL,
 '{"00000000-0000-4000-8000-000000000009","00000000-0000-4000-8000-000000000010"}'),

('00000000-0000-4000-8000-000000000014', 'Footing pour',
 'Foundation', 'Foundation', 'both', 1, 0, false, false, false, 14, NULL,
 '{"00000000-0000-4000-8000-000000000013"}'),

('00000000-0000-4000-8000-000000000015', 'Foundation wall pour / block',
 'Foundation', 'Foundation', 'both', 3, 0, false, false, false, 15, NULL,
 '{"00000000-0000-4000-8000-000000000014"}'),

('00000000-0000-4000-8000-000000000016', 'Waterproofing & drain tile',
 'Foundation', 'Foundation', 'both', 2, 0, false, false, false, 16, NULL,
 '{"00000000-0000-4000-8000-000000000015"}'),

('00000000-0000-4000-8000-000000000017', 'Slab / basement floor pour',
 'Foundation', 'Foundation', 'both', 2, 0, false, false, false, 17, NULL,
 '{"00000000-0000-4000-8000-000000000016"}'),

('00000000-0000-4000-8000-000000000018', 'Foundation backfill',
 'Foundation', 'Excavation', 'exterior', 1, 0, false, false, false, 18, NULL,
 '{"00000000-0000-4000-8000-000000000016"}'),

('00000000-0000-4000-8000-000000000019', 'Foundation inspection',
 'Foundation', 'Inspector', 'both', 1, 2, false, true, true, 19, NULL,
 '{"00000000-0000-4000-8000-000000000017","00000000-0000-4000-8000-000000000018"}'),

-- ── Phase 4: Framing & Dry-in ───────────────────────────────
('00000000-0000-4000-8000-000000000020', 'Floor system / subfloor',
 'Framing & Dry-in', 'Framing', 'both', 3, 0, false, false, false, 20, NULL,
 '{"00000000-0000-4000-8000-000000000019"}'),

('00000000-0000-4000-8000-000000000021', 'Wall framing',
 'Framing & Dry-in', 'Framing', 'both', 7, 0, false, false, false, 21, NULL,
 '{"00000000-0000-4000-8000-000000000020"}'),

('00000000-0000-4000-8000-000000000022', 'Roof framing / trusses',
 'Framing & Dry-in', 'Framing', 'both', 5, 14, true, false, false, 22, NULL,
 '{"00000000-0000-4000-8000-000000000021"}'),

('00000000-0000-4000-8000-000000000023', 'Window & exterior door install',
 'Framing & Dry-in', 'Framing', 'exterior', 3, 21, true, false, false, 23, NULL,
 '{"00000000-0000-4000-8000-000000000022"}'),

('00000000-0000-4000-8000-000000000024', 'Roof sheathing & underlayment',
 'Framing & Dry-in', 'Roofing', 'exterior', 3, 0, false, false, false, 24, NULL,
 '{"00000000-0000-4000-8000-000000000022"}'),

('00000000-0000-4000-8000-000000000025', 'Roofing install',
 'Framing & Dry-in', 'Roofing', 'exterior', 4, 5, false, false, false, 25, 'exterior_finishes',
 '{"00000000-0000-4000-8000-000000000024"}'),

('00000000-0000-4000-8000-000000000026', 'Soffit & fascia',
 'Framing & Dry-in', 'Siding', 'exterior', 3, 0, false, false, false, 26, 'exterior_finishes',
 '{"00000000-0000-4000-8000-000000000024"}'),

('00000000-0000-4000-8000-000000000027', 'House wrap / WRB',
 'Framing & Dry-in', 'Framing', 'exterior', 1, 0, false, false, false, 27, NULL,
 '{"00000000-0000-4000-8000-000000000023"}'),

('00000000-0000-4000-8000-000000000028', 'Framing inspection',
 'Framing & Dry-in', 'Inspector', 'both', 1, 2, false, true, true, 28, NULL,
 '{"00000000-0000-4000-8000-000000000021","00000000-0000-4000-8000-000000000022","00000000-0000-4000-8000-000000000023"}'),

-- ── Phase 5: MEP Rough-ins ──────────────────────────────────
('00000000-0000-4000-8000-000000000029', 'Plumbing rough-in',
 'MEP Rough-ins', 'Plumber', 'interior', 5, 3, false, false, false, 29, 'plumbing',
 '{"00000000-0000-4000-8000-000000000028"}'),

('00000000-0000-4000-8000-000000000030', 'Electrical rough-in',
 'MEP Rough-ins', 'Electrician', 'interior', 5, 3, false, false, false, 30, 'lighting',
 '{"00000000-0000-4000-8000-000000000028"}'),

('00000000-0000-4000-8000-000000000031', 'HVAC rough-in',
 'MEP Rough-ins', 'HVAC', 'interior', 5, 5, false, false, false, 31, NULL,
 '{"00000000-0000-4000-8000-000000000028"}'),

('00000000-0000-4000-8000-000000000032', 'Low-voltage / data rough-in',
 'MEP Rough-ins', 'Electrician', 'interior', 2, 0, false, false, false, 32, NULL,
 '{"00000000-0000-4000-8000-000000000030"}'),

('00000000-0000-4000-8000-000000000033', 'Fireplace install',
 'MEP Rough-ins', 'Fireplace', 'interior', 2, 14, true, false, false, 33, 'fireplace',
 '{"00000000-0000-4000-8000-000000000028"}'),

('00000000-0000-4000-8000-000000000034', 'Garage door install',
 'MEP Rough-ins', 'GC', 'exterior', 1, 14, true, false, false, 34, 'appliances',
 '{"00000000-0000-4000-8000-000000000027"}'),

('00000000-0000-4000-8000-000000000035', 'MEP rough-in inspection',
 'MEP Rough-ins', 'Inspector', 'interior', 1, 2, false, true, true, 35, NULL,
 '{"00000000-0000-4000-8000-000000000029","00000000-0000-4000-8000-000000000030","00000000-0000-4000-8000-000000000031"}'),

-- ── Phase 6: Insulation & Drywall ───────────────────────────
('00000000-0000-4000-8000-000000000036', 'Insulation install',
 'Insulation & Drywall', 'Insulation', 'interior', 3, 3, false, false, false, 36, NULL,
 '{"00000000-0000-4000-8000-000000000035"}'),

('00000000-0000-4000-8000-000000000037', 'Insulation inspection',
 'Insulation & Drywall', 'Inspector', 'interior', 1, 2, false, false, true, 37, NULL,
 '{"00000000-0000-4000-8000-000000000036"}'),

('00000000-0000-4000-8000-000000000038', 'Drywall hang',
 'Insulation & Drywall', 'Drywall', 'interior', 5, 3, false, false, false, 38, NULL,
 '{"00000000-0000-4000-8000-000000000037"}'),

('00000000-0000-4000-8000-000000000039', 'Drywall mud & texture',
 'Insulation & Drywall', 'Drywall', 'interior', 5, 0, false, false, false, 39, NULL,
 '{"00000000-0000-4000-8000-000000000038"}'),

('00000000-0000-4000-8000-000000000040', 'Drywall sanding & prime coat',
 'Insulation & Drywall', 'Drywall', 'interior', 3, 0, false, false, false, 40, NULL,
 '{"00000000-0000-4000-8000-000000000039"}'),

-- ── Phase 7: Interior Finishes ──────────────────────────────
('00000000-0000-4000-8000-000000000041', 'Cabinet install',
 'Interior Finishes', 'Cabinetry', 'interior', 4, 28, true, false, false, 41, 'hardware',
 '{"00000000-0000-4000-8000-000000000040"}'),

('00000000-0000-4000-8000-000000000042', 'Countertop template & install',
 'Interior Finishes', 'Countertops', 'interior', 5, 14, true, false, false, 42, 'countertops',
 '{"00000000-0000-4000-8000-000000000041"}'),

('00000000-0000-4000-8000-000000000043', 'Interior trim & millwork',
 'Interior Finishes', 'Trim', 'interior', 7, 7, false, false, false, 43, 'doors',
 '{"00000000-0000-4000-8000-000000000040"}'),

('00000000-0000-4000-8000-000000000044', 'Interior door hang',
 'Interior Finishes', 'Trim', 'interior', 2, 7, false, false, false, 44, 'doors',
 '{"00000000-0000-4000-8000-000000000043"}'),

('00000000-0000-4000-8000-000000000045', 'Tile install',
 'Interior Finishes', 'Tile', 'interior', 5, 14, true, false, false, 45, 'tile',
 '{"00000000-0000-4000-8000-000000000040"}'),

('00000000-0000-4000-8000-000000000046', 'Hardwood / flooring install',
 'Interior Finishes', 'Flooring', 'interior', 5, 14, true, false, false, 46, 'flooring',
 '{"00000000-0000-4000-8000-000000000040","00000000-0000-4000-8000-000000000045"}'),

('00000000-0000-4000-8000-000000000047', 'Paint finish coats',
 'Interior Finishes', 'Painter', 'interior', 5, 3, false, false, false, 47, 'paint',
 '{"00000000-0000-4000-8000-000000000043","00000000-0000-4000-8000-000000000044"}'),

('00000000-0000-4000-8000-000000000048', 'Plumbing fixtures trim-out',
 'Interior Finishes', 'Plumber', 'interior', 2, 7, false, false, false, 48, 'plumbing',
 '{"00000000-0000-4000-8000-000000000042","00000000-0000-4000-8000-000000000045"}'),

('00000000-0000-4000-8000-000000000049', 'Electrical fixtures trim-out',
 'Interior Finishes', 'Electrician', 'interior', 2, 7, false, false, false, 49, 'lighting',
 '{"00000000-0000-4000-8000-000000000047"}'),

('00000000-0000-4000-8000-000000000050', 'HVAC trim-out & startup',
 'Interior Finishes', 'HVAC', 'interior', 2, 0, false, false, false, 50, NULL,
 '{"00000000-0000-4000-8000-000000000047"}'),

-- ── Phase 8: Exterior Finishes ──────────────────────────────
('00000000-0000-4000-8000-000000000051', 'Siding / masonry install',
 'Exterior Finishes', 'Siding', 'exterior', 10, 14, true, false, false, 51, 'exterior_finishes',
 '{"00000000-0000-4000-8000-000000000027"}'),

('00000000-0000-4000-8000-000000000052', 'Exterior paint / stain',
 'Exterior Finishes', 'Painter', 'exterior', 4, 3, false, false, false, 52, 'paint',
 '{"00000000-0000-4000-8000-000000000051"}'),

('00000000-0000-4000-8000-000000000053', 'Flatwork — porches, drives, walks',
 'Exterior Finishes', 'Concrete', 'exterior', 4, 5, false, false, false, 53, NULL,
 '{"00000000-0000-4000-8000-000000000018","00000000-0000-4000-8000-000000000051"}'),

('00000000-0000-4000-8000-000000000054', 'Final grade & landscaping',
 'Exterior Finishes', 'Landscaper', 'exterior', 3, 7, false, false, false, 54, NULL,
 '{"00000000-0000-4000-8000-000000000053"}'),

-- ── Phase 9: Closeout ───────────────────────────────────────
('00000000-0000-4000-8000-000000000055', 'Appliance install',
 'Closeout', 'GC', 'interior', 2, 14, true, false, false, 55, 'appliances',
 '{"00000000-0000-4000-8000-000000000042","00000000-0000-4000-8000-000000000046"}'),

('00000000-0000-4000-8000-000000000056', 'Final inspections',
 'Closeout', 'Inspector', 'both', 2, 3, false, false, true, 56, NULL,
 '{"00000000-0000-4000-8000-000000000046","00000000-0000-4000-8000-000000000047","00000000-0000-4000-8000-000000000048","00000000-0000-4000-8000-000000000049","00000000-0000-4000-8000-000000000050","00000000-0000-4000-8000-000000000052","00000000-0000-4000-8000-000000000054","00000000-0000-4000-8000-000000000055"}'),

('00000000-0000-4000-8000-000000000057', 'Punch list & closeout',
 'Closeout', 'GC', 'both', 5, 0, false, true, false, 57, NULL,
 '{"00000000-0000-4000-8000-000000000056"}');
