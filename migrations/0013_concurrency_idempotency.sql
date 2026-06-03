-- Partial unique index to prevent duplicate ledger entries for business sources.
-- Excludes praise/criticism whose source_id is template ID (allows multiple uses).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_business_source
  ON point_ledger(source_type, source_id)
  WHERE source_type IN ('task', 'reward', 'reward_cancel', 'reward_refund', 'feedback_recall');

-- Index for concurrency-safe period-based queries
CREATE INDEX IF NOT EXISTS idx_redemptions_reward_status
  ON reward_redemptions(reward_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_submissions_task_status
  ON task_submissions(task_id, child_id, status, submitted_at);
