-- Migration 0010: retention, reports, feedback recall
-- Adds retention/revoked columns, activity_archives table, cleanup settings

-- point_ledger: add revoked_at, revoke_ledger_id, retention_until
ALTER TABLE point_ledger ADD COLUMN revoked_at TEXT;
ALTER TABLE point_ledger ADD COLUMN revoke_ledger_id TEXT REFERENCES point_ledger(id);
ALTER TABLE point_ledger ADD COLUMN retention_until TEXT;

-- reward_redemptions: add refunded_at, retention_until
ALTER TABLE reward_redemptions ADD COLUMN refunded_at TEXT;
ALTER TABLE reward_redemptions ADD COLUMN retention_until TEXT;

-- activity_archives: monthly aggregated archive for old detail rows
CREATE TABLE IF NOT EXISTS activity_archives (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  month_key TEXT NOT NULL CHECK(length(month_key) = 7),
  net_points INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_rejected INTEGER NOT NULL DEFAULT 0,
  tasks_pending_cleaned INTEGER NOT NULL DEFAULT 0,
  rewards_pending INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  rewards_refunded INTEGER NOT NULL DEFAULT 0,
  praise_count INTEGER NOT NULL DEFAULT 0,
  criticism_count INTEGER NOT NULL DEFAULT 0,
  achievements_unlocked INTEGER NOT NULL DEFAULT 0,
  summary_ledger_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, child_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_archives_parent_child ON activity_archives(parent_id, child_id, month_key);

-- system_settings: cleanup config keys
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('cleanup_last_run_at', '');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('detail_retention_days', '365');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('short_record_retention_days', '7');

-- Indexes for cleanup queries
CREATE INDEX IF NOT EXISTS idx_point_ledger_revoked ON point_ledger(revoked_at, retention_until);
CREATE INDEX IF NOT EXISTS idx_point_ledger_retention ON point_ledger(retention_until);
CREATE INDEX IF NOT EXISTS idx_redemptions_refunded ON reward_redemptions(refunded_at, retention_until);
CREATE INDEX IF NOT EXISTS idx_redemptions_retention ON reward_redemptions(retention_until);
