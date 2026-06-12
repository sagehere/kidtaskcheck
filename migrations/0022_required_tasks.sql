ALTER TABLE tasks ADD COLUMN is_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN required_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN required_penalty_points INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS task_required_penalties (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  required_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  penalty_points INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, child_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_task_required_penalties_child
  ON task_required_penalties(child_id, period_key);
CREATE INDEX IF NOT EXISTS idx_task_required_penalties_parent
  ON task_required_penalties(parent_id, period_key);
