import { DEFAULT_TIMEZONE_OFFSET_MINUTES, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, nextPeriodReset, periodKey, signedPoints } from "../../src/lib/domain.js";
const json = (data, init) => new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) }
});
const ok = (data) => json({ data });
const fail = (code, message, status = 400) => json({ error: { code, message } }, { status });
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const PBKDF2_ITERATIONS = 100000;
let bootstrapPromise = null;
const clampTimezoneOffset = (value) => Math.max(-840, Math.min(840, Number(value)));
async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function verifyPassword(password, stored) {
    const [, iterations, salt64, hash64] = stored.split("$");
    if (!iterations || !salt64 || !hash64)
        return false;
    if (Number(iterations) > PBKDF2_ITERATIONS) {
        throw new Error(`Unsupported PBKDF2 iteration count: ${iterations}`);
    }
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
async function ensureNotificationsSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('user', 'child')),
  recipient_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'child', 'system')),
  actor_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  related_type TEXT,
  related_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id, read_at, created_at)").run();
}
async function ensureSystemSettings(env) {
    await env.DB.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('timezone_offset_minutes', ?)").bind(String(DEFAULT_TIMEZONE_OFFSET_MINUTES)).run();
}
async function timezoneOffsetMinutes(env) {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key='timezone_offset_minutes'").first();
    const value = Number(row?.value ?? DEFAULT_TIMEZONE_OFFSET_MINUTES);
    return Number.isFinite(value) ? clampTimezoneOffset(value) : DEFAULT_TIMEZONE_OFFSET_MINUTES;
}
function timezoneLabel(offsetMinutes) {
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, "0");
    const minutes = String(abs % 60).padStart(2, "0");
    return `UTC${sign}${hours}:${minutes}`;
}
async function ensureFeedbackSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback_templates (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('praise', 'criticism')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL CHECK(points >= 0),
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '✨',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_templates_parent ON feedback_templates(parent_id, kind, is_active, deleted_at)").run();
}
async function ensureCategorySchema(env) {
    const columns = (await env.DB.prepare("PRAGMA table_info(task_categories)").all()).results.map((row) => row.name);
    if (!columns.includes("source_system_id")) {
        await env.DB.prepare("ALTER TABLE task_categories ADD COLUMN source_system_id TEXT REFERENCES task_categories(id)").run();
    }
}
async function ensureAchievementSchema(env) {
    const columns = (await env.DB.prepare("PRAGMA table_info(achievements)").all()).results.map((row) => row.name);
    if (!columns.includes("rule_type")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'tasks_completed'").run();
        await env.DB.prepare("UPDATE achievements SET rule_type=metric WHERE metric IN ('total_earned', 'balance', 'tasks_completed', 'streak_days', 'redemptions')").run();
    }
    if (!columns.includes("window_type")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN window_type TEXT NOT NULL DEFAULT 'all_time'").run();
    }
    if (!columns.includes("window_start")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN window_start TEXT").run();
    }
    if (!columns.includes("window_end")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN window_end TEXT").run();
    }
    if (!columns.includes("target_task_id")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN target_task_id TEXT REFERENCES tasks(id)").run();
    }
    if (!columns.includes("target_category_id")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN target_category_id TEXT REFERENCES task_categories(id)").run();
    }
}
async function bootstrap(env) {
    if (!bootstrapPromise) {
        bootstrapPromise = (async () => {
            await ensureAdmin(env);
            await ensureNotificationsSchema(env);
            await ensureSystemSettings(env);
            await ensureFeedbackSchema(env);
            await ensureCategorySchema(env);
            await ensureAchievementSchema(env);
        })().catch((error) => {
            bootstrapPromise = null;
            throw error;
        });
    }
    await bootstrapPromise;
}
async function ensureRewardOnceSchema(env) {
    const schema = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rewards'").first();
    if (!schema?.sql || String(schema.sql).includes("'once'"))
        return;
    await env.DB.prepare("PRAGMA foreign_keys = OFF").run();
    await env.DB.prepare("DROP TABLE IF EXISTS reward_assignees_backup").run();
    await env.DB.prepare("DROP TABLE IF EXISTS reward_redemptions_backup").run();
    await env.DB.prepare("DROP TABLE IF EXISTS rewards_new").run();
    await env.DB.prepare("CREATE TABLE reward_assignees_backup AS SELECT * FROM reward_assignees").run();
    await env.DB.prepare("CREATE TABLE reward_redemptions_backup AS SELECT * FROM reward_redemptions").run();
    await env.DB.prepare(`CREATE TABLE rewards_new (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cost_points INTEGER NOT NULL CHECK(cost_points >= 0),
  stock INTEGER,
  limit_period TEXT NOT NULL DEFAULT 'daily' CHECK(limit_period IN ('none', 'daily', 'weekly', 'monthly', 'once')),
  limit_count INTEGER,
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '🎁',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare(`INSERT INTO rewards_new (
  id, parent_id, title, description, cost_points, stock, limit_period, limit_count,
  icon_type, icon_value, is_active, deleted_at, created_at, updated_at
)
SELECT
  id, parent_id, title, description, cost_points, stock, limit_period, limit_count,
  icon_type, icon_value, is_active, deleted_at, created_at, updated_at
FROM rewards`).run();
    await env.DB.prepare("DROP TABLE reward_assignees").run();
    await env.DB.prepare("DROP TABLE reward_redemptions").run();
    await env.DB.prepare("DROP TABLE rewards").run();
    await env.DB.prepare("ALTER TABLE rewards_new RENAME TO rewards").run();
    await env.DB.prepare(`CREATE TABLE reward_assignees (
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  PRIMARY KEY (reward_id, child_id)
)`).run();
    await env.DB.prepare(`CREATE TABLE reward_redemptions (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'redeemed', 'cancelled')),
  redeemed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("INSERT INTO reward_assignees SELECT * FROM reward_assignees_backup").run();
    await env.DB.prepare("INSERT INTO reward_redemptions SELECT * FROM reward_redemptions_backup").run();
    await env.DB.prepare("DROP TABLE reward_assignees_backup").run();
    await env.DB.prepare("DROP TABLE reward_redemptions_backup").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_redemptions_parent_status ON reward_redemptions(parent_id, status)").run();
    await env.DB.prepare("PRAGMA foreign_keys = ON").run();
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
async function usernameExists(env, username, ignore) {
    const normalized = String(username || "").trim();
    if (!normalized)
        return false;
    const user = await env.DB.prepare("SELECT id FROM users WHERE username=? AND deleted_at IS NULL").bind(normalized).first();
    if (user && ignore !== `user:${user.id}`)
        return true;
    const child = await env.DB.prepare("SELECT id FROM children WHERE username=? AND deleted_at IS NULL").bind(normalized).first();
    return !!(child && ignore !== `child:${child.id}`);
}
async function replaceAssignees(env, table, key, keyValue, childIds) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${key}=?`).bind(keyValue).run();
    for (const childId of childIds) {
        await env.DB.prepare(`INSERT INTO ${table} (${key}, child_id) VALUES (?, ?)`).bind(keyValue, childId).run();
    }
}
const ACHIEVEMENT_RULE_TYPES = new Set([
    "tasks_completed",
    "total_earned",
    "balance",
    "streak_days",
    "redemptions",
    "same_task_streak",
    "category_tasks",
    "category_streak",
    "praise_count",
    "praise_streak",
    "no_criticism_days",
    "no_criticism_window"
]);
const ACHIEVEMENT_WINDOW_TYPES = new Set(["all_time", "current_week", "current_month", "custom"]);
function normalizeAchievementInput(input = {}) {
    const requestedRule = input.ruleType || input.rule_type || input.metric || "tasks_completed";
    const ruleType = ACHIEVEMENT_RULE_TYPES.has(requestedRule) ? requestedRule : "tasks_completed";
    const requestedWindow = input.windowType || input.window_type || "all_time";
    const windowType = ACHIEVEMENT_WINDOW_TYPES.has(requestedWindow) ? requestedWindow : "all_time";
    const threshold = ruleType === "no_criticism_window" ? 1 : Math.max(0, Number(input.threshold || 1));
    const windowStart = windowType === "custom" ? String(input.windowStart || input.window_start || "").slice(0, 10) || null : null;
    const windowEnd = windowType === "custom" ? String(input.windowEnd || input.window_end || "").slice(0, 10) || null : null;
    const targetTaskId = ruleType === "same_task_streak" ? String(input.targetTaskId || input.target_task_id || "") || null : null;
    const targetCategoryId = ruleType === "category_tasks" || ruleType === "category_streak" ? String(input.targetCategoryId || input.target_category_id || "") || null : null;
    const metric = ["same_task_streak", "category_tasks", "category_streak"].includes(ruleType) ? "tasks_completed"
        : ["praise_count", "praise_streak", "no_criticism_days", "no_criticism_window"].includes(ruleType) ? "total_earned"
            : ruleType;
    return { ruleType, metric, threshold, windowType, windowStart, windowEnd, targetTaskId, targetCategoryId };
}
function countRowsInWindow(rows, dateKey, achievement, offset, now) {
    const windowType = achievement.window_type || "all_time";
    return rows.filter((row) => inAchievementWindow(row[dateKey], windowType, now, offset, achievement.window_start, achievement.window_end)).length;
}
async function balance(env, childId) {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) balance FROM point_ledger WHERE child_id=?").bind(childId).first();
    return Number(row?.balance || 0);
}
async function balancesForChildren(env, childIds) {
    if (!childIds.length)
        return new Map();
    const placeholders = childIds.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT child_id, COALESCE(SUM(amount), 0) balance FROM point_ledger WHERE child_id IN (${placeholders}) GROUP BY child_id`)
        .bind(...childIds)
        .all()).results;
    return new Map(rows.map((row) => [row.child_id, Number(row.balance || 0)]));
}
async function recalcAchievements(env, parentId, childId) {
    const achievements = await env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND is_active=1 AND deleted_at IS NULL").bind(parentId).all();
    const offset = await timezoneOffsetMinutes(env);
    const now = nowIso();
    const current = await balance(env, childId);
    const approvedTasks = (await env.DB.prepare(`SELECT s.task_id, s.submitted_at, t.category_id
FROM task_submissions s
JOIN tasks t ON t.id=s.task_id
WHERE s.child_id=? AND s.status='approved'`).bind(childId).all()).results;
    const positiveLedger = (await env.DB.prepare("SELECT amount, created_at FROM point_ledger WHERE child_id=? AND amount > 0").bind(childId).all()).results;
    const feedbackLedger = (await env.DB.prepare("SELECT source_type, created_at FROM point_ledger WHERE child_id=? AND source_type IN ('praise', 'criticism')").bind(childId).all()).results;
    const redemptions = (await env.DB.prepare("SELECT requested_at FROM reward_redemptions WHERE child_id=? AND status IN ('pending','redeemed')").bind(childId).all()).results;
    for (const achievement of achievements.results) {
        const normalized = {
            ...achievement,
            rule_type: achievement.rule_type || achievement.metric || "tasks_completed",
            window_type: achievement.window_type || "all_time"
        };
        let value = 0;
        if (normalized.rule_type === "balance") {
            value = current;
        }
        else if (normalized.rule_type === "streak_days") {
            value = consecutiveDayStreak(approvedTasks.map((row) => row.submitted_at), offset);
        }
        else if (normalized.rule_type === "same_task_streak") {
            const taskIds = normalized.target_task_id ? [normalized.target_task_id] : [...new Set(approvedTasks.map((row) => row.task_id))];
            value = Math.max(0, ...taskIds.map((taskId) => consecutiveSameTaskStreak(approvedTasks.filter((row) => row.task_id === taskId).map((row) => row.submitted_at), offset)));
        }
        else if (normalized.rule_type === "category_tasks") {
            const rows = approvedTasks.filter((row) => !normalized.target_category_id || row.category_id === normalized.target_category_id);
            value = countRowsInWindow(rows, "submitted_at", normalized, offset, now);
        }
        else if (normalized.rule_type === "category_streak") {
            const rows = approvedTasks.filter((row) => !normalized.target_category_id || row.category_id === normalized.target_category_id);
            value = consecutiveDayStreak(rows.map((row) => row.submitted_at), offset);
        }
        else if (normalized.rule_type === "praise_count") {
            value = countRowsInWindow(feedbackLedger.filter((row) => row.source_type === "praise"), "created_at", normalized, offset, now);
        }
        else if (normalized.rule_type === "praise_streak") {
            value = consecutiveDayStreak(feedbackLedger.filter((row) => row.source_type === "praise").map((row) => row.created_at), offset);
        }
        else if (normalized.rule_type === "no_criticism_days") {
            value = daysWithoutEvents(feedbackLedger.filter((row) => row.source_type === "criticism").map((row) => row.created_at), now, offset, Math.max(1, Number(normalized.threshold)));
        }
        else if (normalized.rule_type === "no_criticism_window") {
            const count = countRowsInWindow(feedbackLedger.filter((row) => row.source_type === "criticism"), "created_at", normalized, offset, now);
            value = count === 0 ? 1 : 0;
        }
        else if (normalized.rule_type === "total_earned") {
            value = positiveLedger
                .filter((row) => inAchievementWindow(row.created_at, normalized.window_type, now, offset, normalized.window_start, normalized.window_end))
                .reduce((sum, row) => sum + Number(row.amount || 0), 0);
        }
        else if (normalized.rule_type === "redemptions") {
            value = countRowsInWindow(redemptions, "requested_at", normalized, offset, now);
        }
        else {
            value = countRowsInWindow(approvedTasks, "submitted_at", normalized, offset, now);
        }
        if (value >= Number(normalized.threshold)) {
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
async function listConfig(env, parentId) {
    await ensureFeedbackSchema(env);
    const [categories, tasks, rewards, achievements, feedbackTemplates] = await Promise.all([
        env.DB.prepare("SELECT * FROM task_categories WHERE is_active=1 AND ((is_system=1 AND id NOT IN (SELECT source_system_id FROM task_categories WHERE owner_id=? AND source_system_id IS NOT NULL)) OR owner_id=?) ORDER BY is_system DESC, created_at DESC").bind(parentId, parentId).all(),
        listWithAssignees(env, "tasks", parentId),
        listWithAssignees(env, "rewards", parentId),
        env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(parentId).all(),
        env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(parentId).all()
    ]);
    return {
        categories: categories.results,
        tasks,
        rewards,
        achievements: achievements.results,
        feedbackTemplates: feedbackTemplates.results
    };
}
function importedActive(item) {
    if (item.is_active === undefined && item.isActive === undefined)
        return 0;
    return item.is_active === 0 || item.isActive === false ? 0 : 1;
}
async function insertTaskFromConfig(env, parentId, item, categoryMap, childMap) {
    const title = String(item.title || "").trim();
    if (!title)
        return false;
    const period = item.period || "daily";
    const exists = await env.DB.prepare("SELECT id FROM tasks WHERE parent_id=? AND title=? AND period=? AND deleted_at IS NULL").bind(parentId, title, period).first();
    if (exists)
        return false;
    const categoryId = categoryMap.get(item.category_name) || categoryMap.values().next().value;
    if (!categoryId)
        return false;
    const taskId = id();
    await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, is_active) VALUES (?, ?, ?, ?, ?, ?, 'earn', ?, ?, ?, ?, ?)")
        .bind(taskId, parentId, categoryId, title, item.description || "", period, Number(item.points || 0), item.icon_type || "emoji", item.icon_value || "✅", Math.max(1, Number(item.limit_count || item.limitCount || 1)), importedActive(item))
        .run();
    await replaceAssignees(env, "task_assignees", "task_id", taskId, (item.assignee_names || []).map((name) => childMap.get(name)).filter(Boolean));
    return true;
}
async function importConfig(env, parentId, input) {
    await ensureFeedbackSchema(env);
    const stats = {
        categories: { created: 0, skipped: 0 },
        tasks: { created: 0, skipped: 0 },
        rewards: { created: 0, skipped: 0 },
        achievements: { created: 0, skipped: 0 },
        feedbackTemplates: { created: 0, skipped: 0 }
    };
    const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(parentId).all()).results;
    const childMap = new Map(children.map((child) => [child.display_name, child.id]));
    const categoryRows = (await env.DB.prepare("SELECT id, name FROM task_categories WHERE is_active=1 AND ((is_system=1 AND id NOT IN (SELECT source_system_id FROM task_categories WHERE owner_id=? AND source_system_id IS NOT NULL)) OR owner_id=?)").bind(parentId, parentId).all()).results;
    const categoryMap = new Map(categoryRows.map((category) => [category.name, category.id]));
    for (const item of input.categories || []) {
        const name = String(item.name || "").trim();
        if (!name || categoryMap.has(name)) {
            stats.categories.skipped += 1;
            continue;
        }
        const categoryId = id();
        await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system) VALUES (?, ?, ?, ?, ?, 0)")
            .bind(categoryId, parentId, name, item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || "⭐")
            .run();
        categoryMap.set(name, categoryId);
        stats.categories.created += 1;
    }
    for (const item of input.tasks || []) {
        if (await insertTaskFromConfig(env, parentId, item, categoryMap, childMap))
            stats.tasks.created += 1;
        else
            stats.tasks.skipped += 1;
    }
    for (const item of input.rewards || []) {
        const title = String(item.title || "").trim();
        const exists = title ? await env.DB.prepare("SELECT id FROM rewards WHERE parent_id=? AND title=? AND deleted_at IS NULL").bind(parentId, title).first() : true;
        if (exists) {
            stats.rewards.skipped += 1;
            continue;
        }
        const rewardId = id();
        await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(rewardId, parentId, title, item.description || "", Number(item.cost_points ?? item.costPoints ?? 0), item.stock ?? null, item.limit_period || item.limitPeriod || "daily", (item.limit_period || item.limitPeriod) === "once" ? 1 : item.limit_count ?? item.limitCount ?? 1, item.icon_type || "emoji", item.icon_value || "🎁", importedActive(item))
            .run();
        await replaceAssignees(env, "reward_assignees", "reward_id", rewardId, (item.assignee_names || []).map((name) => childMap.get(name)).filter(Boolean));
        stats.rewards.created += 1;
    }
    for (const item of input.achievements || []) {
        const title = String(item.title || "").trim();
        const rule = normalizeAchievementInput({
            ...item,
            targetCategoryId: categoryMap.get(item.target_category_name || item.targetCategoryName) || item.target_category_id || item.targetCategoryId
        });
        const exists = title ? await env.DB.prepare(`SELECT id FROM achievements
WHERE parent_id=? AND title=? AND rule_type=? AND threshold=? AND window_type=?
  AND COALESCE(window_start, '')=COALESCE(?, '') AND COALESCE(window_end, '')=COALESCE(?, '')
  AND COALESCE(target_task_id, '')=COALESCE(?, '') AND COALESCE(target_category_id, '')=COALESCE(?, '')
  AND deleted_at IS NULL`)
            .bind(parentId, title, rule.ruleType, rule.threshold, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId)
            .first() : true;
        if (exists) {
            stats.achievements.skipped += 1;
            continue;
        }
        await env.DB.prepare(`INSERT INTO achievements (
  id, parent_id, title, description, metric, threshold, icon_type, icon_value,
  rule_type, window_type, window_start, window_end, target_task_id, target_category_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id(), parentId, title, item.description || "", rule.metric, rule.threshold, item.icon_type || "emoji", item.icon_value || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId)
            .run();
        stats.achievements.created += 1;
    }
    for (const item of input.feedbackTemplates || input.feedback_templates || []) {
        const title = String(item.title || "").trim();
        const kind = item.kind === "criticism" ? "criticism" : "praise";
        const exists = title ? await env.DB.prepare("SELECT id FROM feedback_templates WHERE parent_id=? AND kind=? AND title=? AND deleted_at IS NULL").bind(parentId, kind, title).first() : true;
        if (exists) {
            stats.feedbackTemplates.skipped += 1;
            continue;
        }
        await env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id(), parentId, kind, title, item.description || "", Number(item.points || 0), item.icon_type || "emoji", item.icon_value || (kind === "praise" ? "✨" : "⚠️"), importedActive(item))
            .run();
        stats.feedbackTemplates.created += 1;
    }
    return stats;
}
async function childUsageForPeriod(env, table, idColumn, itemId, childId, periodKeyValue, activeStatuses) {
    const placeholders = activeStatuses.map(() => "?").join(",");
    const row = await env.DB.prepare(`SELECT COUNT(*) v FROM ${table} WHERE ${idColumn}=? AND child_id=? AND period_key=? AND status IN (${placeholders})`)
        .bind(itemId, childId, periodKeyValue, ...activeStatuses)
        .first();
    return Number(row?.v || 0);
}
async function childUsageCountsForPeriods(env, table, idColumn, childId, itemPeriods, activeStatuses) {
    if (!itemPeriods.length)
        return new Map();
    const itemIds = [...new Set(itemPeriods.map((item) => item.itemId))];
    const periodKeys = [...new Set(itemPeriods.map((item) => item.periodKey))];
    const statusPlaceholders = activeStatuses.map(() => "?").join(",");
    const itemPlaceholders = itemIds.map(() => "?").join(",");
    const periodPlaceholders = periodKeys.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT ${idColumn} item_id, period_key, COUNT(*) v FROM ${table} WHERE child_id=? AND status IN (${statusPlaceholders}) AND ${idColumn} IN (${itemPlaceholders}) AND period_key IN (${periodPlaceholders}) GROUP BY ${idColumn}, period_key`)
        .bind(childId, ...activeStatuses, ...itemIds, ...periodKeys)
        .all()).results;
    return new Map(rows.map((row) => [`${row.item_id}:${row.period_key}`, Number(row.v || 0)]));
}
async function childLatestTaskStatuses(env, childId, itemPeriods) {
    if (!itemPeriods.length)
        return { latest: new Map(), rejected: new Map() };
    const taskIds = [...new Set(itemPeriods.map((item) => item.itemId))];
    const periodKeys = [...new Set(itemPeriods.map((item) => item.periodKey))];
    const taskPlaceholders = taskIds.map(() => "?").join(",");
    const periodPlaceholders = periodKeys.map(() => "?").join(",");
    const latestRows = (await env.DB.prepare(`SELECT task_id, period_key, status, review_note FROM task_submissions WHERE child_id=? AND task_id IN (${taskPlaceholders}) AND period_key IN (${periodPlaceholders}) ORDER BY submitted_at DESC`)
        .bind(childId, ...taskIds, ...periodKeys)
        .all()).results;
    const rejectedRows = (await env.DB.prepare(`SELECT task_id, period_key, status, review_note FROM task_submissions WHERE child_id=? AND status='rejected' AND task_id IN (${taskPlaceholders}) AND period_key IN (${periodPlaceholders}) ORDER BY reviewed_at DESC`)
        .bind(childId, ...taskIds, ...periodKeys)
        .all()).results;
    const latest = new Map();
    const rejected = new Map();
    for (const row of latestRows) {
        const key = `${row.task_id}:${row.period_key}`;
        if (!latest.has(key))
            latest.set(key, row);
    }
    for (const row of rejectedRows) {
        const key = `${row.task_id}:${row.period_key}`;
        if (row.status === "rejected" && !rejected.has(key))
            rejected.set(key, row);
    }
    return { latest, rejected };
}
async function notify(env, input) {
    await env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, related_type, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id(), input.recipientType, input.recipientId, input.actorType, input.actorId || null, input.title, input.body || "", input.eventType, input.relatedType || null, input.relatedId || null, nowIso())
        .run();
}
function notificationRecipient(actor) {
    return actor.role === "child" ? { type: "child", id: actor.id } : { type: "user", id: actor.id };
}
function eventTypeLabel(value) {
    const labels = {
        task_submitted: "任务",
        task_approved: "任务",
        task_rejected: "任务",
        reward_requested: "奖励",
        reward_redeemed: "奖励",
        reward_cancelled: "奖励",
        praise: "表扬",
        criticism: "批评"
    };
    return labels[value] || "消息";
}
async function notificationSource(env, item) {
    if (item.related_type === "task_submission") {
        const row = await env.DB.prepare("SELECT t.title FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=?").bind(item.related_id).first();
        if (row?.title)
            return { sourceTypeLabel: "任务", sourceLabel: `任务：${row.title}` };
    }
    if (item.related_type === "reward_redemption") {
        const row = await env.DB.prepare("SELECT r.title FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=?").bind(item.related_id).first();
        if (row?.title)
            return { sourceTypeLabel: "奖励", sourceLabel: `奖励：${row.title}` };
    }
    if (item.related_type === "point_ledger") {
        const row = await env.DB.prepare("SELECT pl.source_type, ft.title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id WHERE pl.id=?").bind(item.related_id).first();
        if (row?.title) {
            const label = row.source_type === "criticism" ? "批评" : "表扬";
            return { sourceTypeLabel: label, sourceLabel: `${label}：${row.title}` };
        }
        if (row?.source_type) {
            const label = eventTypeLabel(row.source_type);
            return { sourceTypeLabel: label, sourceLabel: label };
        }
    }
    const fallback = eventTypeLabel(item.event_type);
    return { sourceTypeLabel: fallback, sourceLabel: fallback };
}
async function withNotificationSources(env, rows) {
    return Promise.all(rows.map(async (item) => ({ ...item, ...(await notificationSource(env, item)) })));
}
async function route(request, env) {
    await bootstrap(env);
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
        if (!account)
            return fail("BAD_CREDENTIALS", "账号或密码错误", 401);
        let passwordOk = false;
        try {
            passwordOk = await verifyPassword(input.password || "", account.password_hash);
        }
        catch (error) {
            if (account.role === "admin" && account.username === (env.ADMIN_USERNAME || "admin") && input.password === (env.ADMIN_PASSWORD || "change-me-admin-password")) {
                const passwordHash = await hashPassword(input.password || "");
                await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
                    .bind(passwordHash, nowIso(), account.id)
                    .run();
                passwordOk = true;
            }
            else {
                throw error;
            }
        }
        if (!passwordOk)
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
    if (path === "/admin/system-settings") {
        requireRole(actor, ["admin"]);
        if (method === "GET") {
            const offset = await timezoneOffsetMinutes(env);
            return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset) });
        }
        if (method === "PATCH") {
            const input = await body(request);
            const offset = clampTimezoneOffset(input.timezoneOffsetMinutes);
            if (!Number.isFinite(offset) || offset % 15 !== 0)
                return fail("BAD_REQUEST", "请输入有效时区，最小单位为 15 分钟");
            await env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES ('timezone_offset_minutes', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
                .bind(String(offset), nowIso())
                .run();
            return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset) });
        }
    }
    if (path === "/admin/users" && method === "POST") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        const username = String(input.username || "").trim();
        if (!username)
            return fail("BAD_REQUEST", "请输入账号");
        if (await usernameExists(env, username))
            return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
        await env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', ?)")
            .bind(id(), username, await hashPassword(input.password || "123456"), input.displayName || username)
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
        if (input.displayName) {
            await env.DB.prepare("UPDATE users SET display_name=?, updated_at=? WHERE id=? AND role='parent'").bind(input.displayName, nowIso(), userPatch[1]).run();
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
    if (path === "/notifications" && method === "GET") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        const rows = (await env.DB.prepare("SELECT * FROM notifications WHERE recipient_type=? AND recipient_id=? ORDER BY created_at DESC LIMIT 50")
            .bind(recipient.type, recipient.id)
            .all()).results;
        const unread = Number((await env.DB.prepare("SELECT COUNT(*) v FROM notifications WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(recipient.type, recipient.id)
            .first())?.v || 0);
        return ok({ items: await withNotificationSources(env, rows), unread });
    }
    if (path === "/notifications/read-all" && method === "PATCH") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL")
            .bind(nowIso(), recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    const notificationRead = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (notificationRead && method === "PATCH") {
        const a = requireRole(actor, ["parent", "child"]);
        const recipient = notificationRecipient(a);
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=? AND recipient_type=? AND recipient_id=?")
            .bind(nowIso(), notificationRead[1], recipient.type, recipient.id)
            .run();
        return ok(true);
    }
    if (path === "/children") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT id, username, display_name, status FROM children WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const username = String(input.username || "").trim();
            if (!username)
                return fail("BAD_REQUEST", "请输入账号");
            if (await usernameExists(env, username))
                return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
            await env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name) VALUES (?, ?, ?, ?, ?)")
                .bind(id(), a.id, username, await hashPassword(input.password || "123456"), input.displayName || username)
                .run();
            return ok(true);
        }
    }
    const childPatch = path.match(/^\/children\/([^/]+)$/);
    if (childPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(childPatch[1], a.id).first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        if (input.displayName) {
            await env.DB.prepare("UPDATE children SET display_name=?, updated_at=? WHERE id=?").bind(input.displayName, nowIso(), childPatch[1]).run();
        }
        if (input.password) {
            await env.DB.prepare("UPDATE children SET password_hash=?, updated_at=? WHERE id=?").bind(await hashPassword(input.password), nowIso(), childPatch[1]).run();
        }
        if (input.status) {
            await env.DB.prepare("UPDATE children SET status=?, updated_at=? WHERE id=?").bind(input.status, nowIso(), childPatch[1]).run();
        }
        return ok(true);
    }
    if (childPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        await env.DB.prepare("UPDATE children SET deleted_at=?, status='disabled', updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(nowIso(), nowIso(), childPatch[1], a.id)
            .run();
        return ok(true);
    }
    const feedbackEvent = path.match(/^\/children\/([^/]+)\/feedback-events$/);
    if (feedbackEvent && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(feedbackEvent[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const template = await env.DB.prepare("SELECT * FROM feedback_templates WHERE id=? AND parent_id=? AND is_active=1 AND deleted_at IS NULL")
            .bind(input.templateId, a.id)
            .first();
        if (!template)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        const ledgerId = id();
        const points = Math.abs(Number(template.points || 0));
        const amount = template.kind === "praise" ? points : -points;
        const label = template.kind === "praise" ? "表扬" : "批评";
        const note = template.description ? `${template.title}：${template.description}` : template.title;
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
            .bind(ledgerId, child.id, a.id, amount, template.kind, template.id, note)
            .run();
        await recalcAchievements(env, a.id, child.id);
        await notify(env, {
            recipientType: "child",
            recipientId: child.id,
            actorType: "user",
            actorId: a.id,
            title: `收到一条${label}`,
            body: `${note}，${amount >= 0 ? "增加" : "扣除"} ${points} 积分。`,
            eventType: template.kind,
            relatedType: "point_ledger",
            relatedId: ledgerId
        });
        return ok(true);
    }
    if (path === "/feedback-templates") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const kind = input.kind === "criticism" ? "criticism" : "praise";
            await env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), a.id, kind, input.title, input.description || "", Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1)
                .run();
            return ok(true);
        }
    }
    const feedbackPatch = path.match(/^\/feedback-templates\/([^/]+)$/);
    if (feedbackPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const kind = input.kind === "criticism" ? "criticism" : "praise";
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        await env.DB.prepare("UPDATE feedback_templates SET kind=?, title=?, points=?, icon_type=?, icon_value=?, is_active=?, updated_at=? WHERE id=?")
            .bind(kind, input.title, Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1, nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (feedbackPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        await env.DB.prepare("UPDATE feedback_templates SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/task-categories") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET") {
            return ok((await env.DB.prepare("SELECT * FROM task_categories WHERE is_active=1 AND ((is_system=1 AND id NOT IN (SELECT source_system_id FROM task_categories WHERE owner_id=? AND source_system_id IS NOT NULL)) OR owner_id=?) ORDER BY is_system DESC, created_at DESC").bind(a.id, a.id).all()).results);
        }
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system) VALUES (?, ?, ?, ?, ?, 0)")
                .bind(id(), a.id, input.name, input.iconType || "emoji", input.iconValue || "⭐")
                .run();
            return ok(true);
        }
    }
    const categoryPatch = path.match(/^\/task-categories\/([^/]+)$/);
    if (categoryPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const category = await env.DB.prepare("SELECT * FROM task_categories WHERE id=? AND is_active=1 AND (owner_id=? OR is_system=1)")
            .bind(categoryPatch[1], a.id)
            .first();
        if (!category)
            return fail("NOT_FOUND", "任务分类不存在或不可编辑", 404);
        let targetId = category.id;
        if (category.is_system) {
            const existing = await env.DB.prepare("SELECT id FROM task_categories WHERE owner_id=? AND name=? AND is_system=0 AND is_active=1")
                .bind(a.id, category.name)
                .first();
            targetId = existing?.id || id();
            if (!existing) {
                await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system, source_system_id) VALUES (?, ?, ?, ?, ?, 0, ?)")
                    .bind(targetId, a.id, category.name, category.icon_type, category.icon_value, category.id)
                    .run();
            }
        }
        await env.DB.prepare("UPDATE task_categories SET name=?, icon_type=?, icon_value=? WHERE id=? AND owner_id=?")
            .bind(input.name, input.iconType || "emoji", input.iconValue || "⭐", targetId, a.id)
            .run();
        return ok(true);
    }
    if (categoryPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const category = await env.DB.prepare("SELECT * FROM task_categories WHERE id=? AND is_active=1 AND (owner_id=? OR is_system=1)")
            .bind(categoryPatch[1], a.id)
            .first();
        if (!category)
            return fail("NOT_FOUND", "任务分类不存在", 404);
        const deletedAt = nowIso();
        let targetId = category.id;
        if (category.is_system) {
            const existing = await env.DB.prepare("SELECT id FROM task_categories WHERE owner_id=? AND source_system_id=?")
                .bind(a.id, category.id)
                .first();
            targetId = existing?.id || id();
            if (existing) {
                await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE id=? AND owner_id=?")
                    .bind(targetId, a.id)
                    .run();
            }
            else {
                await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system, is_active, source_system_id) VALUES (?, ?, ?, ?, ?, 0, 0, ?)")
                    .bind(targetId, a.id, category.name, category.icon_type, category.icon_value, category.id)
                    .run();
            }
        }
        else {
            await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE id=? AND owner_id=?")
                .bind(targetId, a.id)
                .run();
        }
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE parent_id=? AND category_id=? AND deleted_at IS NULL")
            .bind(deletedAt, deletedAt, a.id, category.id)
            .run();
        if (targetId !== category.id) {
            await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE parent_id=? AND category_id=? AND deleted_at IS NULL")
                .bind(deletedAt, deletedAt, a.id, targetId)
                .run();
        }
        return ok(true);
    }
    if (path === "/tasks") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "tasks", a.id));
        const input = await body(request);
        if (method === "POST") {
            const taskId = id();
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, a.id, input.categoryId, input.title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), input.isActive === false ? 0 : 1)
                .run();
            await replaceAssignees(env, "task_assignees", "task_id", taskId, input.childIds || []);
            return ok(true);
        }
    }
    const taskPatch = path.match(/^\/tasks\/([^/]+)$/);
    if (taskPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        await env.DB.prepare("UPDATE tasks SET category_id=?, title=?, description=?, period=?, point_type=?, points=?, icon_type=?, icon_value=?, limit_count=?, is_active=?, updated_at=? WHERE id=?")
            .bind(input.categoryId, input.title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), input.isActive === false ? 0 : 1, nowIso(), taskPatch[1])
            .run();
        await replaceAssignees(env, "task_assignees", "task_id", taskPatch[1], input.childIds || []);
        return ok(true);
    }
    if (taskPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), taskPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/rewards") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "rewards", a.id));
        const input = await body(request);
        if (method === "POST") {
            await ensureRewardOnceSchema(env);
            const rewardId = id();
            await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(rewardId, a.id, input.title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1)
                .run();
            await replaceAssignees(env, "reward_assignees", "reward_id", rewardId, input.childIds || []);
            return ok(true);
        }
    }
    const rewardPatch = path.match(/^\/rewards\/([^/]+)$/);
    if (rewardPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        await ensureRewardOnceSchema(env);
        const reward = await env.DB.prepare("SELECT id FROM rewards WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(rewardPatch[1], a.id)
            .first();
        if (!reward)
            return fail("NOT_FOUND", "奖励不存在", 404);
        await env.DB.prepare("UPDATE rewards SET title=?, description=?, cost_points=?, stock=?, limit_period=?, limit_count=?, icon_type=?, icon_value=?, is_active=?, updated_at=? WHERE id=?")
            .bind(input.title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1, nowIso(), rewardPatch[1])
            .run();
        await replaceAssignees(env, "reward_assignees", "reward_id", rewardPatch[1], input.childIds || []);
        return ok(true);
    }
    if (rewardPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        await ensureRewardOnceSchema(env);
        const reward = await env.DB.prepare("SELECT id FROM rewards WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(rewardPatch[1], a.id)
            .first();
        if (!reward)
            return fail("NOT_FOUND", "奖励不存在", 404);
        await env.DB.prepare("UPDATE rewards SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), rewardPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/achievements") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const rule = normalizeAchievementInput(input);
            await env.DB.prepare(`INSERT INTO achievements (
  id, parent_id, title, description, metric, threshold, icon_type, icon_value,
  rule_type, window_type, window_start, window_end, target_task_id, target_category_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(id(), a.id, input.title, input.description || "", rule.metric, rule.threshold, input.iconType || "emoji", input.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId)
                .run();
            return ok(true);
        }
    }
    const achievementPatch = path.match(/^\/achievements\/([^/]+)$/);
    if (achievementPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(achievementPatch[1], a.id)
            .first();
        if (!achievement)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        const rule = normalizeAchievementInput(input);
        await env.DB.prepare(`UPDATE achievements
SET title=?, description=?, metric=?, threshold=?, icon_type=?, icon_value=?,
    rule_type=?, window_type=?, window_start=?, window_end=?, target_task_id=?, target_category_id=?, updated_at=?
WHERE id=?`)
            .bind(input.title, input.description || "", rule.metric, rule.threshold, input.iconType || "emoji", input.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, nowIso(), achievementPatch[1])
            .run();
        return ok(true);
    }
    if (achievementPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(achievementPatch[1], a.id)
            .first();
        if (!achievement)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        await env.DB.prepare("UPDATE achievements SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), achievementPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/config/export" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const config = await listConfig(env, a.id);
        const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
        return ok({
            version: 1,
            exportedAt: nowIso(),
            categories: config.categories.map((item) => ({
                name: item.name,
                icon_type: item.icon_type,
                icon_value: item.icon_value,
                is_system: item.is_system
            })),
            tasks: config.tasks.map((item) => ({
                title: item.title,
                description: item.description,
                category_name: categoryNames.get(item.category_id) || "",
                period: item.period,
                points: item.points,
                limit_count: item.limit_count,
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            rewards: config.rewards.map((item) => ({
                title: item.title,
                description: item.description,
                cost_points: item.cost_points,
                stock: item.stock,
                limit_period: item.limit_period,
                limit_count: item.limit_count,
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            achievements: config.achievements.map((item) => ({
                title: item.title,
                description: item.description,
                metric: item.metric,
                threshold: item.threshold,
                rule_type: item.rule_type || item.metric,
                window_type: item.window_type || "all_time",
                window_start: item.window_start,
                window_end: item.window_end,
                target_task_id: item.target_task_id,
                target_category_id: item.target_category_id,
                target_category_name: categoryNames.get(item.target_category_id) || "",
                icon_type: item.icon_type,
                icon_value: item.icon_value
            })),
            feedbackTemplates: config.feedbackTemplates.map((item) => ({
                kind: item.kind,
                title: item.title,
                description: item.description,
                points: item.points,
                icon_type: item.icon_type,
                icon_value: item.icon_value
            }))
        });
    }
    if (path === "/config/import" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        await ensureRewardOnceSchema(env);
        return ok(await importConfig(env, a.id, await body(request)));
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
        const offset = await timezoneOffsetMinutes(env);
        const pkey = periodKey(task.period, submittedAt, offset);
        const used = await childUsageForPeriod(env, "task_submissions", "task_id", task.id, a.id, pkey, ["pending", "approved"]);
        if (used >= Number(task.limit_count || 1))
            return fail("LIMIT_REACHED", "已达到本周期提交次数限制", 409);
        const submissionId = id();
        await env.DB.prepare("INSERT INTO task_submissions (id, task_id, child_id, parent_id, period_key, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
            .bind(submissionId, task.id, a.id, a.parentId, pkey, submittedAt)
            .run();
        await notify(env, {
            recipientType: "user",
            recipientId: a.parentId,
            actorType: "child",
            actorId: a.id,
            title: "有新的任务待审核",
            body: `${a.displayName} 提交了「${task.title}」。`,
            eventType: "task_submitted",
            relatedType: "task_submission",
            relatedId: submissionId
        });
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
        await notify(env, {
            recipientType: "child",
            recipientId: sub.child_id,
            actorType: "user",
            actorId: a.id,
            title: status === "approved" ? "任务审核通过" : "任务被驳回",
            body: status === "approved" ? "家长已通过你的任务，积分已结算。" : input.note || "家长驳回了这次任务提交。",
            eventType: status === "approved" ? "task_approved" : "task_rejected",
            relatedType: "task_submission",
            relatedId: sub.id
        });
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
        const offset = await timezoneOffsetMinutes(env);
        const pkey = periodKey(reward.limit_period, requestedAt, offset);
        if (reward.limit_period !== "none" && reward.limit_count !== null) {
            const count = await childUsageForPeriod(env, "reward_redemptions", "reward_id", reward.id, a.id, pkey, ["pending", "redeemed"]);
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
        await notify(env, {
            recipientType: "user",
            recipientId: a.parentId,
            actorType: "child",
            actorId: a.id,
            title: "有新的奖励待核销",
            body: `${a.displayName} 兑换了「${reward.title}」。`,
            eventType: "reward_requested",
            relatedType: "reward_redemption",
            relatedId: redemptionId
        });
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
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: "user",
            actorId: a.id,
            title: redemptionAction[2] === "redeem" ? "奖励已核销" : "奖励兑换已取消",
            body: redemptionAction[2] === "redeem" ? "家长已核销你的奖励兑换。" : "家长取消了奖励兑换，积分已退回。",
            eventType: redemptionAction[2] === "redeem" ? "reward_redeemed" : "reward_cancelled",
            relatedType: "reward_redemption",
            relatedId: redemption.id
        });
        return ok(true);
    }
    if (path === "/testing/reset-parent-progress" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const children = await childIdsForParent(env, a.id);
        if (!children.length)
            return ok(true);
        const placeholders = children.map(() => "?").join(",");
        await env.DB.prepare(`DELETE FROM point_ledger WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM task_submissions WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM reward_redemptions WHERE child_id IN (${placeholders})`).bind(...children).run();
        await env.DB.prepare(`DELETE FROM child_achievements WHERE child_id IN (${placeholders})`).bind(...children).run();
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
        const balances = await balancesForChildren(env, children.map((child) => child.id));
        const childCards = children.map((child) => ({ ...child, balance: balances.get(child.id) || 0 }));
        return ok({
            children: childCards,
            pendingSubmissions: (await env.DB.prepare("SELECT s.*, t.title, c.display_name child_name FROM task_submissions s JOIN tasks t ON t.id=s.task_id JOIN children c ON c.id=s.child_id WHERE s.parent_id=? AND s.status='pending' ORDER BY s.submitted_at").bind(a.id).all()).results,
            pendingRedemptions: (await env.DB.prepare("SELECT rr.*, r.title, c.display_name child_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN children c ON c.id=rr.child_id WHERE rr.parent_id=? AND rr.status='pending' ORDER BY rr.requested_at").bind(a.id).all()).results
        });
    }
    if (path === "/dashboard/child" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        const offset = await timezoneOffsetMinutes(env);
        const currentTasks = await env.DB.prepare("SELECT t.*, tc.name category_name, tc.icon_type category_icon_type, tc.icon_value category_icon_value FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id JOIN task_categories tc ON tc.id=t.category_id WHERE ta.child_id=? AND t.is_active=1 AND t.deleted_at IS NULL ORDER BY tc.name, t.created_at DESC")
            .bind(a.id)
            .all();
        const taskPeriods = currentTasks.results.map((task) => ({ itemId: task.id, periodKey: periodKey(task.period, undefined, offset) }));
        const [taskUsageCounts, taskStatuses] = await Promise.all([
            childUsageCountsForPeriods(env, "task_submissions", "task_id", a.id, taskPeriods, ["pending", "approved"]),
            childLatestTaskStatuses(env, a.id, taskPeriods)
        ]);
        const taskRows = currentTasks.results.map((task, index) => {
            const pkey = taskPeriods[index].periodKey;
            const key = `${task.id}:${pkey}`;
            const activeCount = taskUsageCounts.get(key) || 0;
            const latest = taskStatuses.latest.get(key);
            const rejected = taskStatuses.rejected.get(key);
            const limitCount = Number(task.limit_count || 1);
            return {
                ...task,
                periodKey: pkey,
                limitCount,
                usedCount: activeCount,
                remainingCount: Math.max(0, limitCount - activeCount),
                canSubmit: activeCount < limitCount,
                resetAt: nextPeriodReset(task.period, undefined, offset),
                submissionStatus: latest?.status || null,
                rejectionNote: rejected?.review_note || ""
            };
        });
        const rewardRows = await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE ra.child_id=? AND r.is_active=1 AND r.deleted_at IS NULL ORDER BY r.cost_points")
            .bind(a.id)
            .all();
        const rewardPeriods = rewardRows.results.map((reward) => ({ itemId: reward.id, periodKey: periodKey(reward.limit_period, undefined, offset) }));
        const rewardUsageCounts = await childUsageCountsForPeriods(env, "reward_redemptions", "reward_id", a.id, rewardPeriods, ["pending", "redeemed"]);
        const rewards = rewardRows.results.map((reward, index) => {
            const pkey = rewardPeriods[index].periodKey;
            const limitCount = reward.limit_period === "none" || reward.limit_count === null ? null : Number(reward.limit_count);
            const usedCount = limitCount === null ? 0 : rewardUsageCounts.get(`${reward.id}:${pkey}`) || 0;
            return {
                ...reward,
                periodKey: pkey,
                limitCount,
                usedCount,
                remainingCount: limitCount === null ? null : Math.max(0, limitCount - usedCount),
                canRedeem: limitCount === null || usedCount < limitCount,
                resetAt: nextPeriodReset(reward.limit_period, undefined, offset)
            };
        });
        return ok({
            child: a,
            balance: await balance(env, a.id),
            tasks: taskRows,
            rewards,
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
