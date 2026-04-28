-- ============================================================
--  SIX ARROWS — Phase B1: Contractor Messaging Infrastructure
--  Run in Supabase > SQL Editor > New Query
--
--  Adds contractor_messages — the outbound/inbound message record
--  that powers drafts, approvals, and contractor confirmations.
-- ============================================================

CREATE TABLE IF NOT EXISTS contractor_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text NOT NULL REFERENCES clients(id)          ON DELETE CASCADE,
  task_id             uuid NOT NULL REFERENCES project_schedule(id) ON DELETE CASCADE,
  subcontractor_id    uuid REFERENCES subcontractors(id)            ON DELETE SET NULL,

  -- Snapshot of contact info at draft time (survives sub record edits)
  contact_name        text,
  contact_phone       text,
  contact_email       text,

  direction           text NOT NULL DEFAULT 'outbound'
                      CHECK (direction IN ('outbound','inbound')),
  channel             text NOT NULL DEFAULT 'sms'
                      CHECK (channel IN ('sms','email','copy_paste')),
  purpose             text NOT NULL DEFAULT 'initial_schedule'
                      CHECK (purpose IN ('initial_schedule','reschedule','reminder','confirmation_followup')),

  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_approval','sent','delivered','responded','failed')),

  body                text NOT NULL,
  confirm_token       text UNIQUE NOT NULL,

  response            text CHECK (response IN ('confirmed','declined','alternate_proposed')),
  proposed_start      date,
  proposed_notes      text,

  sent_at             timestamptz,
  responded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cm_project        ON contractor_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_cm_task           ON contractor_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_cm_status         ON contractor_messages(status);
CREATE INDEX IF NOT EXISTS idx_cm_token          ON contractor_messages(confirm_token);

-- Reuse the existing update_updated_at() trigger function (created in schema.sql)
CREATE TRIGGER contractor_messages_updated_at
  BEFORE UPDATE ON contractor_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE contractor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON contractor_messages FOR ALL USING (true) WITH CHECK (true);
