ALTER TABLE point_ledger ADD COLUMN revoked_at TEXT;
ALTER TABLE point_ledger ADD COLUMN revoke_ledger_id TEXT REFERENCES point_ledger(id);
ALTER TABLE point_ledger ADD COLUMN retention_until TEXT;

ALTER TABLE reward_redemptions ADD COLUMN refunded_at TEXT;
ALTER TABLE reward_redemptions ADD COLUMN retention_until TEXT;

CREATE TABLE IF NOT EXISTS activity_archives (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  month_key TEXT NOT NULL,
  net_points INTEGER NOT NULL DEFAULT 0,
  tasks_approved INTEGER NOT NULL DEFAULT 0,
  tasks_rejected INTEGER NOT NULL DEFAULT 0,
  rewards_requested INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  rewards_cancelled INTEGER NOT NULL DEFAULT 0,
  praise_count INTEGER NOT NULL DEFAULT 0,
  criticism_count INTEGER NOT NULL DEFAULT 0,
  achievements_unlocked INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, child_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_archives_child_month
  ON activity_archives(child_id, month_key);

INSERT OR IGNORE INTO system_settings (key, value)
VALUES
  ('detail_retention_days', '365'),
  ('short_record_retention_days', '7'),
  ('cleanup_last_run_at', '');
