import { consecutiveDayStreak, periodKey, signedPoints } from "../../src/lib/domain.js";
const json = (data, init) => new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) }
});
const ok = (data) => json({ data });
const fail = (code, message, status = 400) => json({ error: { code, message } }, { status });
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
    return `pbkdf2$120000$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function verifyPassword(password, stored) {
    const [, iterations, salt64, hash64] = stored.split("$");
    if (!iterations || !salt64 || !hash64)
        return false;
    const salt = Uint8Array.from(atob(salt64), (c) => c.charCodeAt(0));
    const expected = Uint8Array.from(atob(hash64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterations), hash: "SHA-256" }, key, 256);
    const actual = new Uint8Array(bits);
    return expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
}
async function body(request) {
    try {
        return (await request.json());
    }
    catch {
        return {};
    }
}
function cookie(request, name) {
    const header = request.headers.get("cookie") || "";
    return header
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([key]) => key === name)?.[1];
}
async function ensureAdmin(env) {
    const username = env.ADMIN_USERNAME || "admin";
    const password = env.ADMIN_PASSWORD || "change-me-admin-password";
    const found = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
    if (found)
        return;
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'admin', ?)")
        .bind(id(), username, await hashPassword(password), "系统管理员")
        .run();
    const defaults = [
        ["学习", "emoji", "📚"],
        ["劳动", "emoji", "🧹"],
        ["品德", "emoji", "🌱"],
        ["健康", "emoji", "🏃"]
    ];
    for (const [name, iconType, iconValue] of defaults) {
        await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system) VALUES (?, NULL, ?, ?, ?, 1)")
            .bind(id(), name, iconType, iconValue)
            .run();
    }
}
async function actorFromRequest(request, env) {
    const token = cookie(request, "session");
    if (!token)
        return null;
    const session = await env.DB.prepare("SELECT * FROM sessions WHERE token=? AND expires_at > ?").bind(token, nowIso()).first();
    if (!session)
        return null;
    if (session.actor_type === "child") {
        const child = await env.DB.prepare("SELECT id, parent_id, username, display_name FROM children WHERE id=? AND status='active' AND deleted_at IS NULL")
            .bind(session.actor_id)
            .first();
        return child
            ? { type: "child", id: child.id, role: "child", parentId: child.parent_id, username: child.username, displayName: child.display_name }
            : null;
    }
    const user = await env.DB.prepare("SELECT id, role, username, display_name FROM users WHERE id=? AND status='active' AND deleted_at IS NULL")
        .bind(session.actor_id)
        .first();
    return user ? { type: "user", id: user.id, role: user.role, username: user.username, displayName: user.display_name } : null;
}
function requireRole(actor, roles) {
    if (!actor)
        throw fail("UNAUTHENTICATED", "请先登录", 401);
    if (!roles.includes(actor.role))
        throw fail("FORBIDDEN", "没有权限执行此操作", 403);
    return actor;
}
async function childIdsForParent(env, parentId) {
    const rows = await env.DB.prepare("SELECT id FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(parentId).all();
    return rows.results.map((row) => row.id);
}
async function replaceAssignees(env, table, key, keyValue, childIds) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${key}=?`).bind(keyValue).run();
    for (const childId of childIds) {
        await env.DB.prepare(`INSERT INTO ${table} (${key}, child_id) VALUES (?, ?)`).bind(keyValue, childId).run();
    }
}
async function balance(env, childId) {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) balance FROM point_ledger WHERE child_id=?").bind(childId).first();
    return Number(row?.balance || 0);
}
async function recalcAchievements(env, parentId, childId) {
    const achievements = await env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND is_active=1 AND deleted_at IS NULL").bind(parentId).all();
    const earned = Number((await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) v FROM point_ledger WHERE child_id=? AND amount > 0").bind(childId).first())?.v || 0);
    const current = await balance(env, childId);
    const completed = Number((await env.DB.prepare("SELECT COUNT(*) v FROM task_submissions WHERE child_id=? AND status='approved'").bind(childId).first())?.v || 0);
    const redemptions = Number((await env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE child_id=? AND status IN ('pending','redeemed')").bind(childId).first())?.v || 0);
    const days = (await env.DB.prepare("SELECT DISTINCT substr(submitted_at, 1, 10) day FROM task_submissions WHERE child_id=? AND status='approved'").bind(childId).all()).results.map((r) => r.day);
    const metrics = {
        total_earned: earned,
        balance: current,
        tasks_completed: completed,
        redemptions,
        streak_days: consecutiveDayStreak(days)
    };
    for (const achievement of achievements.results) {
        if ((metrics[achievement.metric] || 0) >= Number(achievement.threshold)) {
            await env.DB.prepare("INSERT OR IGNORE INTO child_achievements (child_id, achievement_id, unlocked_at) VALUES (?, ?, ?)")
                .bind(childId, achievement.id, nowIso())
                .run();
        }
    }
}
async function listWithAssignees(env, kind, parentId) {
    const rows = await env.DB.prepare(`SELECT * FROM ${kind} WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC`).bind(parentId).all();
    const table = kind === "tasks" ? "task_assignees" : "reward_assignees";
    const key = kind === "tasks" ? "task_id" : "reward_id";
    return Promise.all(rows.results.map(async (row) => ({
        ...row,
        assignees: (await env.DB.prepare(`SELECT child_id FROM ${table} WHERE ${key}=?`).bind(row.id).all()).results.map((x) => x.child_id)
    })));
}
async function route(request, env) {
    await ensureAdmin(env);
    const url = new URL(request.url);
    const path = `/${(url.pathname.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`;
    const method = request.method;
    const actor = await actorFromRequest(request, env);
    if (path === "/auth/me" && method === "GET")
        return ok(actor);
    if (path === "/auth/logout" && method === "POST") {
        const token = cookie(request, "session");
        if (token)
            await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
        return json({ data: true }, { headers: { "set-cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" } });
    }
    if (path === "/auth/login" && method === "POST") {
        const input = await body(request);
        const user = await env.DB.prepare("SELECT * FROM users WHERE username=? AND status='active' AND deleted_at IS NULL").bind(input.username).first();
        const child = user ? null : await env.DB.prepare("SELECT * FROM children WHERE username=? AND status='active' AND deleted_at IS NULL").bind(input.username).first();
        const account = user || child;
        if (!account || !(await verifyPassword(input.password || "", account.password_hash)))
            return fail("BAD_CREDENTIALS", "账号或密码错误", 401);
        const token = id();
        const expires = new Date(Date.now() + 7 * 86400000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token, actor_type, actor_id, expires_at) VALUES (?, ?, ?, ?)")
            .bind(token, user ? "user" : "child", account.id, expires)
            .run();
        return json({ data: { role: user ? user.role : "child", displayName: account.display_name } }, { headers: { "set-cookie": `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}` } });
    }
    if (path === "/admin/users" && method === "GET") {
        requireRole(actor, ["admin"]);
        return ok((await env.DB.prepare("SELECT id, username, display_name, status, created_at FROM users WHERE role='parent' AND deleted_at IS NULL ORDER BY created_at DESC").all()).results);
    }
    if (path === "/admin/users" && method === "POST") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        await env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', ?)")
            .bind(id(), input.username, await hashPassword(input.password || "123456"), input.displayName || input.username)
            .run();
        return ok(true);
    }
    const userDelete = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userDelete && method === "DELETE") {
        requireRole(actor, ["admin"]);
        const parentId = userDelete[1];
        await env.DB.prepare("UPDATE users SET deleted_at=?, status='disabled' WHERE id=? AND role='parent'").bind(nowIso(), parentId).run();
        await env.DB.prepare("UPDATE children SET deleted_at=?, status='disabled' WHERE parent_id=?").bind(nowIso(), parentId).run();
        for (const table of ["tasks", "rewards", "achievements"]) {
            await env.DB.prepare(`UPDATE ${table} SET deleted_at=?, is_active=0 WHERE parent_id=?`).bind(nowIso(), parentId).run();
        }
        await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE owner_id=?").bind(parentId).run();
        return ok(true);
    }
    const userPatch = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userPatch && method === "PATCH") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        if (input.password) {
            await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=? AND role='parent'").bind(await hashPassword(input.password), nowIso(), userPatch[1]).run();
        }
        if (input.status) {
            await env.DB.prepare("UPDATE users SET status=?, updated_at=? WHERE id=? AND role='parent'").bind(input.status, nowIso(), userPatch[1]).run();
        }
        return ok(true);
    }
    if (path === "/admin/gallery-images") {
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM gallery_images WHERE is_active=1 ORDER BY created_at DESC").all()).results);
        requireRole(actor, ["admin"]);
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO gallery_images (id, name, url, usage, is_active) VALUES (?, ?, ?, ?, 1)")
                .bind(id(), input.name, input.url, input.usage || "general")
                .run();
            return ok(true);
        }
    }
    if (path === "/children") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT id, username, display_name, status FROM children WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)")
                .bind(id(), a.id, input.username, await hashPassword(input.password || "123456"), input.displayName || input.username)
                .run();
            return ok(true);
        }
    }
    if (path === "/task-categories") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET") {
            return ok((await env.DB.prepare("SELECT * FROM task_categories WHERE is_active=1 AND (is_system=1 OR owner_id=?) ORDER BY is_system DESC, created_at DESC").bind(a.id).all()).results);
        }
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system) VALUES (?, ?, ?, ?, ?, 0)")
                .bind(id(), a.id, input.name, input.iconType || "emoji", input.iconValue || "⭐")
                .run();
            return ok(true);
        }
    }
    if (path === "/tasks") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "tasks", a.id));
        const input = await body(request);
        if (method === "POST") {
            const taskId = id();
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, a.id, input.categoryId, input.title, input.description || "", input.period || "daily", input.pointType || "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅")
                .run();
            await replaceAssignees(env, "task_assignees", "task_id", taskId, input.childIds || []);
            return ok(true);
        }
    }
    if (path === "/rewards") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "rewards", a.id));
        const input = await body(request);
        if (method === "POST") {
            const rewardId = id();
            await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, icon_type, icon_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(rewardId, a.id, input.title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "none", input.limitCount ?? null, input.iconType || "emoji", input.iconValue || "🎁")
                .run();
            await replaceAssignees(env, "reward_assignees", "reward_id", rewardId, input.childIds || []);
            return ok(true);
        }
    }
    if (path === "/achievements") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO achievements (id, parent_id, title, description, metric, threshold, icon_type, icon_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), a.id, input.title, input.description || "", input.metric || "tasks_completed", Number(input.threshold || 1), input.iconType || "emoji", input.iconValue || "🏅")
                .run();
            return ok(true);
        }
    }
    if (path === "/task-submissions" && method === "POST") {
        const a = requireRole(actor, ["child"]);
        const input = await body(request);
        const task = await env.DB.prepare("SELECT t.* FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE t.id=? AND ta.child_id=? AND t.is_active=1 AND t.deleted_at IS NULL")
            .bind(input.taskId, a.id)
            .first();
        if (!task)
            return fail("NOT_ASSIGNED", "任务不存在或未分配给当前孩子", 404);
        const submittedAt = nowIso();
        await env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
            .bind(id(), task.id, a.id, a.parentId, periodKey(task.period, submittedAt), submittedAt)
            .run();
        return ok(true);
    }
    const review = path.match(/^\/task-submissions\/([^/]+)\/review$/);
    if (review && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const sub = await env.DB.prepare("SELECT s.*, t.point_type, t.points FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND s.parent_id=? AND s.status='pending'")
            .bind(review[1], a.id)
            .first();
        if (!sub)
            return fail("NOT_FOUND", "待审核任务不存在", 404);
        const status = input.approved ? "approved" : "rejected";
        await env.DB.prepare("UPDATE task_submissions SET status=?, reviewed_at=?, review_note=? WHERE id=?").bind(status, nowIso(), input.note || "", sub.id).run();
        if (status === "approved") {
            await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'task', ?, ?, ?)")
                .bind(id(), sub.child_id, a.id, signedPoints(sub.point_type, Number(sub.points)), sub.id, sub.period_key, "任务审核通过")
                .run();
            await recalcAchievements(env, a.id, sub.child_id);
        }
        return ok(true);
    }
    if (path === "/reward-redemptions" && method === "POST") {
        const a = requireRole(actor, ["child"]);
        const input = await body(request);
        const reward = await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE r.id=? AND ra.child_id=? AND r.is_active=1 AND r.deleted_at IS NULL")
            .bind(input.rewardId, a.id)
            .first();
        if (!reward)
            return fail("NOT_ASSIGNED", "奖励不存在或未分配给当前孩子", 404);
        if ((await balance(env, a.id)) < Number(reward.cost_points))
            return fail("LOW_BALANCE", "积分不足", 409);
        if (reward.stock !== null) {
            const used = Number((await env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE reward_id=? AND status IN ('pending','redeemed')").bind(reward.id).first())?.v || 0);
            if (used >= Number(reward.stock))
                return fail("OUT_OF_STOCK", "奖励库存不足", 409);
        }
        const requestedAt = nowIso();
        const pkey = periodKey(reward.limit_period, requestedAt);
        if (reward.limit_period !== "none" && reward.limit_count !== null) {
            const count = Number((await env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE reward_id=? AND child_id=? AND period_key=? AND status IN ('pending','redeemed')").bind(reward.id, a.id, pkey).first())?.v || 0);
            if (count >= Number(reward.limit_count))
                return fail("LIMIT_REACHED", "已达到本周期兑换次数限制", 409);
        }
        const redemptionId = id();
        await env.DB.prepare("INSERT INTO reward_redemptions (id, reward_id, child_id, parent_id, period_key, requested_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
            .bind(redemptionId, reward.id, a.id, a.parentId, pkey, requestedAt)
            .run();
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'reward', ?, ?, ?)")
            .bind(id(), a.id, a.parentId, -Number(reward.cost_points), redemptionId, pkey, "兑换奖励")
            .run();
        await recalcAchievements(env, a.parentId, a.id);
        return ok(true);
    }
    const redemptionAction = path.match(/^\/reward-redemptions\/([^/]+)\/(redeem|cancel)$/);
    if (redemptionAction && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='pending'")
            .bind(redemptionAction[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "待处理兑换不存在", 404);
        if (redemptionAction[2] === "redeem") {
            await env.DB.prepare("UPDATE reward_redemptions SET status='redeemed', redeemed_at=? WHERE id=?").bind(nowIso(), redemption.id).run();
        }
        else {
            await env.DB.prepare("UPDATE reward_redemptions SET status='cancelled', cancelled_at=? WHERE id=?").bind(nowIso(), redemption.id).run();
            await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'reward_cancel', ?, ?, ?)")
                .bind(id(), redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "取消兑换退回")
                .run();
            await recalcAchievements(env, a.id, redemption.child_id);
        }
        return ok(true);
    }
    if (path === "/points/ledger" && method === "GET") {
        const a = requireRole(actor, ["parent", "child"]);
        const childId = a.role === "child" ? a.id : url.searchParams.get("childId");
        if (!childId)
            return fail("BAD_REQUEST", "缺少 childId");
        if (a.role === "parent" && !(await childIdsForParent(env, a.id)).includes(childId))
            return fail("FORBIDDEN", "没有权限查看该孩子积分", 403);
        return ok((await env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? ORDER BY created_at DESC LIMIT 100").bind(childId).all()).results);
    }
    if (path === "/dashboard/parent" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all()).results;
        const childCards = await Promise.all(children.map(async (child) => ({ ...child, balance: await balance(env, child.id) })));
        return ok({
            children: childCards,
            pendingSubmissions: (await env.DB.prepare("SELECT s.*, t.title, c.display_name child_name FROM task_submissions s JOIN tasks t ON t.id=s.task_id JOIN children c ON c.id=s.child_id WHERE s.parent_id=? AND s.status='pending' ORDER BY s.submitted_at").bind(a.id).all()).results,
            pendingRedemptions: (await env.DB.prepare("SELECT rr.*, r.title, c.display_name child_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN children c ON c.id=rr.child_id WHERE rr.parent_id=? AND rr.status='pending' ORDER BY rr.requested_at").bind(a.id).all()).results
        });
    }
    if (path === "/dashboard/child" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        const currentTasks = await env.DB.prepare("SELECT t.*, tc.name category_name, tc.icon_type category_icon_type, tc.icon_value category_icon_value FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id JOIN task_categories tc ON tc.id=t.category_id WHERE ta.child_id=? AND t.is_active=1 AND t.deleted_at IS NULL ORDER BY tc.name, t.created_at DESC")
            .bind(a.id)
            .all();
        const taskRows = await Promise.all(currentTasks.results.map(async (task) => {
            const pkey = periodKey(task.period);
            const submission = await env.DB.prepare("SELECT status FROM task_submissions WHERE task_id=? AND child_id=? AND period_key=?").bind(task.id, a.id, pkey).first();
            return { ...task, periodKey: pkey, submissionStatus: submission?.status || null };
        }));
        return ok({
            child: a,
            balance: await balance(env, a.id),
            tasks: taskRows,
            rewards: (await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE ra.child_id=? AND r.is_active=1 AND r.deleted_at IS NULL ORDER BY r.cost_points").bind(a.id).all()).results,
            achievements: (await env.DB.prepare("SELECT a.*, ca.unlocked_at FROM achievements a JOIN child_achievements ca ON ca.achievement_id=a.id WHERE ca.child_id=? ORDER BY ca.unlocked_at DESC").bind(a.id).all()).results
        });
    }
    return fail("NOT_FOUND", "接口不存在", 404);
}
export const onRequest = async ({ request, env }) => {
    try {
        return await route(request, env);
    }
    catch (error) {
        if (error instanceof Response)
            return error;
        return fail("SERVER_ERROR", error instanceof Error ? error.message : "服务器错误", 500);
    }
};
