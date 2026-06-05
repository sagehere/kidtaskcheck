import { resolve } from "node:path";
import { createSqliteD1 } from "../server/d1-sqlite-adapter.mjs";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/taskcheck.sqlite");
const db = createSqliteD1(databasePath);

const integrity = db.prepare("PRAGMA integrity_check").first();
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all().results;
const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().results.map((row) => row.name);

const counts = {};
for (const table of tables) {
  counts[table] = db.prepare(`SELECT COUNT(*) count FROM ${table}`).first().count;
}

const balances = db.prepare(`
  SELECT child_id, parent_id, COALESCE(SUM(amount), 0) balance
  FROM point_ledger
  GROUP BY child_id, parent_id
  ORDER BY parent_id, child_id
`).all().results;

console.log(JSON.stringify({
  databasePath,
  integrity: integrity?.integrity_check || integrity?.[0] || "unknown",
  foreignKeyViolations: foreignKeys.length,
  counts,
  balances
}, null, 2));

db.close();
if ((integrity?.integrity_check || integrity?.[0]) !== "ok" || foreignKeys.length > 0) process.exitCode = 1;
