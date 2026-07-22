ALTER TABLE tasks ADD COLUMN required_remedy_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN required_remedy_condition TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN required_remedy_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN required_remedy_deadline_hours INTEGER NOT NULL DEFAULT 24;
