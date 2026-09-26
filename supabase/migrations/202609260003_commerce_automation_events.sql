CREATE TABLE IF NOT EXISTS automation_event_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  phone TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_event_receipts_account_created
  ON automation_event_receipts(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_event_receipts_account_type
  ON automation_event_receipts(account_id, event_type, created_at DESC);

ALTER TABLE automation_event_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));
