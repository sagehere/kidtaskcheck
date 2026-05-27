PRAGMA foreign_keys = OFF;

ALTER TABLE tasks ADD COLUMN limit_count INTEGER NOT NULL DEFAULT 1;

CREATE TABLE task_submissions_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task_submissions_new (
  id,
  task_id,
  child_id,
  parent_id,
  period_key,
  submitted_at,
  status,
  reviewed_at,
  review_note,
  created_at
)
SELECT
  id,
  task_id,
  child_id,
  parent_id,
  period_key,
  submitted_at,
  status,
  reviewed_at,
  review_note,
  created_at
FROM task_submissions;

DROP TABLE task_submissions;
ALTER TABLE task_submissions_new RENAME TO task_submissions;

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_submissions_parent_status ON task_submissions(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_task_child_period_status ON task_submissions(task_id, child_id, period_key, status);
