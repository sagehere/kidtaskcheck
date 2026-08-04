CREATE TABLE IF NOT EXISTS task_submission_deadline_exemptions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, child_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_task_deadline_exemptions_child
  ON task_submission_deadline_exemptions(child_id, period_key);
CREATE INDEX IF NOT EXISTS idx_task_deadline_exemptions_parent
  ON task_submission_deadline_exemptions(parent_id, period_key);
