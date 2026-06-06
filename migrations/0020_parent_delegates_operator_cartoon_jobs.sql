CREATE TABLE IF NOT EXISTS parent_delegates (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operator_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parent_delegates_parent ON parent_delegates(parent_id, status, deleted_at);

ALTER TABLE users ADD COLUMN operator_label TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN actor_label_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE point_ledger ADD COLUMN actor_type TEXT NOT NULL DEFAULT '';
ALTER TABLE point_ledger ADD COLUMN actor_id TEXT NOT NULL DEFAULT '';
ALTER TABLE point_ledger ADD COLUMN actor_label_snapshot TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ai_cartoon_report_jobs (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK(period_type IN ('weekly', 'monthly')),
  period_key TEXT NOT NULL,
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
  UNIQUE(parent_id, child_id, period_type, period_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_cartoon_jobs_ready ON ai_cartoon_report_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_cartoon_jobs_parent ON ai_cartoon_report_jobs(parent_id, child_id, period_type, period_key);
