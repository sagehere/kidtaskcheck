ALTER TABLE task_sets ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'round';
ALTER TABLE task_sets ADD COLUMN window_start TEXT;
ALTER TABLE task_sets ADD COLUMN window_end TEXT;
ALTER TABLE task_sets ADD COLUMN window_weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]';

ALTER TABLE task_set_settlements ADD COLUMN status TEXT NOT NULL DEFAULT 'settled';
ALTER TABLE task_set_settlements ADD COLUMN resolved_at TEXT;
ALTER TABLE task_set_settlements ADD COLUMN resolved_by_type TEXT;
ALTER TABLE task_set_settlements ADD COLUMN resolved_by_id TEXT;
ALTER TABLE task_set_settlements ADD COLUMN resolved_by_label TEXT;

CREATE INDEX IF NOT EXISTS idx_task_set_settlements_status ON task_set_settlements(task_set_id, child_id, status);
