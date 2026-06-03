import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../functions/api/utils.js";
import { handleParentRoutes } from "../functions/api/routes/parent.js";
import { handleChildRoutes } from "../functions/api/routes/child.js";

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
});
