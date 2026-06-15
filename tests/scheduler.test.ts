import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";

describe("schedulerTick shared tick", () => {
  let env: any, pid: string, cid: string, tid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pid = id();
    const pw = await hashPassword("ppw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'TP')").bind(pid, "tp", pw).run();
    cid = id();
    const cpw = await hashPassword("cpw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'TC', 'active')").bind(cid, pid, "tc", cpw).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-1', ?, 'Cat', 'emoji', '📚')").bind(pid).run();
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
  });

  it("calls settleRequiredTaskPenalties and returns requiredPenalties in result", async () => {
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { schedulerTick } = await import("../server/scheduler-tick.mjs");
    const result = await schedulerTick(env, new Date("2026-06-11T00:00:00.000Z"));
    expect(result.at).toBe("2026-06-11T00:00:00.000Z");
    expect(result).toHaveProperty("requiredPenalties");
    expect(result.requiredPenalties).toHaveProperty("settled");
    expect(result.requiredPenalties.settled).toBe(1);
  });

  it("includes ai schedule result and requiredPenalties even when outside midnight window", async () => {
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { schedulerTick } = await import("../server/scheduler-tick.mjs");
    const result = await schedulerTick(env, new Date("2026-06-11T12:00:00.000Z"));
    expect(result).toHaveProperty("requiredPenalties");
    expect(result).toHaveProperty("skipped");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("outside_midnight_window");
    expect(result.requiredPenalties.settled).toBe(1);
  });

  it("does not fail when no required tasks exist", async () => {
    env.DB.prepare("DELETE FROM task_assignees").run();
    env.DB.prepare("DELETE FROM tasks").run();
    const { schedulerTick } = await import("../server/scheduler-tick.mjs");
    const result = await schedulerTick(env, new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toHaveProperty("requiredPenalties");
    expect(result.requiredPenalties.settled).toBe(0);
    expect(result).toHaveProperty("skipped");
  });

  it("returns requiredPenalties even when cleanup_last_run_at is recent", async () => {
    env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('cleanup_last_run_at', '2026-06-11T23:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { schedulerTick } = await import("../server/scheduler-tick.mjs");
    const result = await schedulerTick(env, new Date("2026-06-12T00:00:00.000Z"));
    expect(result.requiredPenalties.settled).toBe(1);
    const penalty = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(penalty).not.toBeNull();
  });

  it("is idempotent: two ticks with the same time do not double-deduct", async () => {
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { schedulerTick } = await import("../server/scheduler-tick.mjs");
    const r1 = await schedulerTick(env, new Date("2026-06-11T00:00:00.000Z"));
    expect(r1.requiredPenalties.settled).toBe(1);
    const r2 = await schedulerTick(env, new Date("2026-06-11T00:00:00.000Z"));
    expect(r2.requiredPenalties.settled).toBe(0);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(95);
  });
});
