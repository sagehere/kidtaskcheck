import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { handleAuthRoutes } from "../server/api/routes/auth.js";
import { handleAdminRoutes } from "../server/api/routes/admin.js";
import { handleChildRoutes } from "../server/api/routes/child.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { handleSharedRoutes } from "../server/api/routes/shared.js";
import { ensureAdmin, actorFromRequest, sessionCookie, validateHttpsUrl, isPrivateUrl, id, hashPassword } from "../server/api/utils.js";
import { truncateAiOutput, stripAiThinking, aiReportConfigHash, processAiGenerationQueue, runScheduledAiRefresh, processCartoonReportJobs, processPrintChecklistImageJobs, processScheduleImageJobs } from "../server/api/ai/index.js";
import { api } from "../src/api/client";
import { reportWindowRange } from "../src/lib/domain";

function makeRequest(m: string, p: string, b?: any, c?: string): Request {
  const h: Record<string, string> = {};
  if (m !== "GET" && m !== "HEAD") h["content-type"] = "application/json";
  if (c) h["cookie"] = c;
  return new Request(`http://localhost/api${p}`, { method: m, headers: h, ...(b ? { body: JSON.stringify(b) } : {}) });
}
function norm(p: string) { return `/${(p.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`; }
async function safe(h: Function, ...a: any[]) { try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; } }
async function login(env: any, u: string, p: string): Promise<string> {
  const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: u, password: p }), env, null);
  if (!r || r.status !== 200) throw new Error(`Login failed: ${r?.status}`);
  return (r.headers.get("set-cookie") || "").match(/session=([^;]+)/)?.[1] || "";
}
async function clearLoginAttempts(env: any) {
  try { await env.DB.prepare("DELETE FROM login_attempts").run(); } catch {}
}

describe("Auth", () => {
  let env: any;
  beforeEach(async () => { env = resetTestEnv(); await ensureAdmin(env); await clearLoginAttempts(env); });
  it("rejects wrong password", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "x" }), env, null);
    expect(r!.status).toBe(401);
  });
  it("login succeeds with correct password", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw" }), env, null);
    expect(r!.status).toBe(200);
    const c = r!.headers.get("set-cookie") || "";
    expect(c).toContain("session=");
  });
  it("login cookie Max-Age is 180 days", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw" }), env, null);
    expect(r!.status).toBe(200);
    const c = r!.headers.get("set-cookie") || "";
    expect(c).toContain("Max-Age=15552000");
  });
  it("session expires_at is ~180 days from now", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw" }), env, null);
    expect(r!.status).toBe(200);
    const session = env.DB.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1").first() as any;
    const diff = Date.parse(session.expires_at) - Date.now();
    expect(diff).toBeGreaterThan(179 * 86400000);
    expect(diff).toBeLessThan(181 * 86400000);
  });
  it("remember me login creates a long-lived cookie and session", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw", rememberMe: true }), env, null);
    expect(r!.status).toBe(200);
    const c = r!.headers.get("set-cookie") || "";
    expect(c).toContain("Max-Age=315360000");
    const session = env.DB.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1").first() as any;
    const diff = Date.parse(session.expires_at) - Date.now();
    expect(diff).toBeGreaterThan(3649 * 86400000);
    expect(diff).toBeLessThan(3651 * 86400000);
  });
  it("auth me renews remembered sessions", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw", rememberMe: true }), env, null);
    const token = (r!.headers.get("set-cookie") || "").match(/session=([^;]+)/)?.[1] || "";
    const soon = new Date(Date.now() + 365 * 86400000).toISOString();
    env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token=?").bind(soon, token).run();
    const req = makeRequest("GET", "/auth/me", undefined, "session=" + token);
    const actor = await actorFromRequest(req, env);
    const me = await safe(handleAuthRoutes, "/auth/me", "GET", req, env, actor);
    expect(me!.headers.get("set-cookie") || "").toContain("Max-Age=315360000");
    const session = env.DB.prepare("SELECT * FROM sessions WHERE token=?").bind(token).first() as any;
    expect(Date.parse(session.expires_at) - Date.now()).toBeGreaterThan(3649 * 86400000);
  });
  it("login cookie includes Secure when request is HTTPS", () => {
    const req = new Request("https://example.com/api/auth/login", { headers: { "x-forwarded-proto": "https" } });
    expect(sessionCookie("tok", {}, req)).toContain("Secure");
  });
  it("login cookie omits Secure when request is HTTP", () => {
    const req = new Request("http://localhost:3000/api/auth/login");
    expect(sessionCookie("tok", {}, req)).not.toContain("Secure");
  });
  it("rate-limits after 5 rapid failures", async () => {
    for (let i = 0; i < 6; i++) {
      const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: `w${i}` }), env, null);
      if (i < 5) expect(r!.status).toBe(401);
      else expect(r!.status).toBe(429);
    }
  });
});

describe("Real Child Session Integration", () => {
  let env: any;
  let pid: string, cid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    await clearLoginAttempts(env);
    pid = id();
    const pw = await hashPassword("pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(pid, "p", pw).run();
    cid = id();
    const cpw = await hashPassword("cpw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'Child', 'active')").bind(cid, pid, "child", cpw).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat', ?, 'Cat', 'emoji', '📚')").bind(pid).run();
    const tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'cat', 'T', 10, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    const rid = id();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES (?, ?, 'R', 10, 'daily', '[1,2,3,4,5,6,0]')").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
  });

  it("child login -> actorFromRequest -> dashboard succeeds and has correct parentId", async () => {
    const cookie = await login(env, "child", "cpw");
    const req = makeRequest("GET", "/auth/me", undefined, `session=${cookie}`);
    const actor = await actorFromRequest(req, env);
    expect(actor).not.toBeNull();
    expect(actor!.role).toBe("child");
    expect(actor!.parentId).toBe(pid);
    expect(actor!.parent_id).toBe(pid);
    // Dashboard
    const dashReq = makeRequest("GET", "/dashboard/child");
    const dashRes = await safe(handleChildRoutes, norm(new URL(dashReq.url).pathname), "GET", dashReq, env, actor, { waitUntil: () => {} });
    expect(dashRes!.status).toBe(200);
    const dash = await dashRes!.json();
    expect(dash.data.tasks.length).toBeGreaterThanOrEqual(1);
    expect(dash.data.tasks[0].title).toBe("T");
  });

  it("child login -> submit task succeeds", async () => {
    const cookie = await login(env, "child", "cpw");
    const req = makeRequest("GET", "/auth/me", undefined, `session=${cookie}`);
    const actor = await actorFromRequest(req, env);
    // Get task ID from dashboard
    const dashReq = makeRequest("GET", "/dashboard/child");
    const dashRes = await safe(handleChildRoutes, norm(new URL(dashReq.url).pathname), "GET", dashReq, env, actor, { waitUntil: () => {} });
    const dash = await dashRes!.json();
    const taskId = dash.data.tasks[0].id;
    // Submit
    const subReq = makeRequest("POST", "/task-submissions", { taskId });
    const subRes = await safe(handleChildRoutes, norm(new URL(subReq.url).pathname), "POST", subReq, env, actor);
    expect(subRes!.status).toBe(200);
  });
});

