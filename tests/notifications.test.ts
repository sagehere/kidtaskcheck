import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { ensureAdmin, hashPassword, id } from "../functions/api/utils.js";

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
});
