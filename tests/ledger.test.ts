import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { handleChildRoutes } from "../server/api/routes/child.js";
import { handleSharedRoutes } from "../server/api/routes/shared.js";

function makeRequest(m: string, p: string, b?: any): Request {
  return new Request(`http://localhost/api${p}`, { method: m, headers: { "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) });
}
function norm(p: string) { return `/${(p.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`; }
async function safe(h: Function, ...a: any[]) { try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; } }

describe("Task 33: Points Ledger", () => {
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
    tid = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat-1', ?, 'Cat', 'emoji', '📚')").bind(pid).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
  });

  it("task approval adds points to ledger", async () => {
    const actor = { type: "user", role: "parent", id: pid };
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'pending', ?, '2026-06-03')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const req = makeRequest("PATCH", `/task-submissions/${subId}/review`, { approved: true, note: "" });
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "PATCH", req, env, actor);
    expect(res!.status).toBe(200);
    const total = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(total.b)).toBe(10);
  });

  it("reward cancel returns points", async () => {
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "TP" };
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const rid = id();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES (?, ?, 'TR', 30, 'daily', '[1,2,3,4,5,6,0]')").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
    const rr = makeRequest("POST", "/reward-redemptions", { rewardId: rid });
    const rp = norm(new URL(rr.url).pathname);
    const rrRes = await safe(handleChildRoutes, rp, "POST", rr, env, childActor);
    expect(rrRes!.status).toBe(200);
    const red = env.DB.prepare("SELECT id FROM reward_redemptions WHERE child_id=? AND status='pending'").bind(cid).first() as any;
    expect(red).not.toBeNull();
    const cr = makeRequest("PATCH", `/reward-redemptions/${red.id}/cancel`, {});
    const cp = norm(new URL(cr.url).pathname);
    const cRes = await safe(handleParentRoutes, cp, "PATCH", cr, env, parentActor);
    expect(cRes!.status).toBe(200);
    const bal = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(bal.b)).toBe(100);
  });

  it("feedback recall restores points and preserves source labels", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "TP" };
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const templateId = id();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active) VALUES (?, ?, 'praise', 'Great job', '', 8, 'emoji', '馃憦', 1)").bind(templateId, pid).run();
    const feedbackReq = makeRequest("POST", `/children/${cid}/feedback-events`, { templateId });
    const feedbackRes = await safe(handleParentRoutes, norm(new URL(feedbackReq.url).pathname), "POST", feedbackReq, env, parentActor);
    expect(feedbackRes!.status).toBe(200);
    const original = env.DB.prepare("SELECT id, amount FROM point_ledger WHERE child_id=? AND source_type='praise'").bind(cid).first() as any;
    expect(original).not.toBeNull();
    expect(Number(original.amount)).toBe(8);

    const recallReq = makeRequest("PATCH", `/feedback-events/${original.id}/recall`, {});
    const recallRes = await safe(handleSharedRoutes, norm(new URL(recallReq.url).pathname), "PATCH", recallReq, env, parentActor);
    expect(recallRes!.status).toBe(200);

    const ledgerReq = makeRequest("GET", `/points/ledger?childId=${cid}`);
    const ledgerRes = await safe(handleSharedRoutes, norm(new URL(ledgerReq.url).pathname), "GET", ledgerReq, env, parentActor, new URL(ledgerReq.url));
    expect(ledgerRes!.status).toBe(200);
    const ledger = await ledgerRes!.json();
    const recallRow = ledger.data.items.find((row: any) => row.source_type === "feedback_recall");
    expect(recallRow).toBeTruthy();
    expect(recallRow.sourceTypeLabel).toBe("表扬撤回");
    expect(recallRow.sourceLabel).toContain("Great job");

    const notificationsReq = makeRequest("GET", "/notifications");
    const notificationsRes = await safe(handleSharedRoutes, norm(new URL(notificationsReq.url).pathname), "GET", notificationsReq, env, childActor, new URL(notificationsReq.url));
    expect(notificationsRes!.status).toBe(200);
    const notifications = await notificationsRes!.json();
    const recallNotification = notifications.data.items.find((item: any) => item.event_type === "feedback_recall");
    expect(recallNotification).toBeTruthy();
    expect(recallNotification.sourceTypeLabel).toBe("表扬");
    expect(recallNotification.sourceLabel).toContain("Great job");
  });

  it("remediable criticism freezes points until parent confirms remedy", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "TP" };
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const templateId = id();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, 'criticism', 'Clean desk', '', 10, 'emoji', '!', 1, 1, '整理书桌', 6, 24)")
      .bind(templateId, pid)
      .run();

    const feedbackReq = makeRequest("POST", `/children/${cid}/feedback-events`, { templateId });
    const feedbackRes = await safe(handleParentRoutes, norm(new URL(feedbackReq.url).pathname), "POST", feedbackReq, env, parentActor);
    expect(feedbackRes!.status).toBe(200);
    const frozen = env.DB.prepare("SELECT id, amount, frozen_amount, freeze_status FROM point_ledger WHERE child_id=? AND source_type='criticism'").bind(cid).first() as any;
    expect(Number(frozen.amount)).toBe(0);
    expect(Number(frozen.frozen_amount)).toBe(10);
    expect(frozen.freeze_status).toBe("frozen");
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(0);

    const childDashReq = makeRequest("GET", "/dashboard/child");
    const childDashRes = await safe(handleChildRoutes, norm(new URL(childDashReq.url).pathname), "GET", childDashReq, env, childActor, new URL(childDashReq.url));
    const childDash = await childDashRes!.json();
    expect(childDash.data.balance).toBe(0);
    expect(childDash.data.frozenPoints).toBe(10);
    expect(childDash.data.remedyCriticisms).toHaveLength(1);
    expect(childDash.data.remedyCriticisms[0].remedyCondition).toBe("整理书桌");

    const parentDashReq = makeRequest("GET", "/dashboard/parent");
    const parentDashRes = await safe(handleSharedRoutes, norm(new URL(parentDashReq.url).pathname), "GET", parentDashReq, env, parentActor, new URL(parentDashReq.url));
    const parentDash = await parentDashRes!.json();
    expect(parentDash.data.children[0].frozenPoints).toBe(10);
    expect(parentDash.data.remedyCriticisms).toHaveLength(1);
    expect(parentDash.data.remedyCriticisms[0].childId).toBe(cid);

    const remedyReq = makeRequest("PATCH", `/feedback-events/${frozen.id}/remedy`, {});
    const remedyRes = await safe(handleSharedRoutes, norm(new URL(remedyReq.url).pathname), "PATCH", remedyReq, env, parentActor);
    expect(remedyRes!.status).toBe(200);
    const remedied = env.DB.prepare("SELECT amount, effective_amount, freeze_status, remedied_at, settled_at FROM point_ledger WHERE id=?").bind(frozen.id).first() as any;
    expect(Number(remedied.amount)).toBe(-4);
    expect(Number(remedied.effective_amount)).toBe(-4);
    expect(remedied.freeze_status).toBe("remedied");
    expect(remedied.remedied_at).toBeTruthy();
    expect(remedied.settled_at).toBeTruthy();

    const afterRemedyDashReq = makeRequest("GET", "/dashboard/child");
    const afterRemedyDashRes = await safe(handleChildRoutes, norm(new URL(afterRemedyDashReq.url).pathname), "GET", afterRemedyDashReq, env, childActor, new URL(afterRemedyDashReq.url));
    const afterRemedyDash = await afterRemedyDashRes!.json();
    expect(afterRemedyDash.data.balance).toBe(-4);
    expect(afterRemedyDash.data.frozenPoints).toBe(0);
    expect(afterRemedyDash.data.remedyCriticisms).toHaveLength(0);
  });

  it("expired remediable criticism settles as a real deduction and leaves child remedy cards", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "TP" };
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const templateId = id();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, 'criticism', 'Late', '', 7, 'emoji', '!', 1, 1, '说明原因', 3, 1)")
      .bind(templateId, pid)
      .run();
    const feedbackReq = makeRequest("POST", `/children/${cid}/feedback-events`, { templateId });
    const feedbackRes = await safe(handleParentRoutes, norm(new URL(feedbackReq.url).pathname), "POST", feedbackReq, env, parentActor);
    expect(feedbackRes!.status).toBe(200);
    const frozen = env.DB.prepare("SELECT id FROM point_ledger WHERE child_id=? AND source_type='criticism'").bind(cid).first() as any;
    env.DB.prepare("UPDATE point_ledger SET remedy_deadline_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(frozen.id).run();

    const dashboardReq = makeRequest("GET", "/dashboard/child");
    const dashboardRes = await safe(handleChildRoutes, norm(new URL(dashboardReq.url).pathname), "GET", dashboardReq, env, childActor, new URL(dashboardReq.url));
    const dashboard = await dashboardRes!.json();
    expect(dashboard.data.remedyCriticisms).toHaveLength(0);
    const settled = env.DB.prepare("SELECT amount, effective_amount, freeze_status, settled_at FROM point_ledger WHERE id=?").bind(frozen.id).first() as any;
    expect(Number(settled.amount)).toBe(-7);
    expect(Number(settled.effective_amount)).toBe(-7);
    expect(settled.freeze_status).toBe("settled");
    expect(settled.settled_at).toBeTruthy();
  });

  it("balance returns available points excluding frozen amount", async () => {
    const parentActor = { type: "user", role: "parent", id: pid, displayName: "TP" };
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();

    const templateId = id();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, 'criticism', 'Clean desk', '', 80, 'emoji', '!', 1, 1, '整理书桌', 60, 24)")
      .bind(templateId, pid)
      .run();

    const feedbackReq = makeRequest("POST", `/children/${cid}/feedback-events`, { templateId });
    const feedbackRes = await safe(handleParentRoutes, norm(new URL(feedbackReq.url).pathname), "POST", feedbackReq, env, parentActor);
    expect(feedbackRes!.status).toBe(200);

    const childDashReq = makeRequest("GET", "/dashboard/child");
    const childDashRes = await safe(handleChildRoutes, norm(new URL(childDashReq.url).pathname), "GET", childDashReq, env, childActor, new URL(childDashReq.url));
    const childDash = await childDashRes!.json();
    expect(childDash.data.balance).toBe(20);
    expect(childDash.data.frozenPoints).toBe(80);

    const parentDashReq = makeRequest("GET", "/dashboard/parent");
    const parentDashRes = await safe(handleSharedRoutes, norm(new URL(parentDashReq.url).pathname), "GET", parentDashReq, env, parentActor, new URL(parentDashReq.url));
    const parentDash = await parentDashRes!.json();
    expect(parentDash.data.children[0].balance).toBe(20);
    expect(parentDash.data.children[0].frozenPoints).toBe(80);
  });
});

describe("Required Task Penalties", () => {
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
  });

  it("deducts points when required task approval count is below threshold", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'approved', ?, '2026-06-10')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(1);
    const penalty = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(penalty).not.toBeNull();
    expect(Number(penalty.penalty_points)).toBe(5);
    expect(Number(penalty.actual_count)).toBe(1);
    expect(Number(penalty.required_count)).toBe(3);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(95);
  });

  it("does not deduct points when required task approval count meets threshold", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 2, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    for (let i = 0; i < 2; i++) {
      const subId = id();
      env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'approved', ?, '2026-06-10')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    }
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(0);
    const penalty = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(penalty).toBeNull();
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(100);
  });

  it("does not count pending submissions toward required task completion", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 2, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'pending', ?, '2026-06-10')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(1);
    const penalty = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(penalty).not.toBeNull();
    expect(Number(penalty.penalty_points)).toBe(5);
    expect(Number(penalty.actual_count)).toBe(0);
  });

  it("caps penalty at available balance and does not produce negative balance", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 20)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 8, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(1);
    const penalty = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(Number(penalty.penalty_points)).toBe(8);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(0);
  });

  it("idempotent: running settlement twice does not double-deduct", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    const result2 = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result2.settled).toBe(0);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(95);
  });
});
