CREATE TABLE IF NOT EXISTS child_schedule_slots (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  start_minutes INTEGER NOT NULL CHECK(start_minutes>=0 AND start_minutes<1440),
  end_minutes INTEGER NOT NULL CHECK(end_minutes>0 AND end_minutes<=1440),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(end_minutes>start_minutes)
);

CREATE TABLE IF NOT EXISTS child_schedule_items (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES child_schedule_slots(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(child_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_slots_child ON child_schedule_slots(child_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_schedule_items_slot ON child_schedule_items(slot_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_schedule_items_child_task ON child_schedule_items(child_id, task_id);

ALTER TABLE parent_ai_service_settings ADD COLUMN schedule_image_prompt TEXT NOT NULL DEFAULT '';
