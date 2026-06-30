import { resolve } from "node:path";
import { createSqliteDb } from "../server/sqlite-db.mjs";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/taskcheck.sqlite");
const db = createSqliteDb(databasePath);

try {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  db.exec("PRAGMA optimize");
  console.log(JSON.stringify({ databasePath, compacted: true }, null, 2));
} finally {
  db.close();
}
