import { beforeEach, describe, expect, it } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleChildRoutes } from "../server/api/routes/child.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { schedulerTick } from "../server/scheduler-tick.mjs";

function request(method: string, path: string, body?: any) {
  return new Request(`http://localhost/api${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function safe(handler: Function, ...args: any[]) { try { return await handler(...args); } catch (error) { if (error instanceof Response) return error; throw error; } }

describe("task sets", () => {
  let env: any, parentId: string, childId: string, taskA: string, taskB: string;
  const parent = () => ({ type: "user", role: "parent", id: parentId, displayName: "家长" });
  const child = () => ({ type: "child", role: "child", id: childId, parent_id: parentId, displayName: "孩子" });

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    parentId = id(); childId = id(); taskA = id(); taskB = id();
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(parentId, "p", await hashPassword("pw")).run();
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'C', 'active')").bind(childId, parentId, "c", await hashPassword("pw")).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat', ?, 'C', 'emoji', '✅')").bind(parentId).run();
    for (const [taskId, title, points] of [[taskA, "A", 5], [taskB, "B", 7]] as const) {
      env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'cat', ?, ?, 'daily', 3, 'earn', '[0,1,2,3,4,5,6]')").bind(taskId, parentId, title, points).run();
      env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(taskId, childId).run();
    }
    const create = request("POST", "/task-sets", { title: "晨间任务", taskIds: [taskA, taskB], iconType: "emoji", iconValue: "🧩", isActive: true });
    expect((await safe(handleParentRoutes, "/task-sets", "POST", create, env, parent()))!.status).toBe(200);
  });

  async function submitAndApprove(taskId: string, completionLabel?: string) {
    const submitted = await safe(handleChildRoutes, "/task-submissions", "POST", request("POST", "/task-submissions", { taskId }), env, child());
    expect(submitted!.status).toBe(200);
    const sub = env.DB.prepare("SELECT id FROM task_submissions WHERE task_id=? ORDER BY submitted_at DESC, id DESC LIMIT 1").bind(taskId).first() as any;
    return safe(handleParentRoutes, `/task-submissions/${sub.id}/review`, "PATCH", request("PATCH", `/task-submissions/${sub.id}/review`, { approved: true, completionLabel }), env, parent());
  }

  async function createWindow(taskIds: string[]) {
    env.DB.prepare("DELETE FROM task_set_members").run();
    env.DB.prepare("DELETE FROM task_sets").run();
    const response = await safe(handleParentRoutes, "/task-sets", "POST", request("POST", "/task-sets", { title: "九月目标", taskIds, settlementMode: "window", windowStart: "2026-09-01", windowEnd: "2026-09-01", windowWeekdays: [2], iconType: "emoji", iconValue: "🧩", isActive: true }), env, parent());
    expect(response!.status).toBe(200);
    return env.DB.prepare("SELECT id FROM task_sets WHERE parent_id=?").bind(parentId).first() as any;
  }

  function approvedWindowSubmission(taskSetId: string, taskId: string, points: number) {
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, reviewed_at, status, task_set_id, approved_points) VALUES (?, ?, ?, ?, '2026-09-01', '2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z', 'approved', ?, ?)")
      .bind(id(), taskId, childId, parentId, taskSetId, points).run();
  }

  async function createRecurring(taskIds: string[], windowType: "weekly" | "monthly" = "weekly") {
    env.DB.prepare("DELETE FROM task_set_members").run();
    env.DB.prepare("DELETE FROM task_sets").run();
    const response = await safe(handleParentRoutes, "/task-sets", "POST", request("POST", "/task-sets", { title: "循环目标", taskIds, settlementMode: "window", windowType, windowWeekdays: [1], iconType: "emoji", iconValue: "🧩", isActive: true }), env, parent());
    expect(response!.status).toBe(200);
    const set = env.DB.prepare("SELECT id FROM task_sets WHERE parent_id=?").bind(parentId).first() as any;
    env.DB.prepare("UPDATE task_sets SET recurrence_started_at=? WHERE id=?").bind("2026-09-06T16:00:00.000Z", set.id).run();
    env.DB.prepare("UPDATE tasks SET enabled_weekdays='[1]' WHERE id IN (?, ?)").bind(taskA, taskB).run();
    return set;
  }

  function approvedRecurringSubmission(taskSetId: string, taskId: string, date: string, points = 5) {
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, reviewed_at, status, task_set_id, approved_points) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)")
      .bind(id(), taskId, childId, parentId, date, `${date}T01:00:00.000Z`, `${date}T02:00:00.000Z`, taskSetId, points).run();
  }

  it("holds child-task points until every member is approved", async () => {
    expect((await submitAndApprove(taskA))!.status).toBe(200);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE source_type='task_set'").first().v).toBe(0);
    expect((await submitAndApprove(taskB))!.status).toBe(200);
    const ledger = env.DB.prepare("SELECT amount, note FROM point_ledger WHERE source_type='task_set'").first() as any;
    expect(ledger).toMatchObject({ amount: 12 });
    expect(ledger.note).toContain("晨间任务");
  });

  it("pairs repeated approvals into independent rounds", async () => {
    await submitAndApprove(taskA);
    await submitAndApprove(taskA);
    await submitAndApprove(taskB);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE source_type='task_set'").first().v).toBe(1);
    await submitAndApprove(taskB);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE source_type='task_set'").first().v).toBe(2);
  });

  it("uses the selected completion-grade snapshot", async () => {
    env.DB.prepare("UPDATE tasks SET grading_mode='completion', completion_standards_json=? WHERE id=?").bind(JSON.stringify([{ label: "合格", points: 3 }, { label: "优秀", points: 9 }]), taskA).run();
    await submitAndApprove(taskA, "合格");
    env.DB.prepare("UPDATE tasks SET completion_standards_json=? WHERE id=?").bind(JSON.stringify([{ label: "合格", points: 99 }]), taskA).run();
    await submitAndApprove(taskB);
    expect(env.DB.prepare("SELECT amount FROM point_ledger WHERE source_type='task_set'").first().amount).toBe(10);
  });

  it("locks member changes while an approved submission is waiting for its pair", async () => {
    await submitAndApprove(taskA);
    const set = env.DB.prepare("SELECT id FROM task_sets WHERE parent_id=?").bind(parentId).first() as any;
    const response = await safe(handleParentRoutes, `/task-sets/${set.id}`, "PATCH", request("PATCH", `/task-sets/${set.id}`, { taskIds: [taskB, taskA] }), env, parent());
    expect(response!.status).toBe(409);
  });

  it("settles a completed time window exactly once in the scheduler", async () => {
    const set = await createWindow([taskA]);
    approvedWindowSubmission(set.id, taskA, 5);
    const first = await schedulerTick(env, new Date("2026-09-02T00:00:00.000Z"));
    expect(first.taskSetWindows.settled).toBe(1);
    expect(env.DB.prepare("SELECT amount FROM point_ledger WHERE source_type='task_set'").first()).toMatchObject({ amount: 5 });
    const second = await schedulerTick(env, new Date("2026-09-02T00:00:00.000Z"));
    expect(second.taskSetWindows.settled).toBe(0);
  });

  it("creates a parent decision and releases approved task points on demand", async () => {
    const set = await createWindow([taskA, taskB]);
    approvedWindowSubmission(set.id, taskA, 5);
    const scheduled = await schedulerTick(env, new Date("2026-09-02T00:00:00.000Z"));
    expect(scheduled.taskSetWindows.awaitingDecision).toBe(1);
    const settlement = env.DB.prepare("SELECT id, status FROM task_set_settlements WHERE task_set_id=?").bind(set.id).first() as any;
    expect(settlement.status).toBe("awaiting_decision");
    const resolved = await safe(handleParentRoutes, `/task-set-settlements/${settlement.id}/resolve`, "PATCH", request("PATCH", `/task-set-settlements/${settlement.id}/resolve`, { action: "release" }), env, parent());
    expect(resolved!.status).toBe(200);
    expect(env.DB.prepare("SELECT amount FROM point_ledger WHERE source_type='task' AND source_id IN (SELECT id FROM task_submissions WHERE task_set_id=?)").bind(set.id).first()).toMatchObject({ amount: 5 });
  });

  it("settles recurring weekly cycles independently and resets for the next week", async () => {
    const set = await createRecurring([taskA]);
    approvedRecurringSubmission(set.id, taskA, "2026-09-07");
    expect((await schedulerTick(env, new Date("2026-09-14T00:00:00.000Z"))).taskSetWindows.settled).toBe(1);
    approvedRecurringSubmission(set.id, taskA, "2026-09-14");
    expect((await schedulerTick(env, new Date("2026-09-21T00:00:00.000Z"))).taskSetWindows.settled).toBe(1);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM task_set_settlements WHERE task_set_id=?").bind(set.id).first().v).toBe(2);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE source_type='task_set'").first().v).toBe(2);
  });

  it("does not let an unresolved weekly cycle block the next cycle", async () => {
    const set = await createRecurring([taskA]);
    expect((await schedulerTick(env, new Date("2026-09-14T00:00:00.000Z"))).taskSetWindows.awaitingDecision).toBe(1);
    approvedRecurringSubmission(set.id, taskA, "2026-09-14");
    expect((await schedulerTick(env, new Date("2026-09-21T00:00:00.000Z"))).taskSetWindows.settled).toBe(1);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM task_set_settlements WHERE task_set_id=? AND status='awaiting_decision'").bind(set.id).first().v).toBe(1);
  });

  it("catches up every completed cycle before a recurring task set is stopped", async () => {
    const set = await createRecurring([taskA]);
    approvedRecurringSubmission(set.id, taskA, "2026-09-07");
    approvedRecurringSubmission(set.id, taskA, "2026-09-14");
    env.DB.prepare("UPDATE task_sets SET is_active=0, recurrence_stopped_at=? WHERE id=?").bind("2026-09-17T00:00:00.000Z", set.id).run();
    expect((await schedulerTick(env, new Date("2026-09-18T00:00:00.000Z"))).taskSetWindows.settled).toBe(2);
    expect(env.DB.prepare("SELECT COUNT(*) v FROM task_set_settlements WHERE task_set_id=?").bind(set.id).first().v).toBe(2);
  });

  it("rejects incompatible monthly tasks in a weekly recurring task set", async () => {
    env.DB.prepare("DELETE FROM task_set_members").run();
    env.DB.prepare("DELETE FROM task_sets").run();
    env.DB.prepare("UPDATE tasks SET period='monthly' WHERE id=?").bind(taskA).run();
    const response = await safe(handleParentRoutes, "/task-sets", "POST", request("POST", "/task-sets", { title: "每周目标", taskIds: [taskA], settlementMode: "window", windowType: "weekly", windowWeekdays: [1], iconType: "emoji", iconValue: "🧩", isActive: true }), env, parent());
    expect(response!.status).toBe(400);
  });
});
