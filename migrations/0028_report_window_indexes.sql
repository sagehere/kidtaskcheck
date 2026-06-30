CREATE INDEX IF NOT EXISTS idx_ledger_child_parent_created ON point_ledger(child_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_child_parent_created_id ON point_ledger(child_id, parent_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_submissions_child_parent_submitted ON task_submissions(child_id, parent_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_child_parent_requested ON reward_redemptions(child_id, parent_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_child_achievements_child_unlocked ON child_achievements(child_id, unlocked_at);
