ALTER TABLE task_sets ADD COLUMN window_type TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE task_sets ADD COLUMN recurrence_started_at TEXT;
ALTER TABLE task_sets ADD COLUMN recurrence_stopped_at TEXT;

ALTER TABLE task_set_settlements ADD COLUMN cycle_key TEXT;
ALTER TABLE task_set_settlements ADD COLUMN cycle_start_at TEXT;
ALTER TABLE task_set_settlements ADD COLUMN cycle_end_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_set_settlements_cycle
  ON task_set_settlements(task_set_id, child_id, cycle_key)
  WHERE cycle_key IS NOT NULL;