describe("Parent delegate accounts", () => {
  let env: any;
  let pid: string;
  let cid: string;
  let tid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    await clearLoginAttempts(env);
    pid = id();
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name, operator_label) VALUES (?, 'parent-a', ?, 'parent', 'Parent A', '妈妈')")
      .bind(pid, await hashPassword("pw"))
      .run();
    cid = id();
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, 'childa', ?, 'Child A', 'active')")
      .bind(cid, pid, await hashPassword("cpw"))
      .run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('delegate-cat', ?, 'Cat', 'emoji', '⭐')").bind(pid).run();
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'delegate-cat', 'Read', 5, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
  });

  it("logs in a delegate, lets it review tasks, and records operator labels", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "Parent A", operatorLabel: "妈妈" };
    const createDelegate = await safe(handleParentRoutes, "/parent/delegates", "POST", makeRequest("POST", "/parent/delegates", { username: "dad", password: "dpw", displayName: "Dad", operatorLabel: "爸爸" }), env, parentActor);
    expect(createDelegate!.status).toBe(200);
    const duplicateChild = await safe(handleParentRoutes, "/parent/delegates", "POST", makeRequest("POST", "/parent/delegates", { username: "childa", password: "x", displayName: "Dup" }), env, parentActor);
    expect(duplicateChild!.status).toBe(409);

    const cookie = await login(env, "dad", "dpw");
    const delegateActor = await actorFromRequest(makeRequest("GET", "/auth/me", undefined, `session=${cookie}`), env);
    expect(delegateActor!.role).toBe("parent_delegate");
    expect(delegateActor!.id).toBe(pid);
    expect((delegateActor as any).operatorLabel).toBe("爸爸");

    const blocked = await safe(handleParentRoutes, "/parent/delegates", "GET", makeRequest("GET", "/parent/delegates"), env, delegateActor);
    expect(blocked!.status).toBe(403);

    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, parentId: pid, displayName: "Child A" };
    await safe(handleChildRoutes, "/task-submissions", "POST", makeRequest("POST", "/task-submissions", { taskId: tid }), env, childActor);
    const sub = env.DB.prepare("SELECT id FROM task_submissions WHERE child_id=?").bind(cid).first() as any;
    const reviewed = await safe(handleParentRoutes, `/task-submissions/${sub.id}/review`, "PATCH", makeRequest("PATCH", `/task-submissions/${sub.id}/review`, { approved: true, note: "" }), env, delegateActor);
    expect(reviewed!.status).toBe(200);

    const ledger = env.DB.prepare("SELECT actor_label_snapshot FROM point_ledger WHERE source_type='task' AND source_id=?").bind(sub.id).first() as any;
    expect(ledger.actor_label_snapshot).toBe("爸爸");
    const notifications = await safe(handleSharedRoutes, "/notifications", "GET", makeRequest("GET", "/notifications"), env, childActor, new URL("http://localhost/api/notifications"));
    const body = await notifications!.json();
    expect(body.data.items.some((item: any) => item.actorLabel === "爸爸")).toBe(true);
  });


  it("lets a child hide and show unlocked achievements from the warehouse", async () => {
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, parentId: pid, displayName: "Child A" };
    const achievementId = id();
    env.DB.prepare("INSERT INTO achievements (id, parent_id, title, metric, threshold, icon_type, icon_value) VALUES (?, ?, 'Reader', 'tasks_completed', 1, 'emoji', '🏅')").bind(achievementId, pid).run();
    env.DB.prepare("INSERT INTO child_achievements (child_id, achievement_id, unlocked_at) VALUES (?, ?, ?)").bind(cid, achievementId, new Date().toISOString()).run();

    const hide = await safe(handleChildRoutes, `/child-achievements/${achievementId}/visibility`, "PATCH", makeRequest("PATCH", `/child-achievements/${achievementId}/visibility`, { hidden: true }), env, childActor);
    expect(hide!.status).toBe(200);
    const dashHidden = await safe(handleChildRoutes, "/dashboard/child", "GET", makeRequest("GET", "/dashboard/child"), env, childActor, { waitUntil: () => {} });
    const hiddenPayload = await dashHidden!.json();
    expect(hiddenPayload.data.achievements.some((item: any) => item.id === achievementId)).toBe(false);
    const warehouse = await safe(handleChildRoutes, "/warehouse/achievements", "GET", makeRequest("GET", "/warehouse/achievements"), env, childActor);
    const warehousePayload = await warehouse!.json();
    expect(warehousePayload.data.map((item: any) => item.id)).toContain(achievementId);

    const show = await safe(handleChildRoutes, `/child-achievements/${achievementId}/visibility`, "PATCH", makeRequest("PATCH", `/child-achievements/${achievementId}/visibility`, { hidden: false }), env, childActor);
    expect(show!.status).toBe(200);
    const dashShown = await safe(handleChildRoutes, "/dashboard/child", "GET", makeRequest("GET", "/dashboard/child"), env, childActor, { waitUntil: () => {} });
    const shownPayload = await dashShown!.json();
    expect(shownPayload.data.achievements.map((item: any) => item.id)).toContain(achievementId);
  });

  it("imports config as disabled and ignores missing child assignments", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "Parent A", operatorLabel: "妈妈" };
    const payload = {
      tasks: [{ title: "Imported Task", category_name: "Cat", period: "daily", points: 2, assignee_names: ["Child A", "Missing"], is_active: 1 }],
      rewards: [{ title: "Imported Reward", cost_points: 3, assignee_names: ["Missing"], prerequisites: [{ task_title: "Imported Task", required_count: 2 }], is_active: 1 }],
      achievements: [{ title: "Imported Achievement", threshold: 1, rule_type: "specific_task_completed", target_task_title: "Imported Task", is_active: 1 }],
      feedbackTemplates: [{ kind: "praise", title: "Imported Praise", points: 1, is_active: 1 }]
    };
    const imported = await safe(handleSharedRoutes, "/config/import", "POST", makeRequest("POST", "/config/import", payload), env, parentActor, new URL("http://localhost/api/config/import"));
    expect(imported!.status).toBe(200);
    const stats = await imported!.json();
    expect(stats.data.ignoredAssignments).toBe(2);
    expect((env.DB.prepare("SELECT is_active FROM tasks WHERE title='Imported Task'").first() as any).is_active).toBe(0);
    expect((env.DB.prepare("SELECT is_active FROM rewards WHERE title='Imported Reward'").first() as any).is_active).toBe(0);
    expect((env.DB.prepare("SELECT is_active FROM feedback_templates WHERE title='Imported Praise'").first() as any).is_active).toBe(0);
    const assignees = env.DB.prepare("SELECT COUNT(*) v FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id WHERE t.title='Imported Task'").first() as any;
    expect(Number(assignees.v)).toBe(1);
    const prerequisite = env.DB.prepare("SELECT t.title, rp.required_count FROM reward_prerequisites rp JOIN tasks t ON t.id=rp.task_id JOIN rewards r ON r.id=rp.reward_id WHERE r.title='Imported Reward'").first() as any;
    expect(prerequisite).toMatchObject({ title: "Imported Task", required_count: 2 });
    const achievement = env.DB.prepare("SELECT t.title target_title FROM achievements a JOIN tasks t ON t.id=a.target_task_id WHERE a.title='Imported Achievement'").first() as any;
    expect(achievement.target_title).toBe("Imported Task");
  });

  it("exports required task settings and child assignment names", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "Parent A", operatorLabel: "妈妈" };
    env.DB.prepare("UPDATE tasks SET is_required=1, required_count=3, required_penalty_points=4, required_remedy_enabled=1, required_remedy_condition='收拾书桌', required_remedy_points=2, required_remedy_deadline_hours=12 WHERE id=?").bind(tid).run();
    const rid = id();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES (?, ?, 'Snack', 8, 'daily', '[1,2,3,4,5,6,0]')").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
    env.DB.prepare("INSERT INTO reward_prerequisites (reward_id, task_id, required_count) VALUES (?, ?, 2)").bind(rid, tid).run();
    env.DB.prepare("INSERT INTO achievements (id, parent_id, title, metric, threshold, rule_type, target_task_id) VALUES (?, ?, 'Read Master', 'tasks_completed', 1, 'specific_task_completed', ?)").bind(id(), pid, tid).run();

    const exported = await safe(handleSharedRoutes, "/config/export", "GET", makeRequest("GET", "/config/export"), env, parentActor, new URL("http://localhost/api/config/export"));
    expect(exported!.status).toBe(200);
    const payload = await exported!.json();
    const task = payload.data.tasks.find((item: any) => item.title === "Read");
    expect(task).toMatchObject({
      is_required: 1,
      required_count: 3,
      required_penalty_points: 4,
      required_remedy_enabled: 1,
      required_remedy_condition: "收拾书桌",
      required_remedy_points: 2,
      required_remedy_deadline_hours: 12,
      assignee_names: ["Child A"]
    });
    const reward = payload.data.rewards.find((item: any) => item.title === "Snack");
    expect(reward.assignee_names).toEqual(["Child A"]);
    expect(reward.prerequisites).toEqual([expect.objectContaining({ task_title: "Read", required_count: 2 })]);
    const achievement = payload.data.achievements.find((item: any) => item.title === "Read Master");
    expect(achievement.target_task_title).toBe("Read");
  });
});

