PRAGMA foreign_keys = OFF;

CREATE TABLE rewards_new (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cost_points INTEGER NOT NULL CHECK(cost_points >= 0),
  stock INTEGER,
  limit_period TEXT NOT NULL DEFAULT 'daily' CHECK(limit_period IN ('none', 'daily', 'weekly', 'monthly', 'once')),
  limit_count INTEGER,
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '🎁',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO rewards_new (
  id,
  parent_id,
  title,
  description,
  cost_points,
  stock,
  limit_period,
  limit_count,
  icon_type,
  icon_value,
  is_active,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  id,
  parent_id,
  title,
  description,
  cost_points,
  stock,
  limit_period,
  limit_count,
  icon_type,
  icon_value,
  is_active,
  deleted_at,
  created_at,
  updated_at
FROM rewards;

DROP TABLE rewards;
ALTER TABLE rewards_new RENAME TO rewards;

PRAGMA foreign_keys = ON;
