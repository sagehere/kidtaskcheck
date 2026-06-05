import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createTestEnv } from "./sqlite-test-db";

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

export function runMigrations(env: any) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    env.DB.exec(sql);
  }
}

export function createTestEnvWithMigrations(extras: Record<string, any> = {}) {
  const env = createTestEnv(extras);
  runMigrations(env);
  return env;
}

export function applyMigrationsAndBootstrap() {
  const env = createTestEnvWithMigrations();
  return env;
}

let _setupEnv: any = null;
export function getTestEnv() {
  if (!_setupEnv) _setupEnv = applyMigrationsAndBootstrap();
  return _setupEnv;
}

export function resetTestEnv() {
  if (_setupEnv) _setupEnv._db.close();
  _setupEnv = applyMigrationsAndBootstrap();
  return _setupEnv;
}
