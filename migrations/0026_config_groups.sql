CREATE TABLE IF NOT EXISTS config_groups (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_config_groups_parent
  ON config_groups(parent_id, updated_at DESC);