describe("Config groups", () => {
  let env: any;
  let pid: string, cid: string, tid: string, rid: string, aid: string;
  const parentActor = () => ({ type: "user", role: "parent", id: pid, displayName: "Parent A", operatorLabel: "妈妈" });

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pid = id();
    cid = id();
    tid = id();
    rid = id();
    aid = id();
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, 'cg-parent', 'x', 'parent', 'Parent A')").bind(pid).run();
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, 'cg-child', 'x', 'Child A', 'active')").bind(cid, pid).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cg-cat', ?, 'Study', 'emoji', '📚')").bind(pid).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, points, period, limit_count, point_type, enabled_weekdays, is_required, required_count, required_penalty_points) VALUES (?, ?, 'cg-cat', 'Read', 'Read book', 6, 'daily', 2, 'earn', '[1,2,3,4,5]', 1, 2, 3)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, limit_period, limit_count, redeem_weekdays, icon_type, icon_value, is_active) VALUES (?, ?, 'Snack', 'Cookie', 8, 'daily', 1, '[1,2,3,4,5]', 'emoji', '🎁', 1)").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO achievements (id, parent_id, title, description, metric, threshold, rule_type, target_task_id, icon_type, icon_value, unlock_reward_id) VALUES (?, ?, 'Reader', 'Read twice', 'tasks_completed', 2, 'specific_task_completed', ?, 'emoji', '🏅', ?)").bind(aid, pid, tid, rid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
    env.DB.prepare("INSERT INTO reward_prerequisites (reward_id, task_id, required_count) VALUES (?, ?, 2)").bind(rid, tid).run();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, 'criticism', 'Late', 'Try again', 5, 'emoji', '⚠️', 1, 1, 'Apologize', 2, 12)").bind(id(), pid).run();
  });

  it("saves and activates a config group as an overwrite snapshot", async () => {
    const create = await safe(handleSharedRoutes, "/config-groups", "POST", makeRequest("POST", "/config-groups", { name: "上学日" }), env, parentActor(), new URL("http://localhost/api/config-groups"));
    expect(create!.status).toBe(200);
    const created = await create!.json();
    expect(created.data.summary).toMatchObject({ tasks: 1, rewards: 1, achievements: 1, feedbackTemplates: 1 });

    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cg-cat-2', ?, 'Play', 'emoji', '🎮')").bind(pid).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'cg-cat-2', 'Game', 1, 'daily', 1, 'earn', '[1]')").bind(id(), pid).run();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, points, icon_type, icon_value) VALUES (?, ?, 'praise', 'Nice', 1, 'emoji', '✨')").bind(id(), pid).run();

    const activatePath = "/config-groups/" + created.data.id + "/activate";
    const activated = await safe(handleSharedRoutes, activatePath, "POST", makeRequest("POST", activatePath, {}), env, parentActor(), new URL("http://localhost/api" + activatePath));
    expect(activated!.status).toBe(200);
    const activePayload = await activated!.json();
    expect(activePayload.data.is_active).toBe(1);
    expect(activePayload.data.applied).toMatchObject({ tasks: 1, rewards: 1, achievements: 1, feedbackTemplates: 1 });

    const tasks = env.DB.prepare("SELECT id, title, is_required, required_count, required_penalty_points FROM tasks WHERE parent_id=? AND deleted_at IS NULL").bind(pid).all().results as any[];
    expect(tasks.map((task) => task.title)).toEqual(["Read"]);
    expect(tasks[0]).toMatchObject({ is_required: 1, required_count: 2, required_penalty_points: 3 });
    const assigned = env.DB.prepare("SELECT COUNT(*) v FROM task_assignees WHERE task_id=? AND child_id=?").bind(tasks[0].id, cid).first() as any;
    expect(Number(assigned.v)).toBe(1);
    const prerequisite = env.DB.prepare("SELECT t.title, rp.required_count FROM reward_prerequisites rp JOIN tasks t ON t.id=rp.task_id JOIN rewards r ON r.id=rp.reward_id WHERE r.parent_id=? AND r.deleted_at IS NULL").bind(pid).first() as any;
    expect(prerequisite).toMatchObject({ title: "Read", required_count: 2 });
    const achievement = env.DB.prepare("SELECT a.title, t.title target_title FROM achievements a JOIN tasks t ON t.id=a.target_task_id WHERE a.parent_id=? AND a.deleted_at IS NULL").bind(pid).first() as any;
    expect(achievement).toMatchObject({ title: "Reader", target_title: "Read" });
    const required = env.DB.prepare("SELECT a.title achievement_title, r.title reward_title FROM achievements a JOIN rewards r ON r.id=a.unlock_reward_id WHERE a.parent_id=? AND a.deleted_at IS NULL").bind(pid).first() as any;
    expect(required).toMatchObject({ achievement_title: "Reader", reward_title: "Snack" });
    const feedback = env.DB.prepare("SELECT title, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL").bind(pid).first() as any;
    expect(feedback).toMatchObject({ title: "Late", is_remediable: 1, remedy_condition: "Apologize", remedy_points: 2, remedy_deadline_hours: 12 });
  });

  it("clears current configurable content while preserving history and other parents", async () => {
    const groupResponse = await safe(handleSharedRoutes, "/config-groups", "POST", makeRequest("POST", "/config-groups", { name: "清空前快照" }), env, parentActor(), new URL("http://localhost/api/config-groups"));
    expect(groupResponse!.status).toBe(200);
    const groupPayload = await groupResponse!.json();

    const otherParentId = id();
    const otherCategoryId = id();
    const otherTaskId = id();
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, 'cg-other-parent', 'x', 'parent', 'Other Parent')").bind(otherParentId).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES (?, ?, 'Other Study', 'emoji', '📘')").bind(otherCategoryId, otherParentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, ?, 'Other Read', '', 1, 'daily', 1, 'earn', '[1]')").bind(otherTaskId, otherParentId, otherCategoryId).run();

    const response = await safe(handleSharedRoutes, "/config/clear-current", "POST", makeRequest("POST", "/config/clear-current", {}), env, parentActor(), new URL("http://localhost/api/config/clear-current"));
    expect(response!.status).toBe(200);
    const payload = await response!.json();
    expect(payload.data).toMatchObject({ categories: 1, tasks: 1, rewards: 1, achievements: 1, feedbackTemplates: 1 });

    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM tasks WHERE parent_id=? AND deleted_at IS NULL").bind(pid).first() as any).v)).toBe(0);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM rewards WHERE parent_id=? AND deleted_at IS NULL").bind(pid).first() as any).v)).toBe(0);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM achievements WHERE parent_id=? AND deleted_at IS NULL").bind(pid).first() as any).v)).toBe(0);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL").bind(pid).first() as any).v)).toBe(0);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM task_categories WHERE owner_id=? AND is_system=0 AND is_active=1").bind(pid).first() as any).v)).toBe(0);

    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM task_assignees WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any).v)).toBe(1);
    const savedGroup = env.DB.prepare("SELECT snapshot_json FROM config_groups WHERE id=? AND parent_id=?").bind(groupPayload.data.id, pid).first() as any;
    expect(JSON.parse(savedGroup.snapshot_json).tasks).toHaveLength(1);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM tasks WHERE parent_id=? AND deleted_at IS NULL").bind(otherParentId).first() as any).v)).toBe(1);
    expect(Number((env.DB.prepare("SELECT COUNT(*) v FROM task_categories WHERE owner_id=? AND is_active=1").bind(otherParentId).first() as any).v)).toBe(1);
  });

  it("limits each parent to five config groups", async () => {
    for (let index = 1; index <= 5; index += 1) {
      const response = await safe(handleSharedRoutes, "/config-groups", "POST", makeRequest("POST", "/config-groups", { name: "配置 " + index }), env, parentActor(), new URL("http://localhost/api/config-groups"));
      expect(response!.status).toBe(200);
    }
    const blocked = await safe(handleSharedRoutes, "/config-groups", "POST", makeRequest("POST", "/config-groups", { name: "第六个" }), env, parentActor(), new URL("http://localhost/api/config-groups"));
    expect(blocked!.status).toBe(409);
  });
});

