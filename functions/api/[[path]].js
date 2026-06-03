import { DEFAULT_TIMEZONE_OFFSET_MINUTES, DEFAULT_WEEKDAYS, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, isWeekdayAllowed, nextPeriodReset, normalizeWeekdays, periodKey, prerequisitePeriodKey, reportWindowRange, signedPoints, weekdayInTimezone } from "../../src/lib/domain.js";
const json = (data, init) => new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) }
});
const ok = (data) => json({ data });
const fail = (code, message, status = 400) => json({ error: { code, message } }, { status });
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const PBKDF2_ITERATIONS = 100000;
const DAY_MS = 86400000;
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
  requires_ack INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await ensureColumn(env, "notifications", "requires_ack", "requires_ack INTEGER NOT NULL DEFAULT 0");
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id, read_at, created_at)").run();
}
async function ensureSystemSettings(env) {
    await env.DB.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('timezone_offset_minutes', ?)").bind(String(DEFAULT_TIMEZONE_OFFSET_MINUTES)).run();
    await ensureColumn(env, "children", "ai_enabled", "ai_enabled INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "children", "gender", "gender TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "children", "birth_date", "birth_date TEXT");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_child_greetings (
  child_id TEXT NOT NULL REFERENCES children(id),
  previous_week_key TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  greeting TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, previous_week_key, config_hash)
)`).run();
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
async function tableColumns(env, table) {
    return (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((row) => row.name);
}
async function ensureColumn(env, table, name, ddl) {
    const columns = await tableColumns(env, table);
    if (!columns.includes(name)) {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    }
}
function weekdayJson(value) {
    return JSON.stringify(normalizeWeekdays(value));
}
function localTimeText(value, offsetMinutes) {
    if (!value)
        return "";
    return new Date(new Date(value).getTime() + offsetMinutes * 60000).toISOString().replace("T", " ").slice(0, 19);
}
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
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
    if (!columns.includes("unlock_reward_id")) {
        await env.DB.prepare("ALTER TABLE achievements ADD COLUMN unlock_reward_id TEXT REFERENCES rewards(id)").run();
    }
}
async function ensureChildPinsSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS child_pins (
  child_id TEXT NOT NULL REFERENCES children(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('task', 'reward')),
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, item_type)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_child_pins_item ON child_pins(item_type, item_id)").run();
}
async function ensureIterationSchema(env) {
    await ensureColumn(env, "tasks", "enabled_weekdays", "enabled_weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]'");
    await ensureColumn(env, "rewards", "redeem_weekdays", "redeem_weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]'");
    await ensureColumn(env, "reward_redemptions", "hidden_from_child_at", "hidden_from_child_at TEXT");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reward_prerequisites (
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  required_count INTEGER NOT NULL DEFAULT 1 CHECK(required_count >= 1),
  PRIMARY KEY (reward_id, task_id)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_reward_prerequisites_reward ON reward_prerequisites(reward_id)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_redemptions_child_status ON reward_redemptions(child_id, status, requested_at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_child_task_status ON task_submissions(child_id, task_id, status)").run();
}
async function ensureRetentionSchema(env) {
    await ensureColumn(env, "point_ledger", "revoked_at", "revoked_at TEXT");
    await ensureColumn(env, "point_ledger", "revoke_ledger_id", "revoke_ledger_id TEXT REFERENCES point_ledger(id)");
    await ensureColumn(env, "point_ledger", "retention_until", "retention_until TEXT");
    await ensureColumn(env, "reward_redemptions", "refunded_at", "refunded_at TEXT");
    await ensureColumn(env, "reward_redemptions", "retention_until", "retention_until TEXT");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS activity_archives (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  month_key TEXT NOT NULL,
  net_points INTEGER NOT NULL DEFAULT 0,
  tasks_approved INTEGER NOT NULL DEFAULT 0,
  tasks_rejected INTEGER NOT NULL DEFAULT 0,
  rewards_requested INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  rewards_cancelled INTEGER NOT NULL DEFAULT 0,
  praise_count INTEGER NOT NULL DEFAULT 0,
  criticism_count INTEGER NOT NULL DEFAULT 0,
  achievements_unlocked INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, child_id, month_key)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_archives_child_month ON activity_archives(child_id, month_key)").run();
    await env.DB.prepare(`INSERT OR IGNORE INTO system_settings (key, value) VALUES
('detail_retention_days', '365'),
('short_record_retention_days', '7'),
('cleanup_last_run_at', '')`).run();
}
async function settingNumber(env, key, fallback) {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key=?").bind(key).first();
    const value = Number(row?.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
async function updateSetting(env, key, value) {
    await env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(key, String(value), nowIso())
        .run();
}
async function cleanupShortRetention(env, cutoffIso) {
    const refunded = (await env.DB.prepare("SELECT id FROM reward_redemptions WHERE refunded_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until<=?").bind(cutoffIso).all()).results.map((row) => row.id);
    for (const redemptionId of refunded) {
        await env.DB.prepare("DELETE FROM notifications WHERE related_type='reward_redemption' AND related_id=?").bind(redemptionId).run();
        await env.DB.prepare("DELETE FROM point_ledger WHERE source_id=? AND source_type IN ('reward','reward_refund')").bind(redemptionId).run();
        await env.DB.prepare("DELETE FROM reward_redemptions WHERE id=?").bind(redemptionId).run();
    }
    const recalled = (await env.DB.prepare("SELECT id, revoke_ledger_id FROM point_ledger WHERE revoked_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until<=?").bind(cutoffIso).all()).results;
    for (const row of recalled) {
        await env.DB.prepare("DELETE FROM notifications WHERE related_type='point_ledger' AND related_id IN (?, ?)").bind(row.id, row.revoke_ledger_id || "").run();
        await env.DB.prepare("DELETE FROM point_ledger WHERE id IN (?, ?)").bind(row.id, row.revoke_ledger_id || "").run();
    }
}
async function archiveOldActivity(env, cutoffIso) {
    const groups = (await env.DB.prepare(`SELECT child_id, parent_id, substr(created_at, 1, 7) month_key, COALESCE(SUM(amount), 0) net_points
