ALTER TABLE achievements ADD COLUMN target_category_id TEXT REFERENCES task_categories(id);