describe("Input Validation", () => {
  it("validateHttpsUrl rejects localhost", () => {
    expect(validateHttpsUrl("http://localhost:8080", "URL")).not.toBeNull();
  });
  it("validateHttpsUrl rejects HTTP", () => {
    expect(validateHttpsUrl("http://example.com", "URL")).not.toBeNull();
  });
  it("validateHttpsUrl accepts HTTPS", () => {
    expect(validateHttpsUrl("https://api.openai.com", "URL")).toBeNull();
  });
  it("isPrivateUrl blocks private ranges", () => {
    expect(isPrivateUrl("https://10.0.0.1")).toBe(true);
    expect(isPrivateUrl("https://172.16.0.1")).toBe(true);
    expect(isPrivateUrl("https://192.168.1.1")).toBe(true);
    expect(isPrivateUrl("https://169.254.169.254")).toBe(true);
    expect(isPrivateUrl("https://127.0.0.1")).toBe(true);
  });
  it("isPrivateUrl allows public HTTPS", () => {
    expect(isPrivateUrl("https://api.openai.com")).toBe(false);
  });
  it("truncateAiOutput truncates long text", () => {
    const long = "a".repeat(200);
    expect(truncateAiOutput(long).length).toBe(121);
  });
  it("truncateAiOutput keeps short text", () => {
    expect(truncateAiOutput("hello")).toBe("hello");
  });
  it("stripAiThinking removes complete, repeated, orphan, and unclosed think tags", () => {
    expect(stripAiThinking("A<think>hidden</think>B")).toBe("AB");
    expect(stripAiThinking("<THINK>one</THINK>Keep<think>two</think>")).toBe("Keep");
    expect(stripAiThinking("draft</think>final")).toBe("draftfinal");
    expect(stripAiThinking("visible<think>unfinished")).toBe("visible");
  });
});

describe("Child schedule plan text", () => {
  let env: any;
  let pid: string;
  let cid: string;
  let tid: string;
  const parentActor = () => ({ type: "user", role: "parent", id: pid, displayName: "Parent" });
  const childActor = () => ({ type: "child", role: "child", id: cid, parent_id: pid, parentId: pid, displayName: "Child" });
  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pid = id();
    cid = id();
    tid = id();
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, 'sched-parent', ?, 'parent', 'Parent')").bind(pid, await hashPassword("pw")).run();
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, 'sched-child', ?, 'Child', 'active')").bind(cid, pid, await hashPassword("cpw")).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('sched-cat', ?, 'Reading', 'emoji', '📚')").bind(pid).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays, description) VALUES (?, ?, 'sched-cat', 'Read', 5, 'daily', 3, 'earn', '[1,2,3,4,5,6,0]', 'Read quietly')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
  });
  it("saves sanitized plan HTML and includes it in schedule print", async () => {
    const slotId = id();
    const save = await safe(handleChildRoutes, "/child-schedule", "PUT", makeRequest("PUT", "/child-schedule", { slots: [{ id: slotId, title: "Morning", startMinutes: 480, endMinutes: 540, planHtml: "<p><strong>Read</strong><script>alert(1)</script></p>" }], items: [{ id: id(), slotId, taskId: tid }] }), env, childActor());
    expect(save!.status).toBe(200);
    const loaded = await safe(handleChildRoutes, "/child-schedule", "GET", makeRequest("GET", "/child-schedule"), env, childActor());
    const body = await loaded!.json();
    expect(body.data.slots[0].plan_html).toBe("<p><strong>Read</strong></p>");
    const print = await safe(handleParentRoutes, `/children/${cid}/schedule-print`, "GET", makeRequest("GET", `/children/${cid}/schedule-print`), env, parentActor());
    const html = await print!.text();
    expect(html).toContain("@page{size:A4");
    expect(html).toContain("<h3>计划</h3>");
    expect(html).toContain("<p><strong>Read</strong></p>");
    expect(html).toContain("print-task-card");
    expect(html).not.toContain("<script>");
  });
  it("includes schedule plans in weekly reports", async () => {
    const slotId = id();
    await safe(handleChildRoutes, "/child-schedule", "PUT", makeRequest("PUT", "/child-schedule", { slots: [{ id: slotId, title: "Evening", startMinutes: 1140, endMinutes: 1200, planHtml: "<p>Review notes</p>" }], items: [{ id: id(), slotId, taskId: tid }] }), env, childActor());
    const req = makeRequest("GET", `/children/${cid}/report?period=weekly&anchor=2026-06-03T00:00:00.000Z`);
    const report = await safe(handleParentRoutes, `/children/${cid}/report`, "GET", req, env, parentActor(), new URL(req.url));
    const html = await report!.text();
    expect(html).toContain("@page{size:A4");
    expect(html).toContain("日程安排");
    expect(html).toContain("Review notes");
    expect(html).toContain("print-task-card");
  });
});

