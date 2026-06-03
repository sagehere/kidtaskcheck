-- 0012 was previously a DROP+CREATE of ai_child_greetings.
-- Changed to additive migration to avoid data loss.
-- The table is already created by 0011; this is now a no-op guard.
-- If columns need to be added in the future, use ALTER TABLE here.
CREATE TABLE IF NOT EXISTS ai_child_greetings (
  child_id TEXT NOT NULL REFERENCES children(id),
  previous_week_key TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  greeting TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, previous_week_key, config_hash)
);
