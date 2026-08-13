import { beforeEach, describe, expect, it } from "vitest";
import { handleApiRequest } from "../server/api/router.mjs";
import { acknowledgeChildDailyReview, childDailyReview, ensureAdmin, hashPassword, id } from "../server/api/utils.js";
import { resetTestEnv } from "./helpers/setup";

function request(method: string, path: string, body?: unknown, token?: string) {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { cookie: `session=${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

describe("Child daily review", () => {
  let env: any;
  let parentId: string;
  let childId: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    parentId = id();
    childId = id();
    const password = await hashPassword("pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, 'parent-review', ?, 'parent', 'Parent')").bind(parentId, password).run();
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, 'child-review', ?, 'Child', 'active')").bind(childId, parentId, password).run();
  });

  it("keeps the first display time, summarizes yesterday, and acknowledges all yesterday notifications", async () => {
    const first = await childDailyReview(env, childId, 480);
    expect(first).not.toBeNull();
    expect(first!.items).toHaveLength(0);
    const noonYesterday = new Date(`${first!.reviewDate}T12:00:00.000Z`).toISOString();
    const ledgerId = id();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, note, created_at) VALUES (?, ?, ?, 5, 'praise', 'template', '认真完成阅读', ?)").bind(ledgerId, childId, parentId, noonYesterday).run();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, created_at) VALUES (?, 'child', ?, 'user', ?, '任务已通过', '', 'task_approved', ?)").bind(id(), childId, parentId, noonYesterday).run();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, created_at) VALUES (?, 'child', ?, 'user', ?, '奖励已核销', '', 'reward_redeemed', ?)").bind(id(), childId, parentId, noonYesterday).run();
    env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, created_at) VALUES (?, 'child', ?, 'user', ?, '今天的消息', '', 'praise', ?)").bind(id(), childId, parentId, new Date().toISOString()).run();

    const again = await childDailyReview(env, childId, 480);
    expect(again!.presentedAt).toBe(first!.presentedAt);
    expect(again!.totals).toMatchObject({ gained: 5, net: 5, praiseCount: 1 });
    expect(again!.praiseItems).toHaveLength(1);
    expect(again!.notificationCount).toBe(2);

    const early = await acknowledgeChildDailyReview(env, childId, 480, first!.reviewDate, first!.presentedAt);
    expect(early.status).toBe("countdown");
    const signed = await acknowledgeChildDailyReview(env, childId, 480, first!.reviewDate, new Date(Date.parse(first!.presentedAt) + 30001).toISOString());
    expect(signed.status).toBe("acknowledged");
    expect((await acknowledgeChildDailyReview(env, childId, 480, first!.reviewDate)).status).toBe("acknowledged");
    expect(Number(env.DB.prepare("SELECT COUNT(*) count FROM notifications WHERE recipient_id=? AND read_at IS NULL").bind(childId).first().count)).toBe(1);
    expect((await childDailyReview(env, childId, 480))).toBeNull();
  });

  it("blocks child writes until the review has been signed", async () => {
    const taskId = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('daily-review-category', ?, 'Category', 'emoji', '⭐')").bind(parentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'daily-review-category', 'Task', 1, 'daily', 1, 'earn', '[0,1,2,3,4,5,6]')").bind(taskId, parentId).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(taskId, childId).run();
    const token = id();
    env.DB.prepare("INSERT INTO sessions (token, actor_type, actor_id, expires_at) VALUES (?, 'child', ?, ?)").bind(token, childId, new Date(Date.now() + 86400000).toISOString()).run();

    const blocked = await handleApiRequest(request("POST", "/task-submissions", { taskId }, token), env, { waitUntil: () => {} });
    expect(blocked.status).toBe(423);

    const review = await childDailyReview(env, childId, 480);
    const signed = await acknowledgeChildDailyReview(env, childId, 480, review!.reviewDate, new Date(Date.parse(review!.presentedAt) + 30001).toISOString());
    expect(signed.status).toBe("acknowledged");
    const allowed = await handleApiRequest(request("POST", "/task-submissions", { taskId }, token), env, { waitUntil: () => {} });
    expect(allowed.status).toBe(200);
  });
});
