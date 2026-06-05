import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { handleChildRoutes } from "../server/api/routes/child.js";

function makeRequest(method: string, path: string, body?: any): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  return new Request(`http://localhost/api${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

function norm(p: string) { return `/${(p.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`; }

async function safe(h: Function, ...a: any[]) { try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; } }

async function seedParent(env: any, username: string, displayName: string): Promise<string> {
  const pw = await hashPassword("ppw");
  const pid = id();
  env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', ?)").bind(pid, username, pw, displayName).run();
  return pid;
}

async function seedChild(env: any, parentId: string, username: string, displayName: string): Promise<string> {
  const pw = await hashPassword("cpw");
  const cid = id();
  env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, ?, 'active')").bind(cid, parentId, username, pw, displayName).run();
  return cid;
}

describe("Cross-Family Defense", () => {
  let env: any, pA: string, pB: string, cA: string, cB: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pA = await seedParent(env, "pa", "家长A");
    pB = await seedParent(env, "pb", "家长B");
    cA = await seedChild(env, pA, "ca", "孩子A");
    cB = await seedChild(env, pB, "cb", "孩子B");
  });

  it("parent A cannot assign task to parent B's child", async () => {
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-a', ?, 'Cat', 'emoji', '📚')").bind(pA).run();
    const actor = { type: "user", role: "parent", id: pA };
    const req = makeRequest("POST", "/tasks", { title: "X", categoryId: "cat-a", childIds: [cB], points: 5, period: "daily", limitCount: 1 });
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "POST", req, env, actor);
    expect(res!.status).toBe(403);
  });

  it("child B cannot submit task owned by parent A even if assignee is polluted", async () => {
    // Create task for parent A
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-a', ?, 'Cat', 'emoji', '📚')").bind(pA).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES ('t-a', ?, 'cat-a', 'TaskA', 10, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(pA).run();
    // Pollute: insert assignee for child B on parent A's task
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES ('t-a', ?)").bind(cB).run();
    // Child B tries to submit - should fail due to parent_id mismatch
    const actor = { type: "child", role: "child", id: cB, parent_id: pB, displayName: "cb" };
    const req = makeRequest("POST", "/task-submissions", { taskId: "t-a" });
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "POST", req, env, actor);
    expect(res!.status).toBe(404);
    const data = await res!.json();
    expect(data.error.code).toBe("NOT_ASSIGNED");
  });

  it("child B cannot redeem reward owned by parent A even if assignee is polluted", async () => {
    // Create reward for parent A
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES ('r-a', ?, 'RewardA', 10, 'daily', '[1,2,3,4,5,6,0]')").bind(pA).run();
    // Give child B enough balance
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', 'now')").bind(id(), cB, pB).run();
    // Pollute: insert assignee for child B on parent A's reward
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES ('r-a', ?)").bind(cB).run();
    // Child B tries to redeem - should fail due to parent_id mismatch
    const actor = { type: "child", role: "child", id: cB, parent_id: pB, displayName: "cb" };
    const req = makeRequest("POST", "/reward-redemptions", { rewardId: "r-a" });
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "POST", req, env, actor);
    expect(res!.status).toBe(404);
    const data = await res!.json();
    expect(data.error.code).toBe("NOT_ASSIGNED");
  });

  it("child B dashboard does not show parent A's tasks", async () => {
    // Create task + assignee for parent A + child A (legitimate)
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-a', ?, 'Cat', 'emoji', '📚')").bind(pA).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES ('t-a', ?, 'cat-a', 'TaskA', 10, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(pA).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES ('t-a', ?)").bind(cA).run();
    // Pollute: also assign child B
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES ('t-a', ?)").bind(cB).run();
    // Child B dashboard should NOT include this task (wrong parent_id)
    const actor = { type: "child", role: "child", id: cB, parent_id: pB, displayName: "cb" };
    const req = makeRequest("GET", "/dashboard/child");
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "GET", req, env, actor, { waitUntil: () => {} });
    const data = await res!.json();
    const taskTitles = data.data.tasks.map((t: any) => t.title);
    expect(taskTitles).not.toContain("TaskA");
  });

  it("child B cannot pin parent A's task even if assignee is polluted", async () => {
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-a', ?, 'Cat', 'emoji', '📚')").bind(pA).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES ('t-a', ?, 'cat-a', 'TaskA', 10, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(pA).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES ('t-a', ?)").bind(cB).run(); // polluted
    const actor = { type: "child", role: "child", id: cB, parent_id: pB, displayName: "cb" };
    const req = makeRequest("PATCH", "/child-pins/task", { itemId: "t-a" });
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "PATCH", req, env, actor);
    expect(res!.status).toBe(404);
    const data = await res!.json();
    expect(data.error.code).toBe("NOT_ASSIGNED");
  });

  it("child B cannot pin parent A's reward even if assignee is polluted", async () => {
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES ('r-a', ?, 'RewardA', 10, 'daily', '[1,2,3,4,5,6,0]')").bind(pA).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES ('r-a', ?)").bind(cB).run(); // polluted
    const actor = { type: "child", role: "child", id: cB, parent_id: pB, displayName: "cb" };
    const req = makeRequest("PATCH", "/child-pins/reward", { itemId: "r-a" });
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "PATCH", req, env, actor);
    expect(res!.status).toBe(404);
    const data = await res!.json();
    expect(data.error.code).toBe("NOT_ASSIGNED");
  });

  it("parent cannot view other parent's children", async () => {
    const actor = { type: "user", role: "parent", id: pA };
    const req = makeRequest("GET", "/children");
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "GET", req, env, actor);
    const data = await res!.json();
    const names = data.data.map((c: any) => c.display_name);
    expect(names).toContain("孩子A");
    expect(names).not.toContain("孩子B");
  });
});
