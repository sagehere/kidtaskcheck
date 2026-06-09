ALTER TABLE feedback_templates ADD COLUMN is_remediable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback_templates ADD COLUMN remedy_condition TEXT NOT NULL DEFAULT '';
ALTER TABLE feedback_templates ADD COLUMN remedy_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback_templates ADD COLUMN remedy_deadline_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE point_ledger ADD COLUMN effective_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE point_ledger ADD COLUMN frozen_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE point_ledger ADD COLUMN freeze_status TEXT NOT NULL DEFAULT '';
ALTER TABLE point_ledger ADD COLUMN remedy_condition TEXT NOT NULL DEFAULT '';
ALTER TABLE point_ledger ADD COLUMN remedy_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE point_ledger ADD COLUMN remedy_deadline_at TEXT;
ALTER TABLE point_ledger ADD COLUMN remedied_at TEXT;
ALTER TABLE point_ledger ADD COLUMN settled_at TEXT;

UPDATE point_ledger SET effective_amount=amount WHERE effective_amount=0 AND amount<>0;

ALTER TABLE parent_ai_service_settings ADD COLUMN checklist_image_prompt TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ai_print_checklist_image_jobs (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  job_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  error_code TEXT,
  image_url TEXT,
  format TEXT NOT NULL DEFAULT 'jpeg',
  filename TEXT NOT NULL DEFAULT '',
  prompt_preview TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  next_attempt_at TEXT,
  locked_until TEXT,
  UNIQUE(parent_id, child_id, job_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_print_checklist_jobs_ready
  ON ai_print_checklist_image_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_print_checklist_jobs_parent
  ON ai_print_checklist_image_jobs(parent_id, child_id, job_key);
