ALTER TABLE achievements ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'tasks_completed';
ALTER TABLE achievements ADD COLUMN window_type TEXT NOT NULL DEFAULT 'all_time';
ALTER TABLE achievements ADD COLUMN window_start TEXT;
ALTER TABLE achievements ADD COLUMN window_end TEXT;
ALTER TABLE achievements ADD COLUMN target_task_id TEXT REFERENCES tasks(id);

UPDATE achievements
SET rule_type = metric
WHERE metric IN ('total_earned', 'balance', 'tasks_completed', 'streak_days', 'redemptions');
