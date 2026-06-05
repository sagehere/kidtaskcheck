import { createSqliteDb } from "./sqlite-db.mjs";

let db;

export function createRuntimeEnv(overrides = {}) {
  db ||= createSqliteDb(overrides.DATABASE_PATH || process.env.DATABASE_PATH);
  return {
    DB: db,
    APP_NAME: process.env.APP_NAME || "Kids Task Checkin",
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "change-me-admin-password",
    ENVIRONMENT: process.env.ENVIRONMENT || "development",
    APP_URL: process.env.APP_URL || "",
    ALLOW_DEFAULT_ADMIN_PASSWORD: process.env.ALLOW_DEFAULT_ADMIN_PASSWORD || "",
    ...overrides
  };
}

export function createNodeExecutionContext() {
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch((error) => {
        console.error("waitUntil task failed:", error?.stack || error);
      });
    }
  };
}
