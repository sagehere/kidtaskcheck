import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSqliteDb } from "../server/sqlite-db.mjs";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/taskcheck.sqlite");
const migrationsDir = resolve(process.env.MIGRATIONS_DIR || "./migrations");
const db = createSqliteDb(databasePath);

db.exec(`CREATE TABLE IF NOT EXISTS __vps_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const applied = new Set(
  db.prepare("SELECT name FROM __vps_migrations").all().results.map((row) => row.name)
);
const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO __vps_migrations (name) VALUES (?)").bind(file).run();
    console.log(`applied ${file}`);
  } catch (error) {
    console.error(`failed ${file}:`, error?.message || error);
    process.exitCode = 1;
    break;
  }
}

db.close();
