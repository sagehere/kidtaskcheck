import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { SqliteTestDb } from "./helpers/sqlite-test-db";

const MIGRATIONS_DIR = join(__dirname, "../migrations");

describe("Task 35: Migration Smoke Test", () => {
  it("all 17 migration files apply sequentially on empty DB without errors", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBe(17);
    const db = new SqliteTestDb();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      expect(() => db.exec(sql)).not.toThrow();
    }
    // Verify key tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().results as any[];
    const tableNames = tables.map((t: any) => t.name).sort();
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("children");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("rewards");
    expect(tableNames).toContain("task_submissions");
    expect(tableNames).toContain("reward_redemptions");
    expect(tableNames).toContain("point_ledger");
    expect(tableNames).toContain("notifications");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("feedback_templates");
    expect(tableNames).toContain("task_categories");
    expect(tableNames).toContain("achievements");
    expect(tableNames).toContain("child_achievements");
    expect(tableNames).toContain("task_assignees");
    expect(tableNames).toContain("reward_assignees");
    expect(tableNames).toContain("child_pins");
    expect(tableNames).toContain("reward_prerequisites");
    expect(tableNames).toContain("system_settings");
    expect(tableNames).toContain("activity_archives");
    expect(tableNames).toContain("ai_child_greetings");
    expect(tableNames).toContain("ai_report_commentaries");
    expect(tableNames).toContain("parent_ai_service_settings");
    expect(tableNames).toContain("ai_scheduled_refresh_runs");
    db.close();
  });

  it("migration 0012 does not drop data", () => {
    const db = new SqliteTestDb();
    // Apply migrations 1-11
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (file === "0012_fix_ai_greetings_pk.sql") break;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      db.exec(sql);
    }
    // Insert a user (parent) and child first (FK requirements)
    db.exec("INSERT INTO users (id, username, password_hash, role, display_name) VALUES ('test-parent', 'tp', 'x', 'parent', 'TP')");
    db.exec("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES ('test-child', 'test-parent', 'tc', 'x', 'TC', 'active')");
    db.exec("INSERT INTO ai_child_greetings (child_id, previous_week_key, config_hash, greeting) VALUES ('test-child', '2026-W22', 'abc123', 'Hello!')");
    const before = db.prepare("SELECT COUNT(*) as count FROM ai_child_greetings").all().results as any[];
    expect(before[0].count).toBe(1);
    // Apply migration 0012 (should be additive, not destructive)
    const sql12 = readFileSync(join(MIGRATIONS_DIR, "0012_fix_ai_greetings_pk.sql"), "utf8");
    db.exec(sql12);
    const after = db.prepare("SELECT COUNT(*) as count FROM ai_child_greetings").all().results as any[];
    expect(after[0].count).toBe(1);
    db.close();
  });
});
