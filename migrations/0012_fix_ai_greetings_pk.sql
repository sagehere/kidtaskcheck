DROP TABLE IF EXISTS ai_child_greetings;

CREATE TABLE IF NOT EXISTS ai_child_greetings (
  child_id TEXT NOT NULL REFERENCES children(id),
  previous_week_key TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  greeting TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, previous_week_key, config_hash)
);
