import { beforeEach, describe, expect, it } from "vitest";
import { handleApiRequest } from "../server/api/router.mjs";
import { acknowledgeChildDailyReview, childDailyReview, ensureAdmin, hashPassword, id, settleRequiredTaskPenalties } from "../server/api/utils.js";
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

  it("attributes overnight required-task penalties and notifications to the completed business day", async () => {
    const taskId = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('review-penalty-category', ?, 'Category', 'emoji', '⭐')").bind(parentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays, is_required, required_count, required_penalty_points, created_at, updated_at) VALUES (?, ?, 'review-penalty-category', 'Required task', 1, 'daily', 1, 'earn', '[0,1,2,3,4,5,6]', 1, 1, 5, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')").bind(taskId, parentId).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(taskId, childId).run();
    env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, created_at) VALUES (?, ?, ?, 10, 'manual', 'seed', '2000-01-01T00:00:00.000Z')").bind(id(), childId, parentId).run();

    const at = "2026-08-15T16:17:00.000Z";
    expect((await settleRequiredTaskPenalties(env, at, childId)).settled).toBe(1);
    expect((await settleRequiredTaskPenalties(env, at, childId)).settled).toBe(0);
    const penalty = env.DB.prepare("SELECT created_at FROM point_ledger WHERE child_id=? AND source_type='task_required_penalty'").bind(childId).first() as any;
    const notification = env.DB.prepare("SELECT created_at FROM notifications WHERE recipient_id=? AND event_type='task_required_penalty'").bind(childId).first() as any;
    expect(penalty.created_at).toBe("2026-08-15T15:59:59.999Z");
    expect(notification.created_at).toBe(penalty.created_at);

    const review = await childDailyReview(env, childId, 480, at);
    expect(review!.reviewDate).toBe("2026-08-15");
    expect(review!.items.some((item: any) => item.source_type === "task_required_penalty")).toBe(true);
    expect(review!.notificationCount).toBe(1);
  });

  it("uses each child's current review setting for gating and countdown", async () => {
    const token = id();
    env.DB.prepare("INSERT INTO sessions (token, actor_type, actor_id, expires_at) VALUES (?, 'child', ?, ?)").bind(token, childId, new Date(Date.now() + 86400000).toISOString()).run();
    const initial = await childDailyReview(env, childId, 480);
    env.DB.prepare("UPDATE children SET daily_review_enabled=0, daily_review_seconds=30 WHERE id=?").bind(childId).run();
    expect(await childDailyReview(env, childId, 480)).toBeNull();
    const taskId = id();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('review-setting-category', ?, 'Category', 'emoji', '⭐')").bind(parentId).run();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'review-setting-category', 'Task', 1, 'daily', 1, 'earn', '[0,1,2,3,4,5,6]')").bind(taskId, parentId).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(taskId, childId).run();
    const allowed = await handleApiRequest(request("POST", "/task-submissions", { taskId }, token), env, { waitUntil: () => {} });
    expect(allowed.status).toBe(200);

    env.DB.prepare("UPDATE children SET daily_review_enabled=1, daily_review_seconds=60 WHERE id=?").bind(childId).run();
    const review = await childDailyReview(env, childId, 480);
    expect(review!.presentedAt).toBe(initial!.presentedAt);
    expect(Date.parse(review!.acknowledgeAvailableAt) - Date.parse(review!.presentedAt)).toBe(60000);
    expect((await acknowledgeChildDailyReview(env, childId, 480, review!.reviewDate, new Date(Date.parse(review!.presentedAt) + 30000).toISOString())).status).toBe("countdown");
    expect((await acknowledgeChildDailyReview(env, childId, 480, review!.reviewDate, new Date(Date.parse(review!.presentedAt) + 60000).toISOString())).status).toBe("acknowledged");
  });

  it("lets parents update valid settings and rejects invalid reading times", async () => {
    const token = id();
    env.DB.prepare("INSERT INTO sessions (token, actor_type, actor_id, expires_at) VALUES (?, 'user', ?, ?)").bind(token, parentId, new Date(Date.now() + 86400000).toISOString()).run();
    const updated = await handleApiRequest(request("PATCH", `/children/${childId}`, { dailyReviewEnabled: false, dailyReviewSeconds: 0 }, token), env, { waitUntil: () => {} });
    expect(updated.status).toBe(200);
    expect(env.DB.prepare("SELECT daily_review_enabled, daily_review_seconds FROM children WHERE id=?").bind(childId).first()).toMatchObject({ daily_review_enabled: 0, daily_review_seconds: 0 });
    const invalid = await handleApiRequest(request("PATCH", `/children/${childId}`, { dailyReviewSeconds: 301 }, token), env, { waitUntil: () => {} });
    expect(invalid.status).toBe(400);
  });
});
