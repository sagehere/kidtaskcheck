ALTER TABLE tasks ADD COLUMN enabled_weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]';
ALTER TABLE rewards ADD COLUMN redeem_weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]';
ALTER TABLE achievements ADD COLUMN unlock_reward_id TEXT REFERENCES rewards(id);
ALTER TABLE reward_redemptions ADD COLUMN hidden_from_child_at TEXT;
ALTER TABLE notifications ADD COLUMN requires_ack INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reward_prerequisites (
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  required_count INTEGER NOT NULL DEFAULT 1 CHECK(required_count >= 1),
  PRIMARY KEY (reward_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_prerequisites_reward
  ON reward_prerequisites(reward_id);

CREATE INDEX IF NOT EXISTS idx_redemptions_child_status
  ON reward_redemptions(child_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_submissions_child_task_status
  ON task_submissions(child_id, task_id, status);
