import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createSqliteDb } from "../server/sqlite-db.mjs";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/taskcheck.sqlite");
const migrationsDir = resolve(process.env.MIGRATIONS_DIR || "./migrations");
const db = createSqliteDb(databasePath);

db.exec(`CREATE TABLE IF NOT EXISTS __vps_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
for (const file of files) {
  db.prepare("INSERT OR IGNORE INTO __vps_migrations (name) VALUES (?)").bind(file).run();
  console.log(`stamped ${file}`);
}

db.close();
