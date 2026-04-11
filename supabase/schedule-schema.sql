-- ============================================================
--  SIX ARROWS — Construction Scheduling Engine Schema
--  Run this entire file in Supabase > SQL Editor > New Query
--  Requires: existing clients table + update_updated_at() function
-- ============================================================

-- ── Clients migration: add scheduling columns ───────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS build_start_date date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_end_date date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS computed_end_date date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS active_workstreams text[] DEFAULT '{exterior,interior}';

-- ── Task Templates ──────────────────────────────────────────
-- Master library of construction tasks. Seeded once, referenced
-- when instantiating a project schedule.
CREATE TABLE IF NOT EXISTS task_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name             text NOT NULL,
  phase                 text NOT NULL,
  trade                 text,
  workstream            text,          -- 'exterior', 'interior', 'both'
  default_duration_days integer NOT NULL DEFAULT 1,
  lead_time_days        integer NOT NULL DEFAULT 0,
  is_long_lead          boolean NOT NULL DEFAULT false,
  is_milestone          boolean NOT NULL DEFAULT false,
  is_gate               boolean NOT NULL DEFAULT false,
  sequence_order        integer NOT NULL,
  internal_scope        text,
  contractor_scope      text,
  client_scope          text,
  definition_of_done    text,
  selections_gate       text,          -- nullable — matches CATS key from selections-app
  default_blocked_by    text[],        -- array of template UUIDs
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Project Schedule ────────────────────────────────────────
-- Per-project task instances created from templates.
-- The CPM engine reads/writes planned dates and alerts here.
CREATE TABLE IF NOT EXISTS project_schedule (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_task_id      uuid REFERENCES task_templates(id),
  task_name             text NOT NULL,
  phase                 text NOT NULL,
  trade                 text,
  workstream            text,
  duration_days         integer NOT NULL DEFAULT 1,
  lead_time_days        integer NOT NULL DEFAULT 0,
  is_long_lead          boolean NOT NULL DEFAULT false,
  is_milestone          boolean NOT NULL DEFAULT false,
  is_gate               boolean NOT NULL DEFAULT false,
  sequence_order        integer NOT NULL,
  status                text NOT NULL DEFAULT 'not_started',
  planned_start         date,
  planned_finish        date,
  actual_start          date,
  actual_finish         date,
  assigned_contractor   text,
  contractor_confirmed  boolean NOT NULL DEFAULT false,
  internal_scope        text,
  contractor_scope      text,
  client_scope          text,
  definition_of_done    text,
  selections_gate       text,
  must_schedule_by      date,
  alert_level           text NOT NULL DEFAULT 'none',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ps_project ON project_schedule(project_id);
CREATE INDEX IF NOT EXISTS idx_ps_status  ON project_schedule(project_id, status);

-- Reuse the existing update_updated_at() trigger function
CREATE TRIGGER project_schedule_updated_at
  BEFORE UPDATE ON project_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Task Dependencies ───────────────────────────────────────
-- Directed edges: task_id is blocked by blocked_by_task_id.
CREATE TABLE IF NOT EXISTS task_dependencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_id            uuid NOT NULL REFERENCES project_schedule(id) ON DELETE CASCADE,
  blocked_by_task_id uuid NOT NULL REFERENCES project_schedule(id) ON DELETE CASCADE,
  UNIQUE(task_id, blocked_by_task_id)
);

CREATE INDEX IF NOT EXISTS idx_td_task       ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_td_blocked_by ON task_dependencies(blocked_by_task_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE task_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_schedule  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON task_templates    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON project_schedule  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON task_dependencies FOR ALL USING (true) WITH CHECK (true);
