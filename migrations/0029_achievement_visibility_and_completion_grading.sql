ALTER TABLE child_achievements ADD COLUMN hidden_from_child_at TEXT;
ALTER TABLE tasks ADD COLUMN grading_mode TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE tasks ADD COLUMN completion_standards_json TEXT NOT NULL DEFAULT '[]';
