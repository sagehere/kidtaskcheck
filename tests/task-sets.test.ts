import { beforeEach, describe, expect, it } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleChildRoutes } from "../server/api/routes/child.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";

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
});
