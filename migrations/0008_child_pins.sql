CREATE TABLE IF NOT EXISTS child_pins (
  child_id TEXT NOT NULL REFERENCES children(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('task', 'reward')),
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_child_pins_item
  ON child_pins(item_type, item_id);
