CREATE TABLE IF NOT EXISTS task_sets (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_type TEXT NOT NULL DEFAULT 'emoji',
  icon_value TEXT NOT NULL DEFAULT '🧩',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_set_members (
  task_set_id TEXT NOT NULL REFERENCES task_sets(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_set_id, task_id),
  UNIQUE(task_id)
);

CREATE TABLE IF NOT EXISTS task_set_settlements (
  id TEXT PRIMARY KEY,
  task_set_id TEXT NOT NULL REFERENCES task_sets(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  round_number INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_set_id, child_id, round_number)
);

CREATE TABLE IF NOT EXISTS task_set_settlement_items (
  settlement_id TEXT NOT NULL REFERENCES task_set_settlements(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES task_submissions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  approved_points INTEGER NOT NULL,
  PRIMARY KEY (settlement_id, submission_id),
  UNIQUE(submission_id)
);

ALTER TABLE task_submissions ADD COLUMN task_set_id TEXT REFERENCES task_sets(id);
ALTER TABLE task_submissions ADD COLUMN approved_points INTEGER;

CREATE INDEX IF NOT EXISTS idx_task_sets_parent ON task_sets(parent_id, is_active, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS idx_task_set_members_set ON task_set_members(task_set_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_task_set_settlements_child ON task_set_settlements(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_set_items_submission ON task_set_settlement_items(submission_id);
CREATE INDEX IF NOT EXISTS idx_submissions_task_set_progress ON task_submissions(task_set_id, child_id, status, submitted_at);
