-- ============================================================
--  SIX ARROWS — Automations Schema (Phase A)
--  Event log + action queue — foundation for the workflow engine
--  Run in Supabase > SQL Editor > New Query
-- ============================================================

-- ── events ─────────────────────────────────────────────────
-- Append-only log of everything that happens in the system.
-- Source of truth for automation rules and audit history.
CREATE TABLE IF NOT EXISTS events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type   text NOT NULL,                         -- e.g. 'task.status_changed', 'contractor.confirmed'
  task_id      uuid REFERENCES project_schedule(id) ON DELETE SET NULL,
  actor        text NOT NULL,                         -- 'pm:<email>' | 'contractor:<id>' | 'system:cpm' | 'client:<id>'
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- typed per event_type
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_project_time ON events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type         ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_task         ON events(task_id) WHERE task_id IS NOT NULL;

-- ── action_items ───────────────────────────────────────────
-- The PM's unified queue. Automations produce these; the PM
-- acts on them (approve, snooze, dismiss). `dedupe_key` prevents
-- a rule from creating a duplicate item when it re-fires.
CREATE TABLE IF NOT EXISTS action_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind                 text NOT NULL,                 -- 'approve_contractor_text', 'review_qc_complete', etc.
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('red','yellow','normal')),
  title                text NOT NULL,
  body                 text,
  task_id              uuid REFERENCES project_schedule(id) ON DELETE CASCADE,
  related_entity_type  text,                          -- 'contractor_message', 'client_update', 'qc_checklist'
  related_entity_id    uuid,
  status               text NOT NULL DEFAULT 'open'   CHECK (status IN ('open','snoozed','completed','dismissed')),
  due_at               timestamptz,
  snoozed_until        timestamptz,
  dedupe_key           text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  completed_by         text
);

CREATE INDEX IF NOT EXISTS idx_action_items_open
  ON action_items(project_id, priority, created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_action_items_snoozed
  ON action_items(snoozed_until)
  WHERE status = 'snoozed';

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON events       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON action_items FOR ALL USING (true) WITH CHECK (true);
