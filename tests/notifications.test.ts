import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { handleSharedRoutes } from "../server/api/routes/shared.js";

function makeRequest(m: string, p: string, b?: any): Request {
  return new Request(`http://localhost/api${p}`, { method: m, headers: { "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) });
}

async function safe(h: Function, ...a: any[]) {
  try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; }
}

describe("Task 37: Notification Acknowledge", () => {
  let env: any, pid: string, cid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    pid = id(); const pw = await hashPassword("ppw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(pid, "p", pw).run();
    cid = id(); const cpw = await hashPassword("cpw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'C', 'active')").bind(cid, pid, "c", cpw).run();
  });

  it("notification created with requires_ack", () => {
    const nid = id();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, requires_ack) VALUES (?, 'child', ?, 'user', ?, '表扬', 'Good!', 'praise', 1)").bind(nid, cid, pid).run();
    const n = env.DB.prepare("SELECT * FROM notifications WHERE id=?").bind(nid).first() as any;
    expect(n.requires_ack).toBe(1);
    expect(n.read_at).toBeNull();
  });

  it("read_at set when acknowledged", () => {
    const nid = id();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, requires_ack) VALUES (?, 'child', ?, 'user', ?, '批评', 'Oops', 'criticism', 1)").bind(nid, cid, pid).run();
    const now = new Date().toISOString();
    env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=?").bind(now, nid).run();
    const n = env.DB.prepare("SELECT * FROM notifications WHERE id=?").bind(nid).first() as any;
    expect(n.read_at).not.toBeNull();
  });

  it("lists actionable unread notifications before ordinary unread messages", async () => {
    const actor = { type: "user", role: "parent", id: pid, displayName: "P" };
    const taskId = id();
    const rewardId = id();
    const ordinaryId = id();
    const oldActionId = id();
    env.DB.prepare(`INSERT INTO notifications
(id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, related_type, related_id, created_at)
VALUES
(?, 'user', ?, 'child', ?, 'Task old', '', 'task_submitted', 'task_submission', ?, '2026-06-13T08:00:00.000Z'),
(?, 'user', ?, 'child', ?, 'Reward new', '', 'reward_requested', 'reward_redemption', ?, '2026-06-13T09:00:00.000Z'),
(?, 'user', ?, 'child', ?, 'Praise newest', '', 'praise', 'point_ledger', 'ledger-1', '2026-06-13T10:00:00.000Z')`)
      .bind(oldActionId, pid, cid, taskId, rewardId, pid, cid, rewardId, ordinaryId, pid, cid)
      .run();
    const readId = id();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, read_at, created_at) VALUES (?, 'user', ?, 'child', ?, 'Read', '', 'praise', '2026-06-13T11:00:00.000Z', '2026-06-13T11:00:00.000Z')")
      .bind(readId, pid, cid)
      .run();

    const req = makeRequest("GET", "/notifications");
    const res = await safe(handleSharedRoutes, "/notifications", "GET", req, env, actor, new URL(req.url));
    expect(res!.status).toBe(200);
    const payload = await res!.json();
    expect(payload.data.unread).toBe(3);
    expect(payload.data.items.map((item: any) => item.id)).toEqual([rewardId, oldActionId, ordinaryId]);
  });
});
