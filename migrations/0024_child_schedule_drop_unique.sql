-- Drop UNIQUE(child_id, task_id) on child_schedule_items to allow
-- a task to appear multiple times in the schedule (e.g. daily tasks
-- with required_count > 1).
-- SQLite cannot ALTER TABLE DROP CONSTRAINT, so recreate the table.

CREATE TABLE IF NOT EXISTS child_schedule_items_new (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES child_schedule_slots(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO child_schedule_items_new (id, slot_id, child_id, task_id, sort_order, created_at, updated_at)
  SELECT id, slot_id, child_id, task_id, sort_order, created_at, updated_at
  FROM child_schedule_items;

DROP TABLE child_schedule_items;

ALTER TABLE child_schedule_items_new RENAME TO child_schedule_items;

CREATE INDEX IF NOT EXISTS idx_schedule_items_slot ON child_schedule_items(slot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_schedule_items_child_task ON child_schedule_items(child_id, task_id);
