ALTER TABLE ai_generation_queue ADD COLUMN error_code TEXT;
ALTER TABLE ai_generation_queue ADD COLUMN next_attempt_at TEXT;
ALTER TABLE ai_generation_queue ADD COLUMN locked_until TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_queue_unique_job ON ai_generation_queue(parent_id, child_id, type, period_key);
CREATE INDEX IF NOT EXISTS idx_ai_queue_ready ON ai_generation_queue(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS system_error_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'error' CHECK(level IN ('error', 'warning')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  status INTEGER,
  method TEXT,
  path TEXT,
  actor_type TEXT,
  actor_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_created ON system_error_logs(created_at DESC);