FROM point_ledger
WHERE created_at<? AND source_type!='activity_archive'
GROUP BY child_id, parent_id, substr(created_at, 1, 7)`).bind(cutoffIso).all()).results;
    for (const group of groups) {
        const archiveId = `archive:${group.child_id}:${group.month_key}`;
        const monthStart = `${group.month_key}-01T00:00:00.000Z`;
        const monthEnd = new Date(Date.UTC(Number(group.month_key.slice(0, 4)), Number(group.month_key.slice(5, 7)), 1)).toISOString();
        const [tasksApproved, tasksRejected, rewardsRequested, rewardsRedeemed, rewardsCancelled, praiseCount, criticismCount, achievementsUnlocked] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) v FROM task_submissions WHERE child_id=? AND status='approved' AND submitted_at>=? AND submitted_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM task_submissions WHERE child_id=? AND status='rejected' AND submitted_at>=? AND submitted_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE child_id=? AND requested_at>=? AND requested_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE child_id=? AND status='redeemed' AND redeemed_at>=? AND redeemed_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE child_id=? AND status='cancelled' AND cancelled_at>=? AND cancelled_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE child_id=? AND source_type='praise' AND revoked_at IS NULL AND created_at>=? AND created_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM point_ledger WHERE child_id=? AND source_type='criticism' AND revoked_at IS NULL AND created_at>=? AND created_at<?").bind(group.child_id, monthStart, monthEnd).first(),
            env.DB.prepare("SELECT COUNT(*) v FROM child_achievements WHERE child_id=? AND unlocked_at>=? AND unlocked_at<?").bind(group.child_id, monthStart, monthEnd).first()
        ]);
        await env.DB.prepare(`INSERT OR IGNORE INTO activity_archives (
  id, parent_id, child_id, month_key, net_points, tasks_approved, tasks_rejected,
  rewards_requested, rewards_redeemed, rewards_cancelled, praise_count, criticism_count, achievements_unlocked, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(archiveId, group.parent_id, group.child_id, group.month_key, Number(group.net_points || 0), Number(tasksApproved?.v || 0), Number(tasksRejected?.v || 0), Number(rewardsRequested?.v || 0), Number(rewardsRedeemed?.v || 0), Number(rewardsCancelled?.v || 0), Number(praiseCount?.v || 0), Number(criticismCount?.v || 0), Number(achievementsUnlocked?.v || 0), nowIso())
            .run();
        const ledger = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='activity_archive' AND source_id=?").bind(archiveId).first();
        if (!ledger && Number(group.net_points || 0) !== 0) {
            await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'activity_archive', ?, ?, ?, ?)")
                .bind(id(), group.child_id, group.parent_id, Number(group.net_points || 0), archiveId, group.month_key, "月度历史汇总", monthEnd)
                .run();
        }
    }
    await env.DB.prepare("DELETE FROM point_ledger WHERE created_at<? AND source_type!='activity_archive'").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM task_submissions WHERE submitted_at<? AND status!='pending'").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM reward_redemptions WHERE requested_at<? AND status!='pending'").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM notifications WHERE created_at<? AND read_at IS NOT NULL").bind(cutoffIso).run();
}
async function hardDeleteSoftDeleted(env, cutoffIso) {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(nowIso()).run();
    await env.DB.prepare("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM reward_assignees WHERE reward_id IN (SELECT id FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM reward_prerequisites WHERE reward_id IN (SELECT id FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM achievements WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM feedback_templates WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
}
async function maybeRunMaintenance(env) {
    const last = await env.DB.prepare("SELECT value FROM system_settings WHERE key='cleanup_last_run_at'").first();
    const now = nowIso();
    if (last?.value && Date.parse(now) - Date.parse(last.value) < DAY_MS)
        return;
    const detailDays = await settingNumber(env, "detail_retention_days", 365);
    const shortDays = await settingNumber(env, "short_record_retention_days", 7);
    const detailCutoff = new Date(Date.now() - detailDays * DAY_MS).toISOString();
    const shortCutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
    await cleanupShortRetention(env, shortCutoff);
    await archiveOldActivity(env, detailCutoff);
    await hardDeleteSoftDeleted(env, detailCutoff);
    await updateSetting(env, "cleanup_last_run_at", now);
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
            await ensureChildPinsSchema(env);
            await ensureIterationSchema(env);
            await ensureRetentionSchema(env);
            await maybeRunMaintenance(env);
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
  redeem_weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,0]',
  icon_type TEXT NOT NULL DEFAULT 'emoji' CHECK(icon_type IN ('emoji', 'gallery_image')),
  icon_value TEXT NOT NULL DEFAULT '🎁',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare(`INSERT INTO rewards_new (
  id, parent_id, title, description, cost_points, stock, limit_period, limit_count, redeem_weekdays,
  icon_type, icon_value, is_active, deleted_at, created_at, updated_at
)
SELECT
  id, parent_id, title, description, cost_points, stock, limit_period, limit_count, '[1,2,3,4,5,6,0]',
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
  hidden_from_child_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("INSERT INTO reward_assignees SELECT * FROM reward_assignees_backup").run();
    await env.DB.prepare(`INSERT INTO reward_redemptions (
  id, reward_id, child_id, parent_id, period_key, requested_at, status, redeemed_at, cancelled_at, created_at
)
SELECT id, reward_id, child_id, parent_id, period_key, requested_at, status, redeemed_at, cancelled_at, created_at
FROM reward_redemptions_backup`).run();
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
async function replaceRewardPrerequisites(env, rewardId, prerequisites = []) {
    await env.DB.prepare("DELETE FROM reward_prerequisites WHERE reward_id=?").bind(rewardId).run();
    for (const item of prerequisites) {
        const taskId = String(item.taskId || item.task_id || "").trim();
        const requiredCount = Math.max(1, Number(item.requiredCount || item.required_count || 1));
        if (taskId) {
            await env.DB.prepare("INSERT OR REPLACE INTO reward_prerequisites (reward_id, task_id, required_count) VALUES (?, ?, ?)")
                .bind(rewardId, taskId, requiredCount)
                .run();
        }
    }
}
async function rewardPrerequisites(env, rewardId) {
    return (await env.DB.prepare(`SELECT rp.task_id, rp.required_count, t.title, t.period
FROM reward_prerequisites rp
JOIN tasks t ON t.id=rp.task_id
WHERE rp.reward_id=?
ORDER BY t.created_at DESC`).bind(rewardId).all()).results;
}
async function completedTaskCount(env, childId, taskId, periodKeyValue = null) {
    const periodClause = periodKeyValue ? " AND period_key=?" : "";
    const params = periodKeyValue ? [childId, taskId, periodKeyValue] : [childId, taskId];
    const row = await env.DB.prepare(`SELECT COUNT(*) v FROM task_submissions WHERE child_id=? AND task_id=? AND status='approved'${periodClause}`)
        .bind(...params)
        .first();
    return Number(row?.v || 0);
}
async function unmetRewardPrerequisites(env, rewardId, childId, at = nowIso()) {
    const rows = await rewardPrerequisites(env, rewardId);
    const offset = await timezoneOffsetMinutes(env);
    const unmet = [];
    for (const row of rows) {
        const taskPeriod = row.period || "once";
        const pkey = prerequisitePeriodKey(taskPeriod, at, offset);
        const completed = await completedTaskCount(env, childId, row.task_id, pkey);
        if (completed < Number(row.required_count || 1)) {
            unmet.push({ ...row, completed });
        }
    }
    return unmet;
}
async function rewardLockedByAchievement(env, rewardId, childId) {
    const rows = (await env.DB.prepare(`SELECT a.id, ca.unlocked_at
FROM achievements a
LEFT JOIN child_achievements ca ON ca.achievement_id=a.id AND ca.child_id=?
WHERE a.unlock_reward_id=? AND a.is_active=1 AND a.deleted_at IS NULL`)
        .bind(childId, rewardId)
        .all()).results;
    return rows.length > 0 && rows.every((row) => !row.unlocked_at);
}
async function replaceRewardAchievementRequirement(env, parentId, rewardId, achievementId) {
    const requiredAchievementId = String(achievementId || "").trim();
    let achievement = null;
    if (requiredAchievementId) {
        achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(requiredAchievementId, parentId)
            .first();
        if (!achievement)
            return false;
    }
    const now = nowIso();
    await env.DB.prepare("UPDATE achievements SET unlock_reward_id=NULL, updated_at=? WHERE parent_id=? AND unlock_reward_id=? AND deleted_at IS NULL")
        .bind(now, parentId, rewardId)
        .run();
    if (achievement) {
        await env.DB.prepare("UPDATE achievements SET unlock_reward_id=?, updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(rewardId, now, achievement.id, parentId)
            .run();
    }
    return true;
}
async function deleteAchievementWithExclusiveReward(env, parentId, achievementId) {
    const achievement = await env.DB.prepare("SELECT id, unlock_reward_id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
        .bind(achievementId, parentId)
        .first();
    if (!achievement)
        return null;
    const now = nowIso();
    await env.DB.prepare("UPDATE achievements SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
        .bind(now, now, achievement.id)
        .run();
    await env.DB.prepare("DELETE FROM child_achievements WHERE achievement_id=?").bind(achievement.id).run();
    const disabledUnlockRewardIds = [];
    if (achievement.unlock_reward_id) {
        await env.DB.prepare("UPDATE rewards SET is_active=0, updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(now, achievement.unlock_reward_id, parentId)
            .run();
        disabledUnlockRewardIds.push(achievement.unlock_reward_id);
    }
    return { deletedUnlockReward: false, disabledUnlockRewardIds };
}
const ACHIEVEMENT_RULE_TYPES = new Set([
    "tasks_completed",
    "total_earned",
    "balance",
    "streak_days",
    "redemptions",
    "specific_task_completed",
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
    const targetTaskId = ruleType === "same_task_streak" || ruleType === "specific_task_completed" ? String(input.targetTaskId || input.target_task_id || "") || null : null;
    const targetCategoryId = ruleType === "category_tasks" || ruleType === "category_streak" ? String(input.targetCategoryId || input.target_category_id || "") || null : null;
    const metric = ["same_task_streak", "specific_task_completed", "category_tasks", "category_streak"].includes(ruleType) ? "tasks_completed"
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
    const feedbackLedger = (await env.DB.prepare("SELECT source_type, created_at FROM point_ledger WHERE child_id=? AND source_type IN ('praise', 'criticism') AND revoked_at IS NULL").bind(childId).all()).results;
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
        else if (normalized.rule_type === "specific_task_completed") {
            const rows = normalized.target_task_id ? approvedTasks.filter((row) => row.task_id === normalized.target_task_id) : approvedTasks;
            value = countRowsInWindow(rows, "submitted_at", normalized, offset, now);
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
            const already = await env.DB.prepare("SELECT 1 FROM child_achievements WHERE child_id=? AND achievement_id=?")
                .bind(childId, achievement.id)
                .first();
            await env.DB.prepare("INSERT OR IGNORE INTO child_achievements (child_id, achievement_id, unlocked_at) VALUES (?, ?, ?)")
                .bind(childId, achievement.id, nowIso())
                .run();
            if (!already && achievement.unlock_reward_id) {
                await notify(env, {
                    recipientType: "child",
                    recipientId: childId,
                    actorType: "system",
                    actorId: null,
                    title: "奖励资格已解锁",
                    body: "你解锁了新的奖励兑换资格。",
                    eventType: "achievement_reward",
                    relatedType: "reward",
                    relatedId: achievement.unlock_reward_id
                });
            }
        }
    }
}
async function listWithAssignees(env, kind, parentId) {
    const rows = await env.DB.prepare(`SELECT * FROM ${kind} WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC`).bind(parentId).all();
    const table = kind === "tasks" ? "task_assignees" : "reward_assignees";
    const key = kind === "tasks" ? "task_id" : "reward_id";
    return Promise.all(rows.results.map(async (row) => {
        const requiredAchievement = kind === "rewards"
            ? await env.DB.prepare("SELECT id, title FROM achievements WHERE parent_id=? AND unlock_reward_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC LIMIT 1").bind(parentId, row.id).first()
            : null;
        return {
            ...row,
            enabledWeekdays: normalizeWeekdays(row.enabled_weekdays),
            redeemWeekdays: normalizeWeekdays(row.redeem_weekdays),
            prerequisites: kind === "rewards" ? await rewardPrerequisites(env, row.id) : [],
            requiredAchievementId: requiredAchievement?.id || "",
            requiredAchievementTitle: requiredAchievement?.title || "",
            assignees: (await env.DB.prepare(`SELECT child_id FROM ${table} WHERE ${key}=?`).bind(row.id).all()).results.map((x) => x.child_id)
        };
    }));
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
    await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active) VALUES (?, ?, ?, ?, ?, ?, 'earn', ?, ?, ?, ?, ?, ?)")
        .bind(taskId, parentId, categoryId, title, item.description || "", period, Number(item.points || 0), item.icon_type || "emoji", item.icon_value || "✅", Math.max(1, Number(item.limit_count || item.limitCount || 1)), weekdayJson(item.enabledWeekdays || item.enabled_weekdays), importedActive(item))
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
    const pendingRewardRequirements = [];
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
        await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, redeem_weekdays, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(rewardId, parentId, title, item.description || "", Number(item.cost_points ?? item.costPoints ?? 0), item.stock ?? null, item.limit_period || item.limitPeriod || "daily", (item.limit_period || item.limitPeriod) === "once" ? 1 : item.limit_count ?? item.limitCount ?? 1, weekdayJson(item.redeemWeekdays || item.redeem_weekdays), item.icon_type || "emoji", item.icon_value || "🎁", importedActive(item))
            .run();
        await replaceAssignees(env, "reward_assignees", "reward_id", rewardId, (item.assignee_names || []).map((name) => childMap.get(name)).filter(Boolean));
        await replaceRewardPrerequisites(env, rewardId, item.prerequisites || []);
        if (item.required_achievement_title || item.requiredAchievementTitle)
            pendingRewardRequirements.push({ rewardId, achievementTitle: item.required_achievement_title || item.requiredAchievementTitle });
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
  rule_type, window_type, window_start, window_end, target_task_id, target_category_id, unlock_reward_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id(), parentId, title, item.description || "", rule.metric, rule.threshold, item.icon_type || "emoji", item.icon_value || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, null)
            .run();
        stats.achievements.created += 1;
    }
    for (const requirement of pendingRewardRequirements) {
        const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE parent_id=? AND title=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
            .bind(parentId, requirement.achievementTitle)
            .first();
        if (achievement)
            await replaceRewardAchievementRequirement(env, parentId, requirement.rewardId, achievement.id);
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
    await env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, title, body, event_type, related_type, related_id, requires_ack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id(), input.recipientType, input.recipientId, input.actorType, input.actorId || null, input.title, input.body || "", input.eventType, input.relatedType || null, input.relatedId || null, input.requiresAck ? 1 : 0, nowIso())
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
        reward_refund: "奖励退还",
        achievement_reward: "成就奖励",
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
    if (item.related_type === "reward") {
        const row = await env.DB.prepare("SELECT title FROM rewards WHERE id=?").bind(item.related_id).first();
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
async function ledgerSource(env, row) {
    if (row.source_type === "task") {
        const found = await env.DB.prepare("SELECT t.title FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=?").bind(row.source_id).first();
        if (found?.title)
            return { sourceTypeLabel: "任务", sourceLabel: `任务：${found.title}` };
    }
    if (["reward", "reward_cancel", "reward_refund"].includes(row.source_type)) {
        const found = await env.DB.prepare("SELECT r.title FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=?").bind(row.source_id).first();
        if (found?.title)
            return { sourceTypeLabel: row.source_type === "reward" ? "奖励兑换" : "奖励退还", sourceLabel: `奖励：${found.title}` };
    }
    if (row.source_type === "praise" || row.source_type === "criticism") {
        const found = await env.DB.prepare("SELECT title FROM feedback_templates WHERE id=?").bind(row.source_id).first();
        const label = row.source_type === "praise" ? "表扬" : "批评";
        if (found?.title)
            return { sourceTypeLabel: label, sourceLabel: `${label}：${found.title}` };
        return { sourceTypeLabel: label, sourceLabel: label };
    }
    const fallback = eventTypeLabel(row.source_type);
    return { sourceTypeLabel: fallback, sourceLabel: fallback };
}
async function withLedgerSources(env, rows, offset) {
    return Promise.all(rows.map(async (row) => ({ ...row, localCreatedAt: localTimeText(row.created_at, offset), ...(await ledgerSource(env, row)) })));
}
function aiConfigHash(config) {
    const hash = ["sha256", config.baseUrl || "", config.model || "", config.prompt || ""].join("|");
    const chars = [];
    let h = 0;
    for (let i = 0; i < hash.length; i++) {
        h = ((h << 5) - h) + hash.charCodeAt(i);
        h |= 0;
        chars.push((h >>> 0).toString(36).slice(-2));
    }
    return chars.slice(0, 8).join("");
}
async function previousWeekReportSummary(env, childId, offset) {
    const now = nowIso();
    const range = reportWindowRange("weekly", now, offset);
    const weekStart = new Date(new Date(range.start).getTime() - 7 * DAY_MS).toISOString();
    const weekEnd = range.start;
    const pkey = periodKey("weekly", weekEnd, offset);
    const [taskRows, rewardRows, ledgerRows, feedbackRows, achievementRows] = await Promise.all([
        env.DB.prepare(`SELECT s.*, t.title, t.points, t.point_type
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
WHERE s.child_id=? AND s.submitted_at>=? AND s.submitted_at<? AND s.status='approved'`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.requested_at>=? AND rr.requested_at<? AND rr.status='redeemed'`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND created_at>=? AND created_at<? ORDER BY created_at")
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<?`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<?`)
            .bind(childId, weekStart, weekEnd).all()
    ]);
    return {
        pkey,
        tasks: taskRows.results,
        rewards: rewardRows.results,
        ledger: ledgerRows.results,
        feedback: feedbackRows.results,
        achievements: achievementRows.results
    };
}
function buildAiPrompt(child, report, config, assignments) {
    if (!report)
        return "";
    const approved = report.tasks.filter((t) => t.status === "approved").length;
    const rejected = report.tasks.filter((t) => t.status === "rejected").length;
    const taskNames = [...new Set(report.tasks.filter((t) => t.status === "approved").map((t) => t.title))];
    const praiseCount = report.feedback.filter((f) => f.source_type === "praise").length;
    const criticismCount = report.feedback.filter((f) => f.source_type === "criticism").length;
    const netPoints = report.ledger.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const achievementTitles = report.achievements.map((a) => a.title);
    const age = child.birth_date ? Math.floor((Date.now() - new Date(child.birth_date).getTime()) / 31557600000) : null;
    const genderLabel = child.gender === "male" ? "男" : child.gender === "female" ? "女" : "";
    const parts = [`孩子姓名：${child.display_name}`];
    if (genderLabel)
        parts.push(`性别：${genderLabel}`);
    if (age !== null && Number.isFinite(age))
        parts.push(`年龄：${age}岁`);
    parts.push(`上周完成任务：${approved}项（${taskNames.join("、") || "无"}）`);
    parts.push(`上周未通过任务：${rejected}项`);
    parts.push(`上周获得表扬：${praiseCount}次`);
    parts.push(`上周被批评：${criticismCount}次`);
    parts.push(`上周净增积分：${netPoints >= 0 ? "+" : ""}${netPoints}`);
    if (achievementTitles.length)
        parts.push(`上周解锁成就：${achievementTitles.join("、")}`);
    if ((assignments?.tasks || []).length) {
        parts.push("任务配置：");
        for (const t of assignments.tasks)
            parts.push(`- ${t.title}（分类：${t.category_name || "未分类"}，周期：${t.period || "每日"}，次数：${t.limit_count || 1}，积分：${t.points || 0}，周：${normalizeWeekdays(t.enabled_weekdays).join(",")}，状态：${t.is_active ? "启用" : "停用"}${t.description ? "，说明：" + t.description : ""}）`);
    }
    if ((assignments?.rewards || []).length) {
        parts.push("奖励配置：");
        for (const r of assignments.rewards)
            parts.push(`- ${r.title}（${r.cost_points || 0}积分，周期：${r.limit_period || "每日"}，次数：${r.limit_count || ""}，核销周几：${normalizeWeekdays(r.redeem_weekdays).join(",")}，状态：${r.is_active ? "启用" : "停用"}${r.description ? "，说明：" + r.description : ""}）`);
    }
    if ((assignments?.feedbackTemplates || []).length) {
        parts.push("表扬与批评条款：");
        for (const f of assignments.feedbackTemplates)
            parts.push(`- [${f.kind === "praise" ? "表扬" : "批评"}] ${f.title}（${f.points >= 0 ? "+" : ""}${f.points || 0}分，状态：${f.is_active ? "启用" : "停用"}${f.description ? "，说明：" + f.description : ""}）`);
    }
    return `${config.prompt || ""}\n\n周报数据：\n${parts.join("\n")}`;
}
async function callAiService(env, prompt) {
    const baseUrl = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_base_url'").first())?.value || "";
    const apiKey = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_api_key'").first())?.value || "";
    const model = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_model'").first())?.value || "";
    if (!baseUrl || !apiKey || !model)
        return "";
    try {
        const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 300 })
        });
        if (!resp.ok)
            return "";
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || "";
        const cleaned = text.replace(/\s+/g, " ").trim().replace(/，+/g, "，").replace(/。+/g, "。");
        return cleaned;
    }
    catch {
        return "";
    }
}
async function generateAiGreeting(env, child, offset, forceRefresh = false) {
    if (!child.ai_enabled)
        return "";
    const baseUrl = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_base_url'").first())?.value || "";
    const apiKey = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_api_key'").first())?.value || "";
    const model = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_model'").first())?.value || "";
    const prompt = (await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_prompt'").first())?.value || "";
    if (!baseUrl || !apiKey || !model || !prompt)
        return "";
    const config = { baseUrl, model, prompt };
    const hash = aiConfigHash(config);
    const now = nowIso();
    const range = reportWindowRange("weekly", now, offset);
    const weekKey = periodKey("weekly", range.start, offset);
    const cached = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? AND previous_week_key=? AND config_hash=?")
        .bind(child.id, weekKey, hash)
        .first();
    if (cached?.greeting && !forceRefresh)
        return cached.greeting;
    const report = await previousWeekReportSummary(env, child.id, offset);
    const [assignedTasks, assignedRewards, feedbackTemplates] = await Promise.all([
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id).all(),
        env.DB.prepare("SELECT kind, title, points, is_active, description FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(child.parent_id).all()
    ]);
    const assignments = { tasks: assignedTasks.results, rewards: assignedRewards.results, feedbackTemplates: feedbackTemplates.results };
    const aiPrompt = buildAiPrompt(child, report, config, assignments);
    if (!aiPrompt)
        return "";
    const greeting = await callAiService(env, aiPrompt);
    if (greeting) {
        await env.DB.prepare("INSERT OR REPLACE INTO ai_child_greetings (child_id, previous_week_key, config_hash, greeting, generated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(child.id, weekKey, hash, greeting, now)
            .run();
    }
    return greeting;
}
async function route(request, env, ctx) {
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
    if (path === "/admin/profile" && method === "PATCH") {
        const a = requireRole(actor, ["admin"]);
        const input = await body(request);
        const currentPassword = String(input.currentPassword || "");
        if (!currentPassword)
            return fail("BAD_REQUEST", "请输入当前密码");
        const admin = await env.DB.prepare("SELECT * FROM users WHERE id=? AND role='admin' AND status='active' AND deleted_at IS NULL").bind(a.id).first();
        if (!admin)
            return fail("NOT_FOUND", "管理员账号不存在", 404);
        if (!(await verifyPassword(currentPassword, admin.password_hash)))
            return fail("BAD_CREDENTIALS", "当前密码不正确", 401);
        const username = String(input.username || "").trim();
        if (!username)
            return fail("BAD_REQUEST", "请输入账号");
        if (await usernameExists(env, username, `user:${admin.id}`))
            return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
        const displayName = String(input.displayName || "").trim() || username;
        const newPassword = String(input.newPassword || "");
        const passwordHash = newPassword ? await hashPassword(newPassword) : admin.password_hash;
        await env.DB.prepare("UPDATE users SET username=?, display_name=?, password_hash=?, updated_at=? WHERE id=? AND role='admin'")
            .bind(username, displayName, passwordHash, nowIso(), admin.id)
            .run();
        return ok({ id: admin.id, username, displayName, role: "admin" });
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
    if (path === "/admin/ai-service" && method === "GET") {
        requireRole(actor, ["admin"]);
        const baseUrl = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_base_url'").first();
        const model = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_model'").first();
        const prompt = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_prompt'").first();
        const hasKey = await env.DB.prepare("SELECT 1 FROM system_settings WHERE key='ai_api_key' AND value!=''").first();
        return ok({
            baseUrl: baseUrl?.value || "",
            model: model?.value || "",
            prompt: prompt?.value || "你是一位温暖、具体、不过度夸张的家庭成长教练。请根据孩子上一周的周报数据，并结合孩子的年龄与性别信息，写一段给孩子看的中文寄语：先肯定一个具体进步，再给一个可执行的小建议。语气亲切、有鼓励感，不说教，不提数据库或系统。总长度控制在120个汉字以内。",
            hasKey: !!hasKey
        });
    }
    if (path === "/admin/ai-service" && method === "PATCH") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        const now = nowIso();
        if (input.baseUrl !== undefined) {
            await updateSetting(env, "ai_base_url", String(input.baseUrl));
        }
        if (input.apiKey !== undefined && String(input.apiKey).trim()) {
            await updateSetting(env, "ai_api_key", String(input.apiKey));
        }
        if (input.model !== undefined) {
            await updateSetting(env, "ai_model", String(input.model));
        }
        if (input.prompt !== undefined) {
            await updateSetting(env, "ai_prompt", String(input.prompt));
        }
        return ok(true);
    }
    if (path === "/admin/ai-service/refresh-greetings" && method === "POST") {
        requireRole(actor, ["admin"]);
        const offset = DEFAULT_TIMEZONE_OFFSET_MINUTES;
        const result = await batchRefreshGreetings(env, offset);
        return ok(result);
    }
    if (path === "/admin/ai-service/models" && method === "POST") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        const baseUrl = String(input.baseUrl || "").replace(/\/+$/, "");
        if (!baseUrl)
            return fail("BAD_REQUEST", "请先设置 baseUrl");
        const apiKey = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_api_key'").first();
        const key = String(input.apiKey && String(input.apiKey).trim() ? input.apiKey : apiKey?.value || "");
        const headers = { "content-type": "application/json" };
        if (key)
            headers["authorization"] = `Bearer ${key}`;
        try {
            const resp = await fetch(`${baseUrl}/models`, { headers });
            if (!resp.ok)
                return fail("AI_SERVICE_ERROR", `获取模型列表失败：${resp.status}`, 502);
            const body = await resp.json();
            const models = (body.data || []).map((item) => item.id);
            return ok({ models });
        }
        catch (err) {
            return fail("AI_SERVICE_ERROR", `无法连接 AI 服务：${err instanceof Error ? err.message : "未知错误"}`, 502);
        }
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
        const rows = (await env.DB.prepare("SELECT * FROM notifications WHERE recipient_type=? AND recipient_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 50")
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
            return ok((await env.DB.prepare("SELECT id, username, display_name, status, ai_enabled, gender, birth_date FROM children WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const username = String(input.username || "").trim();
            if (!username)
                return fail("BAD_REQUEST", "请输入账号");
            if (await usernameExists(env, username))
                return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
            await env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, ai_enabled, gender, birth_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), a.id, username, await hashPassword(input.password || "123456"), input.displayName || username, input.aiEnabled ? 1 : 0, input.gender || "", input.birthDate || null)
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
        const updates = [];
        const params = [];
        if (input.displayName !== undefined) {
            updates.push("display_name=?");
            params.push(input.displayName);
        }
        if (input.password) {
            updates.push("password_hash=?");
            params.push(await hashPassword(input.password));
        }
        if (input.status !== undefined) {
            updates.push("status=?");
            params.push(input.status);
        }
        if (input.aiEnabled !== undefined) {
            updates.push("ai_enabled=?");
            params.push(input.aiEnabled ? 1 : 0);
        }
        if (input.gender !== undefined) {
            if (input.gender && !["male", "female"].includes(input.gender))
                return fail("BAD_REQUEST", "性别取值须为 male、female 或空", 400);
            updates.push("gender=?");
            params.push(input.gender || "");
        }
        if (input.birthDate !== undefined) {
            if (input.birthDate) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.birthDate)))
                    return fail("BAD_REQUEST", "出生日期格式须为 YYYY-MM-DD", 400);
                if (String(input.birthDate) > nowIso().slice(0, 10))
                    return fail("BAD_REQUEST", "出生日期不能晚于今天", 400);
            }
            updates.push("birth_date=?");
            params.push(input.birthDate || null);
        }
        if (updates.length) {
            params.push(nowIso(), childPatch[1]);
            await env.DB.prepare(`UPDATE children SET ${updates.join(", ")}, updated_at=? WHERE id=?`).bind(...params).run();
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
    const childExport = path.match(/^\/children\/([^/]+)\/export-print$/);
    if (childExport && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childExport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const [tasks, rewards, feedbackTemplates] = await Promise.all([
            env.DB.prepare(`SELECT t.*, tc.name category_name FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare(`SELECT r.* FROM rewards r
JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(a.id).all()
        ]);
        const table = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} 打印清单</title><style>body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2933}h1{margin:0 0 8px}h2{margin-top:28px;border-bottom:2px solid #111;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top}th{background:#f0f0f0}@media print{button{display:none}body{margin:12mm}}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} 打印清单</h1><p>导出时间：${escapeHtml(localTimeText(nowIso(), await timezoneOffsetMinutes(env)))}</p><h2>任务</h2>${table(["标题","分类","周期","次数","积分","周","状态","说明"], tasks.results.map((item) => [item.title, item.category_name || "", item.period, item.limit_count || 1, item.points, normalizeWeekdays(item.enabled_weekdays).join(","), item.is_active ? "启用" : "停用", item.description || ""]))}<h2>奖励</h2>${table(["名称","所需积分","限制周期","次数","核销周几","状态","说明"], rewards.results.map((item) => [item.title, item.cost_points, item.limit_period, item.limit_count || "", normalizeWeekdays(item.redeem_weekdays).join(","), item.is_active ? "启用" : "停用", item.description || ""]))}<h2>表扬与批评条款</h2>${table(["类型","标题","积分","状态","说明"], feedbackTemplates.results.map((item) => [item.kind === "praise" ? "表扬" : "批评", item.title, item.points, item.is_active ? "启用" : "停用", item.description || ""]))}</body></html>`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childAiGreeting = path.match(/^\/children\/([^/]+)\/ai-greeting$/);
    if (childAiGreeting && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childAiGreeting[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const greeting = await generateAiGreeting(env, child, DEFAULT_TIMEZONE_OFFSET_MINUTES, true);
        return ok({ greeting });
    }
    const childReport = path.match(/^\/children\/([^/]+)\/report$/);
    if (childReport && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childReport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const offset = await timezoneOffsetMinutes(env);
        const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
        const anchor = url.searchParams.get("anchor") || nowIso();
        const range = reportWindowRange(period, anchor, offset);
        const [ledgerRows, taskRows, rewardRows, feedbackRows, achievementRows] = await Promise.all([
            env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND parent_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC").bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT s.*, t.title, tc.name category_name
FROM task_submissions s
JOIN tasks t ON t.id=s.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE s.child_id=? AND s.parent_id=? AND s.submitted_at>=? AND s.submitted_at<?
ORDER BY s.submitted_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr
JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.requested_at>=? AND rr.requested_at<?
ORDER BY rr.requested_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<?
ORDER BY pl.created_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca
JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND a.parent_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<?
ORDER BY ca.unlocked_at DESC`).bind(child.id, a.id, range.start, range.end).all()
        ]);
        const ledger = ledgerRows.results;
        const tasks = taskRows.results;
        const rewards = rewardRows.results;
        const feedback = feedbackRows.results;
        const achievements = achievementRows.results;
        const netPoints = ledger.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const currentBalance = await balance(env, child.id);
        const approved = tasks.filter((row) => row.status === "approved").length;
        const rejected = tasks.filter((row) => row.status === "rejected").length;
        const pending = tasks.filter((row) => row.status === "pending").length;
        const categoryCounts = [...tasks.filter((row) => row.status === "approved").reduce((map, row) => map.set(row.category_name || "未分类", (map.get(row.category_name || "未分类") || 0) + 1), new Map()).entries()];
        const tableHtml = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table>`;
        const reportTitle = period === "monthly" ? "月度报告" : "周度报告";
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} ${reportTitle}</title><style>body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2933}button{margin-bottom:16px}h1{margin:0 0 8px}h2{margin-top:28px;border-bottom:2px solid #111;padding-bottom:6px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.summary div{border:1px solid #999;padding:10px}.summary strong{display:block;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top}th{background:#f0f0f0}@media print{button{display:none}body{margin:12mm}.summary{grid-template-columns:repeat(2,1fr)}}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} ${reportTitle}</h1><p>周期：${escapeHtml(localTimeText(range.start, offset))} 至 ${escapeHtml(localTimeText(range.end, offset))}；生成时间：${escapeHtml(localTimeText(nowIso(), offset))}</p><div class="summary"><div><span>当前积分</span><strong>${currentBalance}</strong></div><div><span>本期积分</span><strong>${netPoints >= 0 ? "+" : ""}${netPoints}</strong></div><div><span>任务通过</span><strong>${approved}</strong></div><div><span>成就解锁</span><strong>${achievements.length}</strong></div></div><h2>任务概览</h2>${tableHtml(["通过","待审","驳回"], [[approved, pending, rejected]])}<h2>分类完成</h2>${tableHtml(["分类","通过次数"], categoryCounts)}<h2>奖励记录</h2>${tableHtml(["奖励","状态","积分","申请时间"], rewards.map((item) => [item.title, item.status, item.cost_points, localTimeText(item.requested_at, offset)]))}<h2>表扬与批评</h2>${tableHtml(["类型","条款","积分","时间"], feedback.map((item) => [item.source_type === "praise" ? "表扬" : "批评", item.template_title || item.note || "", item.amount, localTimeText(item.created_at, offset)]))}<h2>成就解锁</h2>${tableHtml(["成就","解锁时间"], achievements.map((item) => [item.title, localTimeText(item.unlocked_at, offset)]))}</body></html>`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childWarehouse = path.match(/^\/children\/([^/]+)\/warehouse$/);
    if (childWarehouse && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(childWarehouse[1], a.id).first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        return ok((await env.DB.prepare(`SELECT rr.*, r.title, r.description, r.icon_type, r.icon_value, r.cost_points, r.redeem_weekdays
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.status='redeemed'
ORDER BY rr.requested_at DESC`).bind(child.id, a.id).all()).results);
    }
    const feedbackEvent = path.match(/^\/children\/([^/]+)\/feedback-events$/);
    if (feedbackEvent && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(feedbackEvent[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const cutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
        const rows = (await env.DB.prepare(`SELECT pl.*, ft.title template_title, ft.kind template_kind
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.created_at>=?
ORDER BY pl.created_at DESC`)
            .bind(child.id, a.id, cutoff)
            .all()).results;
        const offset = await timezoneOffsetMinutes(env);
        return ok(rows.map((row) => ({ ...row, localCreatedAt: localTimeText(row.created_at, offset) })));
    }
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
            relatedId: ledgerId,
            requiresAck: true
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
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, a.id, input.categoryId, input.title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1)
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
        await env.DB.prepare("UPDATE tasks SET category_id=?, title=?, description=?, period=?, point_type=?, points=?, icon_type=?, icon_value=?, limit_count=?, enabled_weekdays=?, is_active=?, updated_at=? WHERE id=?")
            .bind(input.categoryId, input.title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1, nowIso(), taskPatch[1])
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
            const requiredAchievementId = input.requiredAchievementId || input.required_achievement_id || "";
            if (requiredAchievementId) {
                const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
                    .bind(requiredAchievementId, a.id)
                    .first();
                if (!achievement)
                    return fail("NOT_FOUND", "成就称号不存在", 404);
            }
            await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, redeem_weekdays, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(rewardId, a.id, input.title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, weekdayJson(input.redeemWeekdays || input.redeem_weekdays), input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1)
                .run();
            await replaceAssignees(env, "reward_assignees", "reward_id", rewardId, input.childIds || []);
            await replaceRewardPrerequisites(env, rewardId, input.prerequisites || []);
            await replaceRewardAchievementRequirement(env, a.id, rewardId, requiredAchievementId);
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
        const requiredAchievementId = input.requiredAchievementId || input.required_achievement_id || "";
        if (!(await replaceRewardAchievementRequirement(env, a.id, rewardPatch[1], requiredAchievementId)))
            return fail("NOT_FOUND", "成就称号不存在", 404);
        await env.DB.prepare("UPDATE rewards SET title=?, description=?, cost_points=?, stock=?, limit_period=?, limit_count=?, redeem_weekdays=?, icon_type=?, icon_value=?, is_active=?, updated_at=? WHERE id=?")
            .bind(input.title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, weekdayJson(input.redeemWeekdays || input.redeem_weekdays), input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1, nowIso(), rewardPatch[1])
            .run();
        await replaceAssignees(env, "reward_assignees", "reward_id", rewardPatch[1], input.childIds || []);
        await replaceRewardPrerequisites(env, rewardPatch[1], input.prerequisites || []);
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
  rule_type, window_type, window_start, window_end, target_task_id, target_category_id, unlock_reward_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(id(), a.id, input.title, input.description || "", rule.metric, rule.threshold, input.iconType || "emoji", input.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, null)
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
        const result = await deleteAchievementWithExclusiveReward(env, a.id, achievementPatch[1]);
        if (!result)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        return ok(result);
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
                enabled_weekdays: item.enabled_weekdays,
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
                redeem_weekdays: item.redeem_weekdays,
                prerequisites: item.prerequisites,
                required_achievement_title: item.requiredAchievementTitle,
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
        if (!isWeekdayAllowed(task.enabled_weekdays, submittedAt, offset))
            return fail("TASK_NOT_ENABLED_TODAY", "该任务今天未启用", 409);
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
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type='user' AND recipient_id=? AND related_type='task_submission' AND related_id=? AND read_at IS NULL")
            .bind(nowIso(), a.id, sub.id)
            .run();
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
        if (await rewardLockedByAchievement(env, reward.id, a.id))
            return fail("REWARD_LOCKED", "该奖励需要先解锁对应成就称号", 409);
        if (reward.stock !== null) {
            const used = Number((await env.DB.prepare("SELECT COUNT(*) v FROM reward_redemptions WHERE reward_id=? AND status IN ('pending','redeemed')").bind(reward.id).first())?.v || 0);
            if (used >= Number(reward.stock))
                return fail("OUT_OF_STOCK", "奖励库存不足", 409);
        }
        const requestedAt = nowIso();
        const offset = await timezoneOffsetMinutes(env);
        const pkey = periodKey(reward.limit_period, requestedAt, offset);
        const unmet = await unmetRewardPrerequisites(env, reward.id, a.id, requestedAt);
        if (unmet.length)
            return fail("PREREQUISITE_NOT_MET", `前置任务未完成：${unmet.map((item) => `${item.title} ${item.completed}/${item.required_count}`).join("；")}`, 409);
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
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points, r.redeem_weekdays FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='pending'")
            .bind(redemptionAction[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "待处理兑换不存在", 404);
        if (redemptionAction[2] === "redeem") {
            const offset = await timezoneOffsetMinutes(env);
            if (!isWeekdayAllowed(redemption.redeem_weekdays, undefined, offset))
                return fail("REDEEM_WEEKDAY_BLOCKED", "今天不是该奖励允许核销的周几", 409);
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
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type='user' AND recipient_id=? AND related_type='reward_redemption' AND related_id=? AND read_at IS NULL")
            .bind(nowIso(), a.id, redemption.id)
            .run();
        return ok(true);
    }
    const feedbackRecall = path.match(/^\/feedback-events\/([^/]+)\/recall$/);
    if (feedbackRecall && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const row = await env.DB.prepare(`SELECT pl.*, c.id child_id
FROM point_ledger pl
JOIN children c ON c.id=pl.child_id
WHERE pl.id=? AND pl.parent_id=? AND c.parent_id=? AND pl.source_type IN ('praise','criticism')`)
            .bind(feedbackRecall[1], a.id, a.id)
            .first();
        if (!row)
            return fail("NOT_FOUND", "表扬或批评记录不存在", 404);
        if (row.revoked_at)
            return fail("ALREADY_RECALLED", "该记录已经撤回", 409);
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const cutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
        if (row.created_at < cutoff)
            return fail("RECALL_EXPIRED", "只能撤回7天内的表扬或批评", 409);
        const now = nowIso();
        const retentionUntil = new Date(Date.now() + shortDays * DAY_MS).toISOString();
        const recallId = id();
        const label = row.source_type === "praise" ? "表扬" : "批评";
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until) VALUES (?, ?, ?, ?, 'feedback_recall', ?, NULL, ?, ?)")
            .bind(recallId, row.child_id, a.id, -Number(row.amount || 0), row.id, `${label}撤回冲正`, retentionUntil)
            .run();
        await env.DB.prepare("UPDATE point_ledger SET revoked_at=?, revoke_ledger_id=?, retention_until=? WHERE id=?")
            .bind(now, recallId, retentionUntil, row.id)
            .run();
        await env.DB.prepare("UPDATE notifications SET title=?, body=?, read_at=COALESCE(read_at, ?) WHERE related_type='point_ledger' AND related_id=?")
            .bind(`${label}已撤回`, "家长已撤回这条反馈，积分已恢复。", now, row.id)
            .run();
        await recalcAchievements(env, a.id, row.child_id);
        return ok(true);
    }
    const redemptionRefundWithRetention = path.match(/^\/reward-redemptions\/([^/]+)\/refund$/);
    if (redemptionRefundWithRetention && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='redeemed'")
            .bind(redemptionRefundWithRetention[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "可退还的奖励兑换不存在", 404);
        const refunded = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='reward_refund' AND source_id=?").bind(redemption.id).first();
        if (refunded)
            return fail("ALREADY_REFUNDED", "该奖励已经退还过积分", 409);
        const now = nowIso();
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const retentionUntil = new Date(Date.now() + shortDays * DAY_MS).toISOString();
        await env.DB.prepare("UPDATE reward_redemptions SET status='cancelled', cancelled_at=?, refunded_at=?, retention_until=? WHERE id=?")
            .bind(now, now, retentionUntil, redemption.id)
            .run();
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, retention_until) VALUES (?, ?, ?, ?, 'reward_refund', ?, ?, ?, ?)")
            .bind(id(), redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "奖励退还积分", retentionUntil)
            .run();
        await recalcAchievements(env, a.id, redemption.child_id);
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: "user",
            actorId: a.id,
            title: "奖励已退还积分",
            body: "家长已退还该奖励兑换的积分。",
            eventType: "reward_refund",
            relatedType: "reward_redemption",
            relatedId: redemption.id
        });
        return ok(true);
    }
    const redemptionRefund = path.match(/^\/reward-redemptions\/([^/]+)\/refund$/);
    if (redemptionRefund && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='redeemed'")
            .bind(redemptionRefund[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "可退还的奖励兑换不存在", 404);
        const refunded = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='reward_refund' AND source_id=?").bind(redemption.id).first();
        if (refunded)
            return fail("ALREADY_REFUNDED", "该奖励已经退还过积分", 409);
        const now = nowIso();
        await env.DB.prepare("UPDATE reward_redemptions SET status='cancelled', cancelled_at=? WHERE id=?")
            .bind(now, redemption.id)
            .run();
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'reward_refund', ?, ?, ?)")
            .bind(id(), redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "奖励退还积分")
            .run();
        await recalcAchievements(env, a.id, redemption.child_id);
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: "user",
            actorId: a.id,
            title: "奖励已退还积分",
            body: "家长已退还该奖励兑换的积分。",
            eventType: "reward_refund",
            relatedType: "reward_redemption",
            relatedId: redemption.id
        });
        return ok(true);
    }
    const childPin = path.match(/^\/child-pins\/(task|reward)$/);
    if (childPin && method === "PATCH") {
        const a = requireRole(actor, ["child"]);
        const input = await body(request);
        const itemType = childPin[1];
        const itemId = input.itemId === null ? null : String(input.itemId || "").trim();
        if (!itemId) {
            await env.DB.prepare("DELETE FROM child_pins WHERE child_id=? AND item_type=?").bind(a.id, itemType).run();
            return ok({ itemType, itemId: null });
        }
        const found = itemType === "task"
            ? await env.DB.prepare("SELECT t.id FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE t.id=? AND ta.child_id=? AND t.is_active=1 AND t.deleted_at IS NULL").bind(itemId, a.id).first()
            : await env.DB.prepare("SELECT r.id FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE r.id=? AND ra.child_id=? AND r.is_active=1 AND r.deleted_at IS NULL").bind(itemId, a.id).first();
        if (!found)
            return fail("NOT_ASSIGNED", itemType === "task" ? "任务不存在或未分配给当前孩子" : "奖励不存在或未分配给当前孩子", 404);
        const now = nowIso();
        await env.DB.prepare(`INSERT INTO child_pins (child_id, item_type, item_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(child_id, item_type) DO UPDATE SET item_id=excluded.item_id, updated_at=excluded.updated_at`)
            .bind(a.id, itemType, itemId, now, now)
            .run();
        return ok({ itemType, itemId });
    }
    if (path === "/warehouse" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        return ok((await env.DB.prepare(`SELECT rr.*, r.title, r.description, r.icon_type, r.icon_value, r.cost_points, r.redeem_weekdays
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.status IN ('pending','redeemed') AND rr.hidden_from_child_at IS NULL
ORDER BY rr.requested_at DESC`).bind(a.id).all()).results);
    }
    if (path === "/warehouse/clear-redeemed" && method === "PATCH") {
        const a = requireRole(actor, ["child"]);
        await env.DB.prepare("UPDATE reward_redemptions SET hidden_from_child_at=? WHERE child_id=? AND status='redeemed' AND hidden_from_child_at IS NULL")
            .bind(nowIso(), a.id)
            .run();
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
        const offset = await timezoneOffsetMinutes(env);
        const rows = (await env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? ORDER BY created_at DESC LIMIT 100").bind(childId).all()).results;
        return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset), items: await withLedgerSources(env, rows, offset) });
    }
    if (path === "/dashboard/parent" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all()).results;
        const balances = await balancesForChildren(env, children.map((child) => child.id));
        const childCards = children.map((child) => ({ ...child, balance: balances.get(child.id) || 0 }));
        return ok({
            children: childCards,
            pendingSubmissions: (await env.DB.prepare("SELECT s.*, t.title, c.display_name child_name FROM task_submissions s JOIN tasks t ON t.id=s.task_id JOIN children c ON c.id=s.child_id WHERE s.parent_id=? AND s.status='pending' ORDER BY s.submitted_at").bind(a.id).all()).results,
            pendingRedemptions: (await env.DB.prepare("SELECT rr.*, r.title, r.redeem_weekdays, c.display_name child_name FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id JOIN children c ON c.id=rr.child_id WHERE rr.parent_id=? AND rr.status='pending' ORDER BY rr.requested_at").bind(a.id).all()).results
        });
    }
    if (path === "/dashboard/child" && method === "GET") {
        const a = requireRole(actor, ["child"]);
        const offset = await timezoneOffsetMinutes(env);
        const pins = (await env.DB.prepare("SELECT item_type, item_id FROM child_pins WHERE child_id=?").bind(a.id).all()).results;
        const pinnedTaskId = pins.find((pin) => pin.item_type === "task")?.item_id || null;
        const pinnedRewardId = pins.find((pin) => pin.item_type === "reward")?.item_id || null;
        const currentTasks = await env.DB.prepare("SELECT t.*, tc.name category_name, tc.icon_type category_icon_type, tc.icon_value category_icon_value FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id JOIN task_categories tc ON tc.id=t.category_id WHERE ta.child_id=? AND t.is_active=1 AND t.deleted_at IS NULL ORDER BY tc.name, t.created_at DESC")
            .bind(a.id)
            .all();
        const enabledTasks = currentTasks.results.filter((task) => isWeekdayAllowed(task.enabled_weekdays, undefined, offset));
        const taskPeriods = enabledTasks.map((task) => ({ itemId: task.id, periodKey: periodKey(task.period, undefined, offset) }));
        const [taskUsageCounts, taskStatuses] = await Promise.all([
            childUsageCountsForPeriods(env, "task_submissions", "task_id", a.id, taskPeriods, ["pending", "approved"]),
            childLatestTaskStatuses(env, a.id, taskPeriods)
        ]);
        const taskRows = enabledTasks.map((task, index) => {
            const pkey = taskPeriods[index].periodKey;
            const key = `${task.id}:${pkey}`;
            const activeCount = taskUsageCounts.get(key) || 0;
            const latest = taskStatuses.latest.get(key);
            const rejected = taskStatuses.rejected.get(key);
            const limitCount = Number(task.limit_count || 1);
            return {
                ...task,
                enabledWeekdays: normalizeWeekdays(task.enabled_weekdays),
                periodKey: pkey,
                limitCount,
                usedCount: activeCount,
                remainingCount: Math.max(0, limitCount - activeCount),
                canSubmit: activeCount < limitCount,
                resetAt: nextPeriodReset(task.period, undefined, offset),
                submissionStatus: latest?.status || null,
                rejectionNote: rejected?.review_note || "",
                isPinned: task.id === pinnedTaskId
            };
        });
        const rewardRows = await env.DB.prepare("SELECT r.* FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id WHERE ra.child_id=? AND r.is_active=1 AND r.deleted_at IS NULL ORDER BY r.cost_points")
            .bind(a.id)
            .all();
        const rewardsWithLocks = [];
        for (const reward of rewardRows.results) {
            if (!(await rewardLockedByAchievement(env, reward.id, a.id)))
                rewardsWithLocks.push(reward);
        }
        const rewardPeriods = rewardsWithLocks.map((reward) => ({ itemId: reward.id, periodKey: periodKey(reward.limit_period, undefined, offset) }));
        const rewardUsageCounts = await childUsageCountsForPeriods(env, "reward_redemptions", "reward_id", a.id, rewardPeriods, ["pending", "redeemed"]);
        const rewards = rewardsWithLocks.map((reward, index) => {
            const pkey = rewardPeriods[index].periodKey;
            const limitCount = reward.limit_period === "none" || reward.limit_count === null ? null : Number(reward.limit_count);
            const usedCount = limitCount === null ? 0 : rewardUsageCounts.get(`${reward.id}:${pkey}`) || 0;
            return {
                ...reward,
                redeemWeekdays: normalizeWeekdays(reward.redeem_weekdays),
                periodKey: pkey,
                limitCount,
                usedCount,
                remainingCount: limitCount === null ? null : Math.max(0, limitCount - usedCount),
                canRedeem: limitCount === null || usedCount < limitCount,
                resetAt: nextPeriodReset(reward.limit_period, undefined, offset),
                isPinned: reward.id === pinnedRewardId
            };
        });
        const visiblePinnedTaskId = taskRows.some((task) => task.id === pinnedTaskId) ? pinnedTaskId : null;
        const visiblePinnedRewardId = rewards.some((reward) => reward.id === pinnedRewardId) ? pinnedRewardId : null;
        const childRow = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=?").bind(a.id).first();
        let aiGreeting = childRow ? await generateAiGreeting(env, childRow, offset) : "";
        let aiRefreshPending = false;
        if (!aiGreeting && childRow?.ai_enabled) {
            const stale = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? ORDER BY generated_at DESC LIMIT 1").bind(childRow.id).first();
            if (stale?.greeting) {
                aiGreeting = stale.greeting;
                aiRefreshPending = true;
                ctx?.waitUntil?.(generateAiGreeting(env, childRow, offset, true));
            }
        }
        return ok({
            child: a,
            balance: await balance(env, a.id),
            pinnedTaskId: visiblePinnedTaskId,
            pinnedRewardId: visiblePinnedRewardId,
            tasks: taskRows,
            rewards,
            aiGreeting,
            aiRefreshPending,
            achievements: (await env.DB.prepare("SELECT a.*, ca.unlocked_at FROM achievements a JOIN child_achievements ca ON ca.achievement_id=a.id WHERE ca.child_id=? ORDER BY ca.unlocked_at DESC").bind(a.id).all()).results
        });
    }
    return fail("NOT_FOUND", "接口不存在", 404);
}
const AI_REFRESH_DELAY_MS = 2000;
const AI_REFRESH_COOLDOWN_MS = 30000;
const AI_REFRESH_MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function batchRefreshGreetings(env, offset) {
    const children = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE ai_enabled=1 AND deleted_at IS NULL").all();
    if (!children.results.length)
        return { success: 0, failed: 0 };
    let failed = [...children.results];
    let successCount = 0;
    let attempt = 0;
    while (failed.length > 0 && attempt < AI_REFRESH_MAX_RETRIES) {
        attempt++;
        const stillFailed = [];
        for (const child of failed) {
            try {
                const greeting = await generateAiGreeting(env, child, offset);
                if (greeting)
                    successCount++;
                else
                    stillFailed.push(child);
            }
            catch {
                stillFailed.push(child);
            }
            await sleep(AI_REFRESH_DELAY_MS);
        }
        failed = stillFailed;
        if (failed.length > 0 && attempt < AI_REFRESH_MAX_RETRIES)
            await sleep(AI_REFRESH_COOLDOWN_MS);
    }
    return { success: successCount, failed: failed.length };
}

export const onRequest = async ({ request, env, ctx }) => {
    try {
        return await route(request, env, ctx);
    }
    catch (error) {
        if (error instanceof Response)
            return error;
        return fail("SERVER_ERROR", error instanceof Error ? error.message : "服务器错误", 500);
    }
};
