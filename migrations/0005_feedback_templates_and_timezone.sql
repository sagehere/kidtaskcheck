CREATE TABLE IF NOT EXISTS feedback_templates (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('praise', 'criticism')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL CHECK(points >= 0),
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '✨',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_templates_parent
  ON feedback_templates(parent_id, kind, is_active, deleted_at);

ALTER TABLE task_categories ADD COLUMN source_system_id TEXT REFERENCES task_categories(id);

INSERT OR IGNORE INTO system_settings (key, value)
VALUES ('timezone_offset_minutes', '480');
