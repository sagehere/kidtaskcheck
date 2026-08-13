CREATE TABLE IF NOT EXISTS child_daily_reviews (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL,
  presented_at TEXT NOT NULL,
  acknowledged_at TEXT,
  PRIMARY KEY (child_id, review_date)
);

CREATE INDEX IF NOT EXISTS idx_child_daily_reviews_pending
  ON child_daily_reviews(child_id, acknowledged_at, review_date);