describe("Parent AI Service Validation", () => {
  let env: any;
  let parentId: string;
  beforeEach(async () => {
    env = resetTestEnv(); await ensureAdmin(env); await clearLoginAttempts(env);
    parentId = id();
    const pw = await hashPassword("parent-ai-pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'AI Parent')").bind(parentId, "parent-ai", pw).run();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  async function asAdmin() {
    const c = await login(env, "admin", "test-admin-pw");
    const a = await actorFromRequest(makeRequest("GET", "/auth/me", undefined, `session=${c}`), env);
    return { cookie: c, actor: a };
  }
  async function seedAiChild(aiEnabled = 1) {
    const childId = id();
    const pw = await hashPassword("child-ai-pw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, ai_enabled) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(childId, parentId, `child-${childId}`, pw, "AI Child", aiEnabled)
      .run();
    return childId;
  }
  function stubChat(text = "AI generated commentary") {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  function stubImage(responseBody: any = { data: [{ url: "https://cdn.example.com/report.jpeg" }] }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.example.com/v1/chat/completions") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "AI image commentary" } }] }), { status: 200 });
      }
      expect(String(input)).toBe("https://image.example.com/v1/images/generations");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
      expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer img-key");
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.model).toBe("gpt-image-2");
      expect(body.n).toBe(1);
      expect(body.size).toBe("1024x1024");
      expect(body.quality).toBe("low");
      expect(body.format).toBe("jpeg");
      expect(body.prompt).toContain("cartoon style");
      expect(body.prompt).toContain("AI Child");
      expect(body.prompt).toContain("AI image commentary");
      return new Response(JSON.stringify(responseBody), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("rejects AI baseUrl with HTTP", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "http://localhost", model: "gpt-4o-mini", prompt: "hello" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("rejects AI baseUrl with localhost", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://localhost:8080", model: "gpt-4o-mini", prompt: "hello" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("accepts valid HTTPS AI baseUrl", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", prompt: "hello", apiKey: "sk-test" }), env, actor);
    expect(r!.status).toBe(200);
    const getRes = await safe(handleParentRoutes, "/parent/ai-service", "GET", makeRequest("GET", "/parent/ai-service"), env, actor);
    expect(getRes!.status).toBe(200);
    const config = await getRes!.json();
    expect(config.data.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.data.model).toBe("gpt-4o-mini");
    expect(config.data.hasKey).toBe(true);
    expect(config.data.apiKey).toBeUndefined();
  });
  it("creates missing parent AI settings table before saving", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    env.DB.prepare("DROP TABLE parent_ai_service_settings").run();
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-test", prompt: "hello", apiKey: "sk-test" }), env, actor);
    expect(r!.status).toBe(200);
    const row = env.DB.prepare("SELECT base_url, model, api_key FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
    expect(row.base_url).toBe("https://api.example.com/v1");
    expect(row.model).toBe("gpt-test");
    expect(row.api_key).toBe("sk-test");
  });
  it("keeps saved AI key when later updates omit apiKey", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1/", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1/", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key" }), env, actor);
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1/", model: "gpt-b", prompt: "updated", imageModel: "gpt-image-2", imagePrompt: "updated cartoon" }), env, actor);
    expect(r!.status).toBe(200);
    const row = env.DB.prepare("SELECT base_url, model, prompt, api_key, image_base_url, image_prompt, image_api_key FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
    expect(row.base_url).toBe("https://api.example.com/v1");
    expect(row.model).toBe("gpt-b");
    expect(row.prompt).toBe("updated");
    expect(row.api_key).toBe("sk-test");
    expect(row.image_base_url).toBe("https://image.example.com/v1");
    expect(row.image_prompt).toBe("updated cartoon");
    expect(row.image_api_key).toBe("img-key");
    const getRes = await safe(handleParentRoutes, "/parent/ai-service", "GET", makeRequest("GET", "/parent/ai-service"), env, actor);
    const config = await getRes!.json();
    expect(config.data.hasImageKey).toBe(true);
    expect(config.data.imageApiKey).toBeUndefined();
  });
  it("rejects invalid image AI baseUrl", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "http://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("fetches AI models with saved key, timeout, and manual redirects", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.com/v1/models");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
      expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer sk-test");
      return new Response(JSON.stringify({ data: [{ id: "gpt-a" }, { id: 123 }, {}, { id: " gpt-b " }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await safe(handleParentRoutes, "/parent/ai-service/models", "POST", makeRequest("POST", "/parent/ai-service/models", { baseUrl: "https://api.example.com/v1" }), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.models).toEqual(["gpt-a", "gpt-b"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("runs midnight scheduled refresh for daily greeting and previous weekly commentary once", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = stubChat("Scheduled weekly");
    const result = await runScheduledAiRefresh(env, new Date("2026-06-07T16:00:00.000Z"));
    expect(result.jobs.map((job: any) => job.jobType)).toEqual(["greeting_daily", "report_weekly"]);
    expect(result.jobs.every((job: any) => job.skipped === false)).toBe(true);
    expect(result.jobs.map((job: any) => job.enqueued)).toEqual([1, 1]);
    expect(result.queue.completed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const weeklyKey = reportWindowRange("weekly", "2026-06-07T00:00:00.000Z", 480).label;
    const commentary = env.DB.prepare("SELECT commentary FROM ai_report_commentaries WHERE child_id=? AND period_type='weekly' AND period_key=?").bind(childId, weeklyKey).first() as any;
    expect(commentary.commentary).toBe("Scheduled weekly");
    const greeting = env.DB.prepare("SELECT greeting, previous_week_key FROM ai_child_greetings WHERE child_id=?").bind(childId).first() as any;
    expect(greeting.greeting).toBe("Scheduled weekly");
    expect(greeting.previous_week_key).toBe("2026-06-08");

    const second = await runScheduledAiRefresh(env, new Date("2026-06-07T16:30:00.000Z"));
    expect(second.jobs.every((job: any) => job.skipped === true)).toBe(true);
    expect(second.queue.empty).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("runs first-of-month scheduled refresh for previous monthly commentary", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = stubChat("Scheduled monthly");
    const result = await runScheduledAiRefresh(env, new Date("2026-06-30T16:00:00.000Z"));
    expect(result.jobs.map((job: any) => job.jobType)).toEqual(["greeting_daily", "report_monthly"]);
    expect(result.jobs.map((job: any) => job.enqueued)).toEqual([1, 1]);
    expect(result.queue.completed).toBe(2);
    const monthlyKey = reportWindowRange("monthly", "2026-06-15T00:00:00.000Z", 480).label;
    const row = env.DB.prepare("SELECT commentary FROM ai_report_commentaries WHERE child_id=? AND period_type='monthly' AND period_key=?").bind(childId, monthlyKey).first() as any;
    expect(row.commentary).toBe("Scheduled monthly");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retries AI rate limits and logs final queue failure", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    const scheduled = await runScheduledAiRefresh(env, new Date("2026-06-07T16:00:00.000Z"));
    expect(scheduled.queue.retried).toBe(2);
    let rows = env.DB.prepare("SELECT type, status, retry_count, error_code FROM ai_generation_queue ORDER BY type").all().results as any[];
    expect(rows.every((row) => row.status === "pending")).toBe(true);
    expect(rows.every((row) => row.retry_count === 1)).toBe(true);
    expect(rows.every((row) => row.error_code === "AI_RATE_LIMITED")).toBe(true);

    env.DB.prepare("UPDATE ai_generation_queue SET retry_count=2, next_attempt_at='2000-01-01T00:00:00.000Z'").run();
    const processed = await processAiGenerationQueue(env, { offset: 480, maxJobs: 2, intervalMs: 0 } as any);
    expect(processed.failed).toBe(2);
    rows = env.DB.prepare("SELECT status, retry_count FROM ai_generation_queue").all().results as any[];
    expect(rows.every((row) => row.status === "failed")).toBe(true);
    expect(rows.every((row) => row.retry_count === 3)).toBe(true);
    const logs = env.DB.prepare("SELECT source, message FROM system_error_logs WHERE source='ai_queue'").all().results as any[];
    expect(logs.length).toBe(2);
    expect(logs[0].message).toContain("429");
  });
  it("does not call the AI provider for non-retryable queued jobs", async () => {
    await seedAiChild(0);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const scheduled = await runScheduledAiRefresh(env, new Date("2026-06-07T16:00:00.000Z"));
    expect(scheduled.jobs.map((job: any) => job.enqueued)).toEqual([0, 0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("previews AI content without writing caches", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = stubChat("Preview text");
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview", "POST", makeRequest("POST", "/parent/ai-service/preview", { childId, type: "weeklyReport" }), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.text).toBe("Preview text");
    expect(env.DB.prepare("SELECT COUNT(*) as count FROM ai_report_commentaries").first().count).toBe(0);
    expect(env.DB.prepare("SELECT COUNT(*) as count FROM ai_child_greetings").first().count).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("preview/cache writes weekly report commentary into ai_report_commentaries", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", reportPrompt: "report prompt" }), env, actor);
    const text = "Cached weekly commentary";
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "weeklyReport", text }), env, actor);
    expect(r!.status).toBe(200);
    const rows = env.DB.prepare("SELECT * FROM ai_report_commentaries").all().results as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].commentary).toBe(text);
    expect(rows[0].period_type).toBe("weekly");
    expect(rows[0].child_id).toBe(childId);
  });
  it("preview/cache writes greeting into ai_child_greetings", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const text = "Cached greeting text";
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "greeting", text }), env, actor);
    expect(r!.status).toBe(200);
    const rows = env.DB.prepare("SELECT * FROM ai_child_greetings").all().results as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].greeting).toBe(text);
    expect(rows[0].child_id).toBe(childId);
  });
  it("limits child summary greeting to 200 characters", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const text = "你".repeat(220);
    await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "greeting", text }), env, actor);
    const childActor = { type: "child", role: "child", id: childId, parent_id: parentId, displayName: "AI Child" };
    const res = await safe(handleChildRoutes, "/dashboard/child-summary", "GET", makeRequest("GET", "/dashboard/child-summary"), env, childActor);
    expect(res!.status).toBe(200);
    const payload = await res!.json();
    expect(Array.from(payload.data.aiGreeting)).toHaveLength(200);
  });
  it("preview/cache writes monthly report commentary into ai_report_commentaries", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", monthlyPrompt: "monthly prompt" }), env, actor);
    const text = "Cached monthly commentary";
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "monthlyReport", text }), env, actor);
    expect(r!.status).toBe(200);
    const rows = env.DB.prepare("SELECT * FROM ai_report_commentaries").all().results as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].commentary).toBe(text);
    expect(rows[0].period_type).toBe("monthly");
  });
  it("preview/cache rejects empty text", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "weeklyReport", text: "" }), env, actor);
    expect(r!.status).toBe(400);
    expect(env.DB.prepare("SELECT COUNT(*) as count FROM ai_report_commentaries").first().count).toBe(0);
  });
  it("preview/cache rejects non-existent child", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId: "non-existent", type: "weeklyReport", text: "text" }), env, actor);
    expect(r!.status).toBe(404);
  });
  it("preview/cache rejects disabled AI child", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(0);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const r = await safe(handleParentRoutes, "/parent/ai-service/preview/cache", "POST", makeRequest("POST", "/parent/ai-service/preview/cache", { childId, type: "weeklyReport", text: "text" }), env, actor);
    expect(r!.status).toBe(400);
    expect(env.DB.prepare("SELECT COUNT(*) as count FROM ai_report_commentaries").first().count).toBe(0);
  });
  it("generates a cartoon weekly report image without caching it", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1 }), env, actor);
    const fetchMock = stubImage();
    const r = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "weekly" }), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.status).toBe("pending");
    expect(data.data.imageUrl).toBe("");
    const processed = await processCartoonReportJobs(env, { maxJobs: 1 } as any);
    expect(processed.completed).toBe(1);
    const getRes = await safe(handleParentRoutes, `/parent/ai-service/cartoon-report/${data.data.id}`, "GET", makeRequest("GET", `/parent/ai-service/cartoon-report/${data.data.id}`), env, actor);
    const completed = await getRes!.json();
    expect(completed.data.imageUrl).toBe("https://cdn.example.com/report.jpeg");
    expect(completed.data.format).toBe("jpeg");
    expect(completed.data.filename).toContain("weekly-cartoon-report.jpeg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(env.DB.prepare("SELECT COUNT(*) as count FROM ai_report_commentaries").first().count).toBe(1);
  });
  it("parses cartoon report image URLs, base64 payloads, and choice content", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key" }), env, actor);
    const base64 = "a".repeat(120);
    const responses = [
      { data: [{ url: "https://cdn.example.com/a.jpeg" }] },
      { b64_json: base64 },
      { choices: [{ message: { content: "https://cdn.example.com/from-choice.jpeg" } }] }
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.example.com/v1/chat/completions") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "AI image commentary" } }] }), { status: 200 });
      }
      expect(String(input)).toBe("https://image.example.com/v1/images/generations");
      expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer img-key");
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const urls: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "monthly", retry: true }), env, actor);
      expect(r!.status).toBe(200);
      const data = await r!.json();
      await processCartoonReportJobs(env, { maxJobs: 1 } as any);
      const getRes = await safe(handleParentRoutes, `/parent/ai-service/cartoon-report/${data.data.id}`, "GET", makeRequest("GET", `/parent/ai-service/cartoon-report/${data.data.id}`), env, actor);
      const completed = await getRes!.json();
      urls.push(completed.data.imageUrl);
      env.DB.prepare("UPDATE ai_cartoon_report_jobs SET status='failed' WHERE id=?").bind(data.data.id).run();
    }
    expect(urls).toEqual([
      "https://cdn.example.com/a.jpeg",
      `data:image/jpeg;base64,${base64}`,
      "https://cdn.example.com/from-choice.jpeg"
    ]);
  });
  it("rejects cartoon report generation when image config is incomplete", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const r = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "weekly" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("generates a print checklist image with its own prompt", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", checklistImagePrompt: "checklist poster style", imageApiKey: "img-key", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1 }), env, actor);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://image.example.com/v1/images/generations");
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.prompt).toContain("checklist poster style");
      expect(body.prompt).toContain("AI Child");
      expect(body.prompt).not.toContain("cartoon style");
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/checklist.jpeg" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await safe(handleParentRoutes, `/children/${childId}/print-checklist-image`, "POST", makeRequest("POST", `/children/${childId}/print-checklist-image`, {}), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.status).toBe("pending");
    await processPrintChecklistImageJobs(env, { maxJobs: 1 } as any);
    const getRes = await safe(handleParentRoutes, `/children/${childId}/print-checklist-image/${data.data.id}`, "GET", makeRequest("GET", `/children/${childId}/print-checklist-image/${data.data.id}`), env, actor);
    const completed = await getRes!.json();
    expect(completed.data.imageUrl).toBe("https://cdn.example.com/checklist.jpeg");
    expect(completed.data.filename).toContain("print-checklist.jpeg");
  });
  it("generates a schedule image with plan text", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    const taskId = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('schedule-ai-cat', ?, 'Cat', 'emoji', '📚')").bind(parentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'schedule-ai-cat', 'Read', 5, 'daily', 2, 'earn', '[1,2,3,4,5,6,0]')").bind(taskId, parentId).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(taskId, childId).run();
    await safe(handleChildRoutes, "/child-schedule", "PUT", makeRequest("PUT", "/child-schedule", { slots: [{ id: "slot-ai", title: "Morning", startMinutes: 480, endMinutes: 540, planHtml: "<p><strong>Read plan</strong></p>" }], items: [{ id: "item-ai", slotId: "slot-ai", taskId }] }), env, { type: "child", role: "child", id: childId, parent_id: parentId, parentId, displayName: "AI Child" });
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", scheduleImagePrompt: "schedule poster style", imageApiKey: "img-key", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1 }), env, actor);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://image.example.com/v1/images/generations");
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.prompt).toContain("schedule poster style");
      expect(body.prompt).toContain("Read plan");
      expect(body.prompt).toContain("Read");
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/schedule.jpeg" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await safe(handleParentRoutes, `/children/${childId}/schedule-image`, "POST", makeRequest("POST", `/children/${childId}/schedule-image`, {}), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    await processScheduleImageJobs(env, { maxJobs: 1 } as any);
    const getRes = await safe(handleParentRoutes, `/children/${childId}/schedule-image/${data.data.id}`, "GET", makeRequest("GET", `/children/${childId}/schedule-image/${data.data.id}`), env, actor);
    const completed = await getRes!.json();
    expect(completed.data.imageUrl).toBe("https://cdn.example.com/schedule.jpeg");
  });
  it("force=true re-enqueues a completed cartoon job and clears the cached image", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1 }), env, actor);
    stubImage({ data: [{ url: "https://cdn.example.com/first.jpeg" }] });
    const r1 = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "weekly" }), env, actor);
    expect(r1!.status).toBe(200);
    const data1 = await r1!.json();
    await processCartoonReportJobs(env, { maxJobs: 1 } as any);
    const get1 = await safe(handleParentRoutes, `/parent/ai-service/cartoon-report/${data1.data.id}`, "GET", makeRequest("GET", `/parent/ai-service/cartoon-report/${data1.data.id}`), env, actor);
    const completed1 = await get1!.json();
    expect(completed1.data.status).toBe("completed");
    expect(completed1.data.imageUrl).toBe("https://cdn.example.com/first.jpeg");
    stubImage({ data: [{ url: "https://cdn.example.com/second.jpeg" }] });
    const r2 = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "weekly", force: true }), env, actor);
    expect(r2!.status).toBe(200);
    const data2 = await r2!.json();
    expect(data2.data.id).toBe(data1.data.id);
    expect(data2.data.status).toBe("pending");
    expect(data2.data.imageUrl).toBe("");
    await processCartoonReportJobs(env, { maxJobs: 1 } as any);
    const get2 = await safe(handleParentRoutes, `/parent/ai-service/cartoon-report/${data1.data.id}`, "GET", makeRequest("GET", `/parent/ai-service/cartoon-report/${data1.data.id}`), env, actor);
    const completed2 = await get2!.json();
    expect(completed2.data.status).toBe("completed");
    expect(completed2.data.imageUrl).toBe("https://cdn.example.com/second.jpeg");
  });
  it("force=true preempts a processing cartoon job and re-acquires the lock", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test", imageBaseUrl: "https://image.example.com/v1", imageModel: "gpt-image-2", imagePrompt: "cartoon style", imageApiKey: "img-key", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1 }), env, actor);
    const r1 = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "monthly" }), env, actor);
    const data1 = await r1!.json();
    await env.DB.prepare("UPDATE ai_cartoon_report_jobs SET status='processing', started_at=?, locked_until=?, updated_at=? WHERE id=?")
      .bind(new Date().toISOString(), new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), data1.data.id).run();
    const processing = await env.DB.prepare("SELECT status FROM ai_cartoon_report_jobs WHERE id=?").bind(data1.data.id).first();
    expect(processing.status).toBe("processing");
    stubImage({ data: [{ url: "https://cdn.example.com/regen.jpeg" }] });
    const r2 = await safe(handleParentRoutes, "/parent/ai-service/cartoon-report", "POST", makeRequest("POST", "/parent/ai-service/cartoon-report", { childId, period: "monthly", force: true }), env, actor);
    expect(r2!.status).toBe(200);
    const data2 = await r2!.json();
    expect(data2.data.id).toBe(data1.data.id);
    expect(data2.data.status).toBe("pending");
    const after = await env.DB.prepare("SELECT status, started_at, completed_at, image_url FROM ai_cartoon_report_jobs WHERE id=?").bind(data1.data.id).first();
    expect(after.status).toBe("pending");
    expect(after.started_at).toBeNull();
    expect(after.completed_at).toBeNull();
    expect(after.image_url).toBeNull();
    await processCartoonReportJobs(env, { maxJobs: 1 } as any);
    const get = await safe(handleParentRoutes, `/parent/ai-service/cartoon-report/${data1.data.id}`, "GET", makeRequest("GET", `/parent/ai-service/cartoon-report/${data1.data.id}`), env, actor);
    const completed = await get!.json();
    expect(completed.data.status).toBe("completed");
    expect(completed.data.imageUrl).toBe("https://cdn.example.com/regen.jpeg");
  });
  it("old manual AI refresh and queue endpoints are unavailable", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    for (const [path, method] of [
      ["/parent/ai-service/refresh-greetings", "POST"],
      ["/parent/ai-service/refresh-commentaries", "POST"],
      ["/parent/ai-service/queue-status", "GET"],
      ["/parent/ai-service/process-queue", "POST"],
      [`/children/${id()}/report-commentary`, "POST"],
      [`/children/${id()}/ai-greeting`, "POST"]
    ] as const) {
      const r = await safe(handleParentRoutes, path, method, makeRequest(method, path), env, actor, new URL(`http://localhost/api${path}`));
      expect(r).toBeFalsy();
    }
  });
  it("renders cached report commentary and does not generate missing commentary", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const weeklyKey = reportWindowRange("weekly", "2026-06-03T00:00:00.000Z", 480).label;
    const weeklyHash = aiReportConfigHash({ baseUrl: "https://api.example.com/v1", model: "gpt-a", reportPrompt: "", monthlyPrompt: "" }, "weekly");
    env.DB.prepare("INSERT INTO ai_report_commentaries (child_id, parent_id, period_key, period_type, config_hash, commentary, generated_at) VALUES (?, ?, ?, 'weekly', ?, 'Cached commentary', '2026-06-01T00:00:00.000Z')")
      .bind(childId, parentId, weeklyKey, weeklyHash)
      .run();
    const fetchMock = stubChat("Generated monthly commentary");
    const weeklyReq = makeRequest("GET", `/children/${childId}/report?period=weekly&anchor=2026-06-03T00:00:00.000Z`);
    const weekly = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", weeklyReq, env, actor, new URL(weeklyReq.url));
    const weeklyHtml = await weekly!.text();
    expect(weeklyHtml).toContain("Cached commentary");
    const monthlyReq = makeRequest("GET", `/children/${childId}/report?period=monthly&anchor=2026-06-03T00:00:00.000Z`);
    const monthly = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", monthlyReq, env, actor, new URL(monthlyReq.url));
    const monthlyHtml = await monthly!.text();
    expect(monthlyHtml).not.toContain("Generated monthly commentary");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders weekly report when AI commentary table is missing", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    env.DB.prepare("DROP TABLE ai_report_commentaries").run();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const req = makeRequest("GET", `/children/${childId}/report?period=weekly&anchor=2026-06-03T00:00:00.000Z`);
    const report = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", req, env, actor, new URL(req.url));
    expect(report!.status).toBe(200);
    expect(report!.headers.get("content-type")).toContain("text/html");
    const html = await report!.text();
    expect(html).toContain("AI Child");
  });
  it("renders report without creating missing monthly commentary", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    env.DB.prepare("DROP TABLE ai_report_commentaries").run();
    const fetchMock = stubChat("Auto-created monthly commentary");
    const req = makeRequest("GET", `/children/${childId}/report?period=monthly&anchor=2026-06-03T00:00:00.000Z`);
    const report = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", req, env, actor, new URL(req.url));
    expect(report!.status).toBe(200);
    const html = await report!.text();
    expect(html).toContain("AI Child");
    const row = env.DB.prepare("SELECT period_type, commentary FROM ai_report_commentaries WHERE child_id=?").bind(childId).first() as any;
    expect(row).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders report without commentary when AI service fails", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const req = makeRequest("GET", `/children/${childId}/report?period=weekly&anchor=2026-06-03T00:00:00.000Z`);
    const report = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", req, env, actor, new URL(req.url));
    expect(report!.status).toBe(200);
    const html = await report!.text();
    expect(html).toContain("AI Child");
    expect(html).not.toContain("AI generated commentary");
  });
  it("rejects gallery URL with javascript scheme", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/gallery-images", "POST", makeRequest("POST", "/admin/gallery-images", { name: "test", url: "javascript:alert(1)" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("rejects gallery URL with file scheme", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/gallery-images", "POST", makeRequest("POST", "/admin/gallery-images", { name: "test", url: "file:///etc/passwd" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("allows only admins to read maintenance stats and AI queue health", async () => {
    const { actor } = await asAdmin();
    const childId = await seedAiChild(1);
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, created_at) VALUES ('q-pending', ?, ?, 'greeting', 'p1', 'pending', ?)").bind(parentId, childId, recent).run();
    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, created_at, completed_at) VALUES ('q-failed', ?, ?, 'report_weekly', 'p2', 'failed', ?, ?)").bind(parentId, childId, recent, recent).run();
    env.DB.prepare("INSERT INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, created_at, completed_at) VALUES ('q-completed', ?, ?, 'report_monthly', 'p3', 'completed', ?, ?)").bind(parentId, childId, recent, recent).run();

    const okRes = await safe(handleAdminRoutes, "/admin/maintenance-stats", "GET", makeRequest("GET", "/admin/maintenance-stats"), env, actor);
    expect(okRes!.status).toBe(200);
    const data = await okRes!.json();
    expect(data.data.retentionDays.aiJob).toBe(92);
    expect(data.data.aiJobs.totalBacklog).toBeGreaterThanOrEqual(1);
    const queue = data.data.aiJobs.queues.find((item: any) => item.key === "generationQueue");
    expect(queue.backlog).toBe(1);
    expect(queue.failedRecent).toBe(1);
    expect(queue.terminalRecent).toBe(2);
    expect(queue.failureRate).toBe(0.5);

    const denied = await safe(handleAdminRoutes, "/admin/maintenance-stats", "GET", makeRequest("GET", "/admin/maintenance-stats"), env, { type: "user", role: "parent", id: parentId });
    expect(denied!.status).toBe(403);
  });
  it("allows only admins to read system error logs", async () => {
    const { actor } = await asAdmin();
    env.DB.prepare("INSERT INTO system_error_logs (id, source, message, created_at) VALUES ('log-1', 'api', 'boom', '2026-06-01T00:00:00.000Z')").run();
    const okRes = await safe(handleAdminRoutes, "/admin/system-error-logs", "GET", makeRequest("GET", "/admin/system-error-logs"), env, actor);
    expect(okRes!.status).toBe(200);
    const data = await okRes!.json();
    expect(data.data[0].message).toBe("boom");

    const denied = await safe(handleAdminRoutes, "/admin/system-error-logs", "GET", makeRequest("GET", "/admin/system-error-logs"), env, { type: "user", role: "parent", id: parentId });
    expect(denied!.status).toBe(403);
  });
});

describe("API client auth errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows bad credentials for login 401 without dispatching unauthorized", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("CustomEvent", class CustomEvent { type: string; constructor(type: string) { this.type = type; } });
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "BAD_CREDENTIALS", message: "账号或密码错误" } }), { status: 401, headers: { "content-type": "application/json" } })));
    await expect(api("/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "bad" }) })).rejects.toThrow("账号或密码错误");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps session-expired behavior for non-login 401", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("CustomEvent", class CustomEvent { type: string; constructor(type: string) { this.type = type; } });
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }), { status: 401, headers: { "content-type": "application/json" } })));
    await expect(api("/admin/users")).rejects.toThrow("登录已过期");
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
