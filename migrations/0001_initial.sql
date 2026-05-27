PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'parent')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'child')),
  actor_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery_images (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT 'general',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '⭐',
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES task_categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly', 'once')),
  point_type TEXT NOT NULL CHECK(point_type IN ('earn', 'deduct')),
  points INTEGER NOT NULL CHECK(points >= 0),
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '✅',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  PRIMARY KEY (task_id, child_id)
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, child_id, period_key)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  period_key TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cost_points INTEGER NOT NULL CHECK(cost_points >= 0),
  stock INTEGER,
  limit_period TEXT NOT NULL DEFAULT 'none' CHECK(limit_period IN ('none', 'daily', 'weekly', 'monthly')),
  limit_count INTEGER,
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '🎁',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_assignees (
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  PRIMARY KEY (reward_id, child_id)
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'redeemed', 'cancelled')),
  redeemed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL CHECK(metric IN ('total_earned', 'balance', 'tasks_completed', 'streak_days', 'redemptions')),
  threshold INTEGER NOT NULL CHECK(threshold >= 0),
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '🏅',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS child_achievements (
  child_id TEXT NOT NULL REFERENCES children(id),
  achievement_id TEXT NOT NULL REFERENCES achievements(id),
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (child_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_submissions_parent_status ON task_submissions(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_child ON point_ledger(child_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_parent_status ON reward_redemptions(parent_id, status);
