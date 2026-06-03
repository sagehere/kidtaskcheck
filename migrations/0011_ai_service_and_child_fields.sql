-- Children table: add ai_enabled, gender, birth_date
ALTER TABLE children ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE children ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE children ADD COLUMN birth_date TEXT;

-- AI child greetings cache table
CREATE TABLE IF NOT EXISTS ai_child_greetings (
  child_id TEXT NOT NULL REFERENCES children(id),
  previous_week_key TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  greeting TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, previous_week_key, config_hash)
);
