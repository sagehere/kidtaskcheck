import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleParentRoutes } from "../server/api/routes/parent.js";
import { handleChildRoutes } from "../server/api/routes/child.js";

function makeRequest(m: string, p: string, b?: any): Request {
  return new Request(`http://localhost/api${p}`, { method: m, headers: { "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) });
}
function norm(p: string) { return `/${(p.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`; }
async function safe(h: Function, ...a: any[]) { try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; } }

describe("Idempotency & Limit Enforcement", () => {
  let env: any, pid: string, cid: string, tid: string, rid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pid = id(); const pw = await hashPassword("pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(pid, "p", pw).run();
    cid = id(); const cpw = await hashPassword("cpw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'C', 'active')").bind(cid, pid, "c", cpw).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat', ?, 'Cat', 'emoji', 'ðŸ“š')").bind(pid).run();
    tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'cat', 'T', 10, 'daily', 1, 'earn', '[1,2,3,4,5,6,0]')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    rid = id();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, limit_count, redeem_weekdays) VALUES (?, ?, 'R', 30, 'daily', 1, '[1,2,3,4,5,6,0]')").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key) VALUES (?, ?, ?, 50, 'manual', 'seed', 'now')").bind(id(), cid, pid).run();
  });

  const ca = () => ({ type: "child", role: "child", id: cid, parent_id: pid, displayName: "C" });
  const pa = () => ({ type: "user", role: "parent", id: pid });

  it("duplicate review returns 404 (status already changed)", async () => {
    const subId = id();
    env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, status, submitted_at, period_key) VALUES (?, ?, ?, ?, 'pending', ?, 'now')").bind(subId, tid, cid, pid, new Date().toISOString()).run();
    // First approval succeeds
    const r1 = makeRequest("PATCH", `/task-submissions/${subId}/review`, { approved: true, note: "" });
    const res1 = await safe(handleParentRoutes, norm(new URL(r1.url).pathname), "PATCH", r1, env, pa());
    expect(res1!.status).toBe(200);
    // Second approval fails because status is no longer 'pending' â†?404
    const r2 = makeRequest("PATCH", `/task-submissions/${subId}/review`, { approved: true, note: "" });
    const res2 = await safe(handleParentRoutes, norm(new URL(r2.url).pathname), "PATCH", r2, env, pa());
    expect(res2!.status).toBe(404);
    // Only one ledger entry
    const count = env.DB.prepare("SELECT COUNT(*) as c FROM point_ledger WHERE source_type='task' AND source_id=?").bind(subId).first() as any;
    expect(Number(count.c)).toBe(1);
  });

  it("duplicate cancel returns 404 (status already changed)", async () => {
    const rr = makeRequest("POST", "/reward-redemptions", { rewardId: rid });
    const rrRes = await safe(handleChildRoutes, norm(new URL(rr.url).pathname), "POST", rr, env, ca());
    expect(rrRes!.status).toBe(200);
    const red = env.DB.prepare("SELECT id FROM reward_redemptions WHERE child_id=? AND status='pending'").bind(cid).first() as any;
    expect(red).not.toBeNull();
    const c1 = makeRequest("PATCH", `/reward-redemptions/${red.id}/cancel`, {});
    const res1 = await safe(handleParentRoutes, norm(new URL(c1.url).pathname), "PATCH", c1, env, pa());
    expect(res1!.status).toBe(200);
    // Second cancel fails because status changed
    const c2 = makeRequest("PATCH", `/reward-redemptions/${red.id}/cancel`, {});
    const res2 = await safe(handleParentRoutes, norm(new URL(c2.url).pathname), "PATCH", c2, env, pa());
    expect(res2!.status).toBe(404);
    // Only one cancel ledger entry
    const count = env.DB.prepare("SELECT COUNT(*) as c FROM point_ledger WHERE source_type='reward_cancel' AND source_id=?").bind(red.id).first() as any;
    expect(Number(count.c)).toBe(1);
  });

  it("redemption rejected with insufficient balance", async () => {
    // Set child balance to exactly 0
    env.DB.prepare("DELETE FROM point_ledger WHERE child_id=?").bind(cid).run();
    const req = makeRequest("POST", "/reward-redemptions", { rewardId: rid });
    const res = await safe(handleChildRoutes, norm(new URL(req.url).pathname), "POST", req, env, ca());
    expect(res!.status).toBe(409);
    const data = await res!.json();
    expect(data.error.code).toBe("LOW_BALANCE");
  });

  it("redemption respects stock=1 limit", async () => {
    env.DB.prepare("UPDATE rewards SET stock=1 WHERE id=?").bind(rid).run();
    // First redemption succeeds
    const r1 = makeRequest("POST", "/reward-redemptions", { rewardId: rid });
    expect((await safe(handleChildRoutes, norm(new URL(r1.url).pathname), "POST", r1, env, ca()))!.status).toBe(200);
    // Second redemption rejected by stock
    const r2 = makeRequest("POST", "/reward-redemptions", { rewardId: rid });
    const res2 = await safe(handleChildRoutes, norm(new URL(r2.url).pathname), "POST", r2, env, ca());
    expect(res2!.status).toBe(409);
  });

  it("task daily limit=1 enforced", async () => {
    // First submission succeeds
    const s1 = makeRequest("POST", "/task-submissions", { taskId: tid });
    expect((await safe(handleChildRoutes, norm(new URL(s1.url).pathname), "POST", s1, env, ca()))!.status).toBe(200);
    // Second submission rejected by limit
    const s2 = makeRequest("POST", "/task-submissions", { taskId: tid });
    const res2 = await safe(handleChildRoutes, norm(new URL(s2.url).pathname), "POST", s2, env, ca());
    expect(res2!.status).toBe(409);
    const data = await res2!.json();
    expect(data.error.code).toBe("LIMIT_REACHED");
  });
});
