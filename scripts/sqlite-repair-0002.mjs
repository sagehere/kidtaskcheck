import { createSqliteDb } from "../server/sqlite-db.mjs";
import { fileURLToPath } from "node:url";

export const MIGRATION_0002 = "0002_limits_and_repeat_submissions.sql";

const TASK_SUBMISSION_COLUMNS = [
  "id",
  "task_id",
  "child_id",
  "parent_id",
  "period_key",
  "submitted_at",
  "status",
  "reviewed_at",
  "review_note",
  "created_at"
];

function rows(db, sql) {
  return db.prepare(sql).all().results;
}

function first(db, sql) {
  return db.prepare(sql).first();
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS __vps_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

function tableExists(db, table) {
  return Boolean(first(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`));
}

function columns(db, table) {
  return rows(db, `PRAGMA table_info(${table})`).map((row) => row.name);
}

function hasColumn(db, table, column) {
  return columns(db, table).includes(column);
}

function migrationApplied(db) {
  return Boolean(first(db, `SELECT name FROM __vps_migrations WHERE name='${MIGRATION_0002}'`));
}

function uniqueIndexColumns(db, table) {
  const indexes = rows(db, `PRAGMA index_list(${table})`).filter((row) => Number(row.unique) === 1);
  return indexes.map((index) => rows(db, `PRAGMA index_info(${index.name})`).map((row) => row.name));
}

function hasOldTaskSubmissionUnique(db) {
  return uniqueIndexColumns(db, "task_submissions").some((cols) =>
    cols.length === 3 &&
    cols[0] === "task_id" &&
    cols[1] === "child_id" &&
    cols[2] === "period_key"
  );
}

function hasExpectedTaskSubmissionColumns(db) {
  const actual = columns(db, "task_submissions");
  return TASK_SUBMISSION_COLUMNS.every((column) => actual.includes(column));
}

function stampMigration(db) {
  db.prepare("INSERT OR IGNORE INTO __vps_migrations (name) VALUES (?)").bind(MIGRATION_0002).run();
}

function completeTaskSubmissionRewrite(db) {
  if (tableExists(db, "task_submissions_new")) {
    throw new Error("task_submissions_new already exists; stop and inspect the database before repairing");
  }

  db.exec(`PRAGMA foreign_keys = OFF;

CREATE TABLE task_submissions_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task_submissions_new (
  id,
  task_id,
  child_id,
  parent_id,
  period_key,
  submitted_at,
  status,
  reviewed_at,
  review_note,
  created_at
)
SELECT
  id,
  task_id,
  child_id,
  parent_id,
  period_key,
  submitted_at,
  status,
  reviewed_at,
  review_note,
  created_at
FROM task_submissions;

DROP TABLE task_submissions;
ALTER TABLE task_submissions_new RENAME TO task_submissions;

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_submissions_parent_status ON task_submissions(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_task_child_period_status ON task_submissions(task_id, child_id, period_key, status);`);
}

export function inspectSqlite0002State(db) {
  ensureMigrationTable(db);
  const integrity = first(db, "PRAGMA integrity_check");
  const integrityCheck = integrity?.integrity_check || integrity?.[0] || "unknown";
  const hasTasks = tableExists(db, "tasks");
  const hasTaskSubmissions = tableExists(db, "task_submissions");

  return {
    integrityCheck,
    migrationApplied: migrationApplied(db),
    hasTasks,
    hasTaskSubmissions,
    hasTasksLimitCount: hasTasks ? hasColumn(db, "tasks", "limit_count") : false,
    hasExpectedTaskSubmissionColumns: hasTaskSubmissions ? hasExpectedTaskSubmissionColumns(db) : false,
    hasOldTaskSubmissionUnique: hasTaskSubmissions ? hasOldTaskSubmissionUnique(db) : false
  };
}

export function repairSqlite0002(db, log = console.log) {
  const before = inspectSqlite0002State(db);
  log(`sqlite 0002 repair state before: ${JSON.stringify(before)}`);

  if (before.integrityCheck !== "ok") {
    throw new Error(`database integrity_check is ${before.integrityCheck}; restore from backup or inspect manually`);
  }
  if (before.migrationApplied) {
    log(`${MIGRATION_0002} is already recorded; no repair needed`);
    return { action: "none", before, after: inspectSqlite0002State(db) };
  }
  if (!before.hasTasks || !before.hasTaskSubmissions) {
    throw new Error("tasks or task_submissions table is missing; this repair only supports databases that already ran 0001");
  }
  if (!before.hasTasksLimitCount) {
    throw new Error("tasks.limit_count is missing; run normal migrations instead of this half-migration repair");
  }
  if (!before.hasExpectedTaskSubmissionColumns) {
    throw new Error("task_submissions columns do not match the expected 0001/0002 shape; inspect manually before repairing");
  }

  let action = "stamp";
  if (before.hasOldTaskSubmissionUnique) {
    completeTaskSubmissionRewrite(db);
    action = "complete_task_submissions_rewrite_and_stamp";
  }

  stampMigration(db);
  const after = inspectSqlite0002State(db);
  log(`sqlite 0002 repair action: ${action}`);
  log(`sqlite 0002 repair state after: ${JSON.stringify(after)}`);
  return { action, before, after };
}

function main() {
  const db = createSqliteDb(process.env.DATABASE_PATH || "./data/taskcheck.sqlite");
  try {
    const result = repairSqlite0002(db);
    console.log(`sqlite 0002 repair completed: ${result.action}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
