CREATE TABLE IF NOT EXISTS ai_scheduled_refresh_runs (
  job_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  triggered_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (job_type, period_key)
);
