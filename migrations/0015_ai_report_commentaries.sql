-- AI Report Commentaries cache table
CREATE TABLE IF NOT EXISTS ai_report_commentaries (
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  period_type TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  commentary TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, period_key, period_type, config_hash)
);

-- Add report prompt fields to parent AI service settings
ALTER TABLE parent_ai_service_settings ADD COLUMN report_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE parent_ai_service_settings ADD COLUMN monthly_prompt TEXT NOT NULL DEFAULT '';
