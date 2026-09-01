CREATE TABLE IF NOT EXISTS child_task_wall_orders (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_child_task_wall_orders_child_sort
  ON child_task_wall_orders(child_id, sort_order);
