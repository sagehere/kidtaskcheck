import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id, localTimeText, notify } from "../server/api/utils.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { handleChildRoutes } from "../server/api/routes/child.js";
import { handleSharedRoutes } from "../server/api/routes/shared.js";
import { groupLedgerRows, ledgerMatchesFilter, ledgerSummary } from "../src/lib/ledgerView";

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


  it("completion grading task approval uses the selected standard", async () => {
    const actor = { type: "user", role: "parent", id: pid };
    env.DB.prepare("UPDATE tasks SET grading_mode='completion', completion_standards_json=? WHERE id=?").bind(JSON.stringify([{ label: "合格", points: 6 }, { label: "优秀", points: 10 }]), tid).run();
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'pending', ?, '2026-06-03')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const req = makeRequest("PATCH", `/task-submissions/${subId}/review`, { approved: true, note: "", completionLabel: "合格" });
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "PATCH", req, env, actor);
    expect(res!.status).toBe(200);
    const ledger = env.DB.prepare("SELECT amount, note FROM point_ledger WHERE source_type='task' AND source_id=?").bind(subId).first() as any;
    expect(ledger).toMatchObject({ amount: 6, note: "任务审核通过：合格" });
  });

  it("completion grading task approval requires a selected standard", async () => {
    const actor = { type: "user", role: "parent", id: pid };
    env.DB.prepare("UPDATE tasks SET grading_mode='completion', completion_standards_json=? WHERE id=?").bind(JSON.stringify([{ label: "合格", points: 6 }]), tid).run();
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'pending', ?, '2026-06-03')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const req = makeRequest("PATCH", `/task-submissions/${subId}/review`, { approved: true, note: "" });
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "PATCH", req, env, actor);
    expect(res!.status).toBe(400);
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
    const original = env.DB.prepare("SELECT id, amount, created_at FROM point_ledger WHERE child_id=? AND source_type='praise'").bind(cid).first() as any;
    expect(original).not.toBeNull();
    expect(Number(original.amount)).toBe(8);
    expect(original.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const createdLedgerReq = makeRequest("GET", `/points/ledger?childId=${cid}`);
    const createdLedgerRes = await safe(handleSharedRoutes, norm(new URL(createdLedgerReq.url).pathname), "GET", createdLedgerReq, env, parentActor, new URL(createdLedgerReq.url));
    expect(createdLedgerRes!.status).toBe(200);
    const createdLedger = await createdLedgerRes!.json();
    const createdFeedbackRow = createdLedger.data.items.find((row: any) => row.id === original.id);
    expect(createdFeedbackRow.localCreatedAt).toBe(localTimeText(original.created_at, createdLedger.data.timezoneOffsetMinutes));

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

    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const notificationsReq = makeRequest("GET", "/notifications");
    const notificationsRes = await safe(handleSharedRoutes, norm(new URL(notificationsReq.url).pathname), "GET", notificationsReq, env, childActor, new URL(notificationsReq.url));
    expect(notificationsRes!.status).toBe(200);
    const notifications = await notificationsRes!.json();
    const penaltyNotification = notifications.data.items.find((item: any) => item.event_type === "task_required_penalty");
    expect(penaltyNotification).toBeTruthy();
    expect(penaltyNotification.sourceTypeLabel).toBe("必做扣分");
    expect(penaltyNotification.sourceLabel).toBe("任务：TT");

    const parentActor = { type: "user", role: "parent", id: pid };
    const ledgerReq = makeRequest("GET", `/points/ledger?childId=${cid}`);
    const ledgerRes = await safe(handleSharedRoutes, norm(new URL(ledgerReq.url).pathname), "GET", ledgerReq, env, parentActor, new URL(ledgerReq.url));
    expect(ledgerRes!.status).toBe(200);
    const ledger = await ledgerRes!.json();
    const penaltyRow = ledger.data.items.find((row: any) => row.source_type === "task_required_penalty");
    expect(penaltyRow).toBeTruthy();
    expect(penaltyRow.sourceTypeLabel).toBe("必做扣分");
    expect(penaltyRow.sourceLabel).toBe("任务：TT");
  });

  it("does not deduct previous period for newly created required tasks", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points, created_at, updated_at) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 1, 5, '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(0);
    expect(env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first()).toBeNull();
  });

  it("does not deduct previous period after a required task is edited", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points, created_at, updated_at) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 1, 5, '2026-06-01T00:00:00.000Z', '2026-06-11T00:00:00.000Z')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const result = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(result.settled).toBe(0);
    expect(env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first()).toBeNull();
  });

  it("exempts current required task period once", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 1, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    const parentActor = { type: "user", role: "parent", id: pid };
    const req = makeRequest("POST", `/tasks/${tid}/required-penalty-exemptions`, { childId: cid });
    const res = await safe(handleParentRoutes, norm(new URL(req.url).pathname), "POST", req, env, parentActor);
    expect(res!.status).toBe(200);
    const exemption = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).first() as any;
    expect(exemption).toBeTruthy();
    expect(Number(exemption.penalty_points)).toBe(0);
    const tid2 = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT2', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 1, 5)").bind(tid2, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid2, cid).run();
    env.DB.prepare("INSERT INTO task_required_penalties (id, task_id, child_id, parent_id, period_key, required_count, actual_count, penalty_points) VALUES (?, ?, ?, ?, ?, 1, 0, 5)").bind(id(), tid2, cid, pid, exemption.period_key).run();

    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const childDashReq = makeRequest("GET", "/dashboard/child");
    const childDashRes = await safe(handleChildRoutes, norm(new URL(childDashReq.url).pathname), "GET", childDashReq, env, childActor, new URL(childDashReq.url));
    const childDash = await childDashRes!.json();
    expect(childDash.data.tasks.find((task: any) => task.id === tid).requiredPenaltyExempted).toBe(true);
    expect(childDash.data.tasks.find((task: any) => task.id === tid2).requiredPenaltyExempted).toBe(false);

    const parentDashReq = makeRequest("GET", "/dashboard/parent");
    const parentDashRes = await safe(handleSharedRoutes, norm(new URL(parentDashReq.url).pathname), "GET", parentDashReq, env, parentActor, new URL(parentDashReq.url));
    const parentDash = await parentDashRes!.json();
    expect(parentDash.data.requiredPenaltyExemptions).toContainEqual({ childId: cid, taskId: tid, periodKey: exemption.period_key });
    expect(parentDash.data.requiredPenaltyExemptions.some((item: any) => item.taskId === tid2)).toBe(false);

    const dupReq = makeRequest("POST", `/tasks/${tid}/required-penalty-exemptions`, { childId: cid });
    const dup = await safe(handleParentRoutes, norm(new URL(dupReq.url).pathname), "POST", dupReq, env, parentActor);
    expect(dup!.status).toBe(409);
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

  it("deducts for each unmet period across consecutive days", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const r1 = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(r1.settled).toBe(1);
    const r2 = await settleRequiredTaskPenalties(env, "2026-06-12T00:00:00.000Z");
    expect(r2.settled).toBe(1);
    const penalties = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=? ORDER BY period_key").bind(tid, cid).all().results;
    expect(penalties).toHaveLength(2);
    expect(penalties[0].period_key).toBe("2026-06-10");
    expect(penalties[1].period_key).toBe("2026-06-11");
    expect(penalties[0].period_key).not.toBe(penalties[1].period_key);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(90);
  });

  it("same period idempotent after settling a different period", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 3, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    const dup = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(dup.settled).toBe(0);
    await settleRequiredTaskPenalties(env, "2026-06-12T00:00:00.000Z");
    const penalties = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).all().results;
    expect(penalties).toHaveLength(2);
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(90);
  });

  it("met period skipped, subsequent unmet period still deducts", async () => {
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, title, points, period, limit_count, point_type, enabled_weekdays, category_id, is_required, required_count, required_penalty_points) VALUES (?, ?, 'TT', 10, 'daily', 10, 'earn', '[1,2,3,4,5,6,0]', 'cat-1', 1, 1, 5)").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 100, 'manual', 'seed', '2026-06-03')").bind(id(), cid, pid).run();
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'approved', ?, '2026-06-10')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    const { settleRequiredTaskPenalties } = await import("../server/api/utils.js");
    const r1 = await settleRequiredTaskPenalties(env, "2026-06-11T00:00:00.000Z");
    expect(r1.settled).toBe(0);
    const r2 = await settleRequiredTaskPenalties(env, "2026-06-12T00:00:00.000Z");
    expect(r2.settled).toBe(1);
    const penalties = env.DB.prepare("SELECT * FROM task_required_penalties WHERE task_id=? AND child_id=?").bind(tid, cid).all().results;
    expect(penalties).toHaveLength(1);
    expect(penalties[0].period_key).toBe("2026-06-11");
    const balance = env.DB.prepare("SELECT COALESCE(SUM(amount),0) as b FROM point_ledger WHERE child_id=?").bind(cid).first() as any;
    expect(Number(balance.b)).toBe(95);
  });

  it("notifications and ledger are sorted by created_at DESC without special priority for required task penalties", async () => {
    const childActor = { type: "child", role: "child", id: cid, parent_id: pid, displayName: "TC" };
    const parentActor = { type: "user", role: "parent", id: pid };
    await notify(env, {
      recipientType: "child", recipientId: cid, actorType: "system", actorId: null,
      title: "Old notification", body: "", eventType: "praise",
      relatedType: "point_ledger", relatedId: "dummy-old", createdAt: "2026-01-01T00:00:00.000Z"
    });
    const ledgerId = id();
    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'manual', 'x', '2026-01-03', 'old ledger entry', '2026-01-03T00:00:00.000Z')")
      .bind(ledgerId, cid, pid, 10).run();
    const penaltyLedgerId = id();
    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'task_required_penalty', 'task-x', '2026-01-02', 'penalty', '2026-01-02T00:00:00.000Z')")
      .bind(penaltyLedgerId, cid, pid, -5).run();
    await notify(env, {
      recipientType: "child", recipientId: cid, actorType: "system", actorId: null,
      title: "Penalty", body: "", eventType: "task_required_penalty",
      relatedType: "point_ledger", relatedId: penaltyLedgerId, createdAt: "2026-01-02T00:00:00.000Z"
    });

    const nReq = makeRequest("GET", "/notifications");
    const nRes = await safe(handleSharedRoutes, norm(new URL(nReq.url).pathname), "GET", nReq, env, childActor, new URL(nReq.url));
    const notifications = await nRes!.json();
    const createdAts = notifications.data.items.map((item: any) => item.created_at);
    expect(createdAts).toEqual([...createdAts].sort().reverse());

    const lReq = makeRequest("GET", `/points/ledger?childId=${cid}`);
    const lRes = await safe(handleSharedRoutes, norm(new URL(lReq.url).pathname), "GET", lReq, env, parentActor, new URL(lReq.url));
    const ledger = await lRes!.json();
    const ledgerCreatedAts = ledger.data.items.map((item: any) => item.created_at);
    expect(ledgerCreatedAts).toEqual([...ledgerCreatedAts].sort().reverse());
  });

  it("orders mixed ISO and legacy SQLite ledger timestamps by actual time", async () => {
    const parentActor = { type: "user", role: "parent", id: pid };
    const templateId = id();
    env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active) VALUES (?, ?, 'criticism', 'Late cleanup', '', 3, 'emoji', '!', 1)")
      .bind(templateId, pid)
      .run();
    const penaltyLedgerId = id();
    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'task_required_penalty', ?, '2026-06-12', 'penalty', '2026-06-13T15:32:35.000Z')")
      .bind(penaltyLedgerId, cid, pid, -1, tid).run();
    const criticismLedgerId = id();
    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'criticism', ?, NULL, 'criticism', '2026-06-13 17:05:50')")
      .bind(criticismLedgerId, cid, pid, -3, templateId).run();

    const ledgerReq = makeRequest("GET", `/points/ledger?childId=${cid}`);
    const ledgerRes = await safe(handleSharedRoutes, norm(new URL(ledgerReq.url).pathname), "GET", ledgerReq, env, parentActor, new URL(ledgerReq.url));
    expect(ledgerRes!.status).toBe(200);
    const ledger = await ledgerRes!.json();
    expect(ledger.data.items.slice(0, 2).map((item: any) => item.id)).toEqual([criticismLedgerId, penaltyLedgerId]);
    expect(ledger.data.items[0].localCreatedAt).toBe("2026-06-14 01:05:50");
  });
});

describe("Ledger view helpers", () => {
  it("summarizes, filters, and groups loaded ledger rows by local date", () => {
    const rows = [
      { id: "income", amount: 8, source_type: "task", note: "", created_at: "2026-06-13T02:00:00.000Z", localCreatedAt: "2026-06-13 10:00:00" },
      { id: "penalty", amount: -3, source_type: "task_required_penalty", note: "", created_at: "2026-06-13T01:00:00.000Z", localCreatedAt: "2026-06-13 09:00:00" },
      { id: "frozen", amount: 0, source_type: "criticism", note: "", created_at: "2026-06-12T11:00:00.000Z", localCreatedAt: "2026-06-12 19:00:00", freeze_status: "frozen", frozen_amount: 5 }
    ] as any[];

    expect(ledgerSummary(rows)).toEqual({ income: 8, expense: 3, net: 5, frozen: 5 });
    expect(ledgerMatchesFilter(rows[1], "required")).toBe(true);
    expect(ledgerMatchesFilter(rows[2], "frozen")).toBe(true);
    const groups = groupLedgerRows(rows, "all", new Date("2026-06-13T12:00:00.000Z"));
    expect(groups.map((group) => group.label)).toEqual(["今天", "昨天"]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["income", "penalty"]);
  });
});
