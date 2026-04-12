-- ============================================================
--  SIX ARROWS — Schedule Engine v2 Migration
--  Run after schedule-schema.sql + seed-task-templates.sql
--  Adds: subcontractors, task_notes, expanded statuses,
--        performance ratings, notes split, perf_notes
-- ============================================================

-- ── 1. Subcontractors directory ─────────────────────────────
CREATE TABLE IF NOT EXISTS subcontractors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  trade         text,
  phone         text,
  email         text,
  company       text,
  is_preferred  boolean NOT NULL DEFAULT false,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON subcontractors FOR ALL USING (true) WITH CHECK (true);

-- ── 2. Task notes / activity log ────────────────────────────
CREATE TABLE IF NOT EXISTS task_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES project_schedule(id) ON DELETE CASCADE,
  author        text NOT NULL DEFAULT 'PM',
  body          text NOT NULL,
  note_type     text NOT NULL DEFAULT 'general',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tn_task ON task_notes(task_id);

ALTER TABLE task_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON task_notes FOR ALL USING (true) WITH CHECK (true);

-- ── 3. project_schedule: rename notes → client_note ─────────
ALTER TABLE project_schedule RENAME COLUMN notes TO client_note;

-- ── 4. project_schedule: add new columns ────────────────────
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS internal_note text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES subcontractors(id);
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_schedule text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_invoice text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_communication text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_scope text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_cleanliness text;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS perf_notes text;

-- ── 5. Migrate status values ────────────────────────────────
-- not_started → needs_scheduling (matches Notion "Needs Scheduling")
UPDATE project_schedule SET status = 'needs_scheduling' WHERE status = 'not_started';

-- Update default
ALTER TABLE project_schedule ALTER COLUMN status SET DEFAULT 'needs_scheduling';

-- ── 6. Index for subcontractor lookups ──────────────────────
CREATE INDEX IF NOT EXISTS idx_ps_sub ON project_schedule(subcontractor_id);
