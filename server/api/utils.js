import { DEFAULT_TIMEZONE_OFFSET_MINUTES, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, isWeekdayAllowed, nextPeriodReset, normalizeWeekdays, periodKey, prerequisitePeriodKey, reportWindowRange, signedPoints } from "../../src/lib/domain.js";
export const json = (data, init) => new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) }
});
export const ok = (data) => json({ data });
export const fail = (code, message, status = 400) => json({ error: { code, message } }, { status });
export const nowIso = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const PBKDF2_ITERATIONS = 100000;
export const DAY_MS = 86400000;
export let bootstrapPromise = null;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 60000;
export async function ensureLoginAttemptsSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_key TEXT NOT NULL,
        attempted_at INTEGER NOT NULL,
        UNIQUE(attempt_key, attempted_at)
    )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_key_time ON login_attempts(attempt_key, attempted_at)").run();
}
export async function checkLoginRateLimit(env, key) {
    await ensureLoginAttemptsSchema(env);
    const now = Date.now();
    const windowStart = now - LOGIN_WINDOW_MS;
    const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM login_attempts WHERE attempt_key=? AND attempted_at>?").bind(key, windowStart).first();
    if (Number(row?.cnt || 0) >= LOGIN_MAX_ATTEMPTS) throw fail("RATE_LIMITED", "登录尝试过于频繁，请稍后再试", 429);
    await env.DB.prepare("INSERT INTO login_attempts (attempt_key, attempted_at) VALUES (?, ?)").bind(key, now).run();
    await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at<?").bind(windowStart).run();
}
export const INPUT_RULES = {
    title: { max: 200, required: true },
    description: { max: 2000 },
    username: { max: 100, required: true, pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]{1,100}$/ },
    password: { max: 200 },
    displayName: { max: 100 },
    points: { min: -999999, max: 999999, type: "number" },
    costPoints: { min: 0, max: 999999, type: "number" },
    limitCount: { min: 1, max: 9999, type: "number" },
    stock: { min: 0, max: 999999, type: "number" },
};
export function validateInput(value, rules, fieldName) {
    if (value === undefined || value === null) {
        if (rules.required) return `${fieldName} 为必填项`;
        return null;
    }
    const str = String(value);
    if (rules.type === "number") {
        if (!Number.isFinite(Number(value))) return `${fieldName} 必须是数字`;
        if (rules.min !== undefined && Number(value) < rules.min) return `${fieldName} 不能小于 ${rules.min}`;
        if (rules.max !== undefined && Number(value) > rules.max) return `${fieldName} 不能大于 ${rules.max}`;
    } else {
        if (rules.max && str.length > rules.max) return `${fieldName} 不能超过 ${rules.max} 个字符`;
    }
    if (rules.pattern && !rules.pattern.test(str)) return `${fieldName} 格式不正确`;
    return null;
}
export function validateEnum(value, allowed, fieldName) {
    if (!allowed.includes(value)) return `${fieldName} 只能是 ${allowed.join("、")}`;
    return null;
}
export function validateNumber(value, options, fieldName) {
    if (!Number.isFinite(Number(value))) return `${fieldName} 必须是数字`;
    const num = Number(value);
    if (options.min !== undefined && num < options.min) return `${fieldName} 不能小于 ${options.min}`;
    if (options.max !== undefined && num > options.max) return `${fieldName} 不能大于 ${options.max}`;
    if (options.integer && !Number.isInteger(num)) return `${fieldName} 必须是整数`;
    return null;
}
export function validateHttpsUrl(value, fieldName) {
    if (!value || typeof value !== "string") return `${fieldName} 不能为空`;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return `${fieldName} 必须是 HTTPS 地址`;
        if (isPrivateUrl(value)) return `${fieldName} 不允许使用内网地址`;
        return null;
    } catch {
        return `${fieldName} 不是有效的 URL`;
    }
}
export const clampTimezoneOffset = (value) => Math.max(-840, Math.min(840, Number(value)));
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
export async function verifyPassword(password, stored) {
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
export async function body(request) {
    try {
        return (await request.json());
    }
    catch {
        return {};
    }
}
export function cookie(request, name) {
    const header = request.headers.get("cookie") || "";
    return header
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([key]) => key === name)?.[1];
}
export async function ensureAdmin(env) {
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
export async function ensureNotificationsSchema(env) {
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
    await ensureColumn(env, "notifications", "actor_label_snapshot", "actor_label_snapshot TEXT NOT NULL DEFAULT ''");
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id, read_at, created_at)").run();
}
export async function ensureParentDelegatesSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parent_delegates (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operator_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await ensureColumn(env, "users", "operator_label", "operator_label TEXT NOT NULL DEFAULT ''");
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_parent_delegates_parent ON parent_delegates(parent_id, status, deleted_at)").run();
}
export async function ensureOperatorAuditSchema(env) {
    await ensureColumn(env, "point_ledger", "actor_type", "actor_type TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "point_ledger", "actor_id", "actor_id TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "point_ledger", "actor_label_snapshot", "actor_label_snapshot TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "notifications", "actor_label_snapshot", "actor_label_snapshot TEXT NOT NULL DEFAULT ''");
}
export async function ensureSystemSettings(env) {
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
    await ensureParentDelegatesSchema(env);
    await ensureOperatorAuditSchema(env);
    await ensureParentAiServiceSettings(env);
    await ensureCriticismRemedySchema(env);
}
export async function ensureParentAiServiceSettings(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parent_ai_service_settings (
  parent_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  report_prompt TEXT NOT NULL DEFAULT '',
  monthly_prompt TEXT NOT NULL DEFAULT '',
  image_base_url TEXT NOT NULL DEFAULT '',
  image_api_key TEXT NOT NULL DEFAULT '',
  image_model TEXT NOT NULL DEFAULT 'gpt-image-2',
  image_prompt TEXT NOT NULL DEFAULT '',
  image_size TEXT NOT NULL DEFAULT '1248x1760',
  image_quality TEXT NOT NULL DEFAULT 'low',
  image_format TEXT NOT NULL DEFAULT 'jpeg',
  image_n INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
)`).run();
    await ensureColumn(env, "parent_ai_service_settings", "report_prompt", "report_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "monthly_prompt", "monthly_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_base_url", "image_base_url TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_api_key", "image_api_key TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_model", "image_model TEXT NOT NULL DEFAULT 'gpt-image-2'");
    await ensureColumn(env, "parent_ai_service_settings", "image_prompt", "image_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_size", "image_size TEXT NOT NULL DEFAULT '1248x1760'");
    await ensureColumn(env, "parent_ai_service_settings", "image_quality", "image_quality TEXT NOT NULL DEFAULT 'low'");
    await ensureColumn(env, "parent_ai_service_settings", "image_format", "image_format TEXT NOT NULL DEFAULT 'jpeg'");
    await ensureColumn(env, "parent_ai_service_settings", "image_n", "image_n INTEGER NOT NULL DEFAULT 1");
    await ensureColumn(env, "parent_ai_service_settings", "checklist_image_prompt", "checklist_image_prompt TEXT NOT NULL DEFAULT ''");
}
export async function timezoneOffsetMinutes(env) {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key='timezone_offset_minutes'").first();
    const value = Number(row?.value ?? DEFAULT_TIMEZONE_OFFSET_MINUTES);
    return Number.isFinite(value) ? clampTimezoneOffset(value) : DEFAULT_TIMEZONE_OFFSET_MINUTES;
}
export function timezoneLabel(offsetMinutes) {
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, "0");
    const minutes = String(abs % 60).padStart(2, "0");
    return `UTC${sign}${hours}:${minutes}`;
}
export async function tableColumns(env, table) {
    return (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((row) => row.name);
}
export async function ensureColumn(env, table, name, ddl) {
    const columns = await tableColumns(env, table);
    if (!columns.includes(name)) {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    }
}
export function weekdayJson(value) {
    return JSON.stringify(normalizeWeekdays(value));
}
export function localTimeText(value, offsetMinutes) {
    if (!value)
        return "";
    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
        ? `${text.replace(" ", "T")}Z`
        : text;
    const time = new Date(normalized).getTime();
    if (Number.isNaN(time))
        return text;
    return new Date(time + offsetMinutes * 60000).toISOString().replace("T", " ").slice(0, 19);
}
export async function ensureSystemErrorLogs(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS system_error_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'error' CHECK(level IN ('error', 'warning')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  status INTEGER,
  method TEXT,
  path TEXT,
  actor_type TEXT,
  actor_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_system_error_logs_created ON system_error_logs(created_at DESC)").run();
}
export async function logSystemError(env, { level = "error", source, message, stack = "", status = null, method = "", path = "", actor = null, metadata = {} }) {
    try {
        await ensureSystemErrorLogs(env);
        await env.DB.prepare(`INSERT INTO system_error_logs
(id, level, source, message, stack, status, method, path, actor_type, actor_id, metadata_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id(), level, source || "system", String(message || "system error").slice(0, 1000), String(stack || "").slice(0, 4000), status, method || "", path || "", actor?.type || "", actor?.id || "", JSON.stringify(metadata || {}).slice(0, 4000), nowIso())
            .run();
    } catch (error) {
        console.error("failed to write system error log:", error?.stack || error);
    }
}
export async function cleanupSystemErrorLogs(env, retentionDays = 92) {
    await ensureSystemErrorLogs(env);
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
    await env.DB.prepare("DELETE FROM system_error_logs WHERE created_at<?").bind(cutoff).run();
}
export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}
export async function ensureFeedbackSchema(env) {
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
    await ensureColumn(env, "feedback_templates", "is_remediable", "is_remediable INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "feedback_templates", "remedy_condition", "remedy_condition TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "feedback_templates", "remedy_points", "remedy_points INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "feedback_templates", "remedy_deadline_hours", "remedy_deadline_hours INTEGER NOT NULL DEFAULT 24");
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_templates_parent ON feedback_templates(parent_id, kind, is_active, deleted_at)").run();
}
export async function ensureCriticismRemedySchema(env) {
    await ensureFeedbackSchema(env);
    await ensureColumn(env, "point_ledger", "effective_amount", "effective_amount INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "point_ledger", "frozen_amount", "frozen_amount INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "point_ledger", "freeze_status", "freeze_status TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "point_ledger", "remedy_condition", "remedy_condition TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "point_ledger", "remedy_points", "remedy_points INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "point_ledger", "remedy_deadline_at", "remedy_deadline_at TEXT");
    await ensureColumn(env, "point_ledger", "remedied_at", "remedied_at TEXT");
    await ensureColumn(env, "point_ledger", "settled_at", "settled_at TEXT");
    await env.DB.prepare("UPDATE point_ledger SET effective_amount=amount WHERE effective_amount=0 AND amount<>0").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_point_ledger_freeze ON point_ledger(freeze_status, remedy_deadline_at)").run();
}
export async function ensureCategorySchema(env) {
    const columns = (await env.DB.prepare("PRAGMA table_info(task_categories)").all()).results.map((row) => row.name);
    if (!columns.includes("source_system_id")) {
        await env.DB.prepare("ALTER TABLE task_categories ADD COLUMN source_system_id TEXT REFERENCES task_categories(id)").run();
    }
}
export async function ensureAchievementSchema(env) {
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
export async function ensureChildPinsSchema(env) {
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
export async function ensureIterationSchema(env) {
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
export async function ensureRequiredTaskSchema(env) {
    await ensureColumn(env, "tasks", "is_required", "is_required INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_count", "required_count INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_penalty_points", "required_penalty_points INTEGER NOT NULL DEFAULT 0");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_required_penalties (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  required_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  penalty_points INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, child_id, period_key)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_required_penalties_child ON task_required_penalties(child_id, period_key)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_required_penalties_parent ON task_required_penalties(parent_id, period_key)").run();
}
export async function ensureRetentionSchema(env) {
    await ensureColumn(env, "point_ledger", "revoked_at", "revoked_at TEXT");
    await ensureColumn(env, "point_ledger", "revoke_ledger_id", "revoke_ledger_id TEXT REFERENCES point_ledger(id)");
    await ensureColumn(env, "point_ledger", "retention_until", "retention_until TEXT");
    await ensureCriticismRemedySchema(env);
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
export async function settingNumber(env, key, fallback) {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key=?").bind(key).first();
    const value = Number(row?.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export async function updateSetting(env, key, value) {
    await env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(key, String(value), nowIso())
        .run();
}
export async function settleExpiredCriticismFreezes(env, at = nowIso()) {
    await ensureCriticismRemedySchema(env);
    const rows = (await env.DB.prepare(`SELECT id, child_id, parent_id, frozen_amount
FROM point_ledger
WHERE source_type='criticism'
  AND freeze_status='frozen'
  AND revoked_at IS NULL
  AND remedied_at IS NULL
  AND remedy_deadline_at IS NOT NULL
  AND remedy_deadline_at<=?`).bind(at).all()).results;
    if (!rows.length) return { settled: 0 };
    for (const row of rows) {
        const amount = -Math.abs(Number(row.frozen_amount || 0));
        await env.DB.prepare(`UPDATE point_ledger
SET amount=?, effective_amount=?, freeze_status='settled', settled_at=?
WHERE id=? AND freeze_status='frozen' AND revoked_at IS NULL`)
            .bind(amount, amount, at, row.id)
            .run();
        await recalcAchievements(env, row.parent_id, row.child_id);
    }
    return { settled: rows.length };
}
export async function settleRequiredTaskPenalties(env, at = nowIso()) {
    await ensureRequiredTaskSchema(env);
    const offset = await timezoneOffsetMinutes(env);
    const now = new Date(at);
    const nowZoned = new Date(now.getTime() + offset * 60000);
    const hour = nowZoned.getUTCHours();
    const dayOfWeek = nowZoned.getUTCDay();
    const dayOfMonth = nowZoned.getUTCDate();
    const prevDay = new Date(nowZoned.getTime() - 86400000);
    const prevWeek = new Date(nowZoned.getTime() - 7 * 86400000);
    const prevMonth = new Date(nowZoned.getUTCFullYear(), nowZoned.getUTCMonth() - 1, 1);
    const dailyKey = periodKey("daily", prevDay, 0);
    const weeklyKey = periodKey("weekly", prevWeek, 0);
    const monthlyKey = periodKey("monthly", prevMonth, 0);
    const shouldSettleDaily = hour >= 0;
    const shouldSettleWeekly = dayOfWeek === 1 && hour >= 0;
    const shouldSettleMonthly = dayOfMonth === 1 && hour >= 0;
    if (!shouldSettleDaily && !shouldSettleWeekly && !shouldSettleMonthly)
        return { settled: 0 };
    const tasks = (await env.DB.prepare(`SELECT t.id, t.parent_id, t.period, t.required_count, t.required_penalty_points, t.title,
  ta.child_id
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
WHERE t.is_required=1
  AND t.required_count>0
  AND t.is_active=1
  AND t.deleted_at IS NULL`).all()).results;
    let settled = 0;
    for (const task of tasks) {
        let periodKeyValue = null;
        if (task.period === "daily" && shouldSettleDaily)
            periodKeyValue = dailyKey;
        else if (task.period === "weekly" && shouldSettleWeekly)
            periodKeyValue = weeklyKey;
        else if (task.period === "monthly" && shouldSettleMonthly)
            periodKeyValue = monthlyKey;
        else
            continue;
        const existing = await env.DB.prepare("SELECT id FROM task_required_penalties WHERE task_id=? AND child_id=? AND period_key=?")
            .bind(task.id, task.child_id, periodKeyValue).first();
        if (existing)
            continue;
        const childStatus = await env.DB.prepare("SELECT status FROM children WHERE id=? AND deleted_at IS NULL")
            .bind(task.child_id).first();
        if (!childStatus || childStatus.status !== "active")
            continue;
        const actualCount = (await env.DB.prepare(`SELECT COUNT(*) as cnt FROM task_submissions
WHERE task_id=? AND child_id=? AND period_key=? AND status='approved'`)
            .bind(task.id, task.child_id, periodKeyValue).first())?.cnt || 0;
        if (Number(actualCount) >= Number(task.required_count))
            continue;
        const penaltyPoints = Math.abs(Number(task.required_penalty_points || 0));
        if (penaltyPoints <= 0)
            continue;
        const currentBalance = await balance(env, task.child_id);
        const actualPenalty = Math.min(penaltyPoints, currentBalance);
        if (actualPenalty <= 0) {
            await env.DB.prepare(`INSERT INTO task_required_penalties (id, task_id, child_id, parent_id, period_key, required_count, actual_count, penalty_points, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
                .bind(id(), task.id, task.child_id, task.parent_id, periodKeyValue, task.required_count, actualCount, at)
                .run();
            settled++;
            continue;
        }
        const ledgerId = id();
        await env.DB.prepare(`INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at)
VALUES (?, ?, ?, ?, 'task_required_penalty', ?, ?, ?, ?)`)
            .bind(ledgerId, task.child_id, task.parent_id, -actualPenalty, task.id, periodKeyValue, `必做任务未达标扣分`, at)
            .run();
        await notify(env, {
            recipientType: "child",
            recipientId: task.child_id,
            actorType: "system",
            actorId: null,
            title: "必做任务未达标扣分",
            body: `必做任务「${task.title}」未达标，扣除 ${actualPenalty} 积分。`,
            eventType: "task_required_penalty",
            relatedType: "point_ledger",
            relatedId: ledgerId,
            createdAt: at
        });
        await env.DB.prepare(`INSERT INTO task_required_penalties (id, task_id, child_id, parent_id, period_key, required_count, actual_count, penalty_points, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id(), task.id, task.child_id, task.parent_id, periodKeyValue, task.required_count, actualCount, actualPenalty, at)
            .run();
        await recalcAchievements(env, task.parent_id, task.child_id);
        settled++;
    }
    return { settled };
}
export async function activeRemedyCriticisms(env, childId, offset, at = nowIso()) {
    await settleExpiredCriticismFreezes(env, at);
    const rows = (await env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=?
  AND pl.source_type='criticism'
  AND pl.freeze_status='frozen'
  AND pl.revoked_at IS NULL
  AND pl.remedied_at IS NULL
  AND pl.remedy_deadline_at>?
ORDER BY pl.remedy_deadline_at ASC`).bind(childId, at).all()).results;
    const nowMs = Date.parse(at);
    return rows.map((row) => ({
        id: row.id,
        title: row.template_title || row.note || "批评补救",
        note: row.note || "",
        frozenAmount: Number(row.frozen_amount || 0),
        remedyCondition: row.remedy_condition || "",
        remedyPoints: Number(row.remedy_points || 0),
        remedyDeadlineAt: row.remedy_deadline_at,
        localRemedyDeadlineAt: localTimeText(row.remedy_deadline_at, offset),
        remainingMs: Math.max(0, Date.parse(row.remedy_deadline_at) - nowMs),
        createdAt: row.created_at,
        localCreatedAt: localTimeText(row.created_at, offset)
    }));
}
export async function cleanupShortRetention(env, cutoffIso) {
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
export async function archiveOldActivity(env, cutoffIso, timezoneOffsetMinutes = 480) {
    const rows = (await env.DB.prepare("SELECT child_id, parent_id, created_at, amount FROM point_ledger WHERE created_at<? AND source_type!='activity_archive'")
        .bind(cutoffIso).all()).results;
    const localMonth = (iso) => {
        const d = new Date(new Date(iso).getTime() + timezoneOffsetMinutes * 60000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };
    const groupsMap = new Map();
    for (const row of rows) {
        const mk = localMonth(row.created_at);
        const key = `${row.child_id}:${row.parent_id}:${mk}`;
        const existing = groupsMap.get(key) || { child_id: row.child_id, parent_id: row.parent_id, month_key: mk, net_points: 0 };
        existing.net_points += Number(row.amount || 0);
        groupsMap.set(key, existing);
    }
    const groups = [...groupsMap.values()];
    for (const group of groups) {
        const archiveId = `archive:${group.child_id}:${group.month_key}`;
        const monthStart = `${group.month_key}-01T00:00:00.000Z`;
        const nextMonth = Number(group.month_key.slice(5, 7)) + 1;
        const monthEnd = nextMonth > 12
            ? new Date(Date.UTC(Number(group.month_key.slice(0, 4)) + 1, 0, 1)).toISOString()
            : new Date(Date.UTC(Number(group.month_key.slice(0, 4)), nextMonth - 1, 1)).toISOString();
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
export async function hardDeleteSoftDeleted(env, cutoffIso) {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(nowIso()).run();
    await env.DB.prepare("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM reward_assignees WHERE reward_id IN (SELECT id FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM reward_prerequisites WHERE reward_id IN (SELECT id FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?)").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM rewards WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM achievements WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
    await env.DB.prepare("DELETE FROM feedback_templates WHERE deleted_at IS NOT NULL AND deleted_at<?").bind(cutoffIso).run();
}
export async function maybeRunMaintenance(env) {
    const last = await env.DB.prepare("SELECT value FROM system_settings WHERE key='cleanup_last_run_at'").first();
    const now = nowIso();
    if (last?.value && Date.parse(now) - Date.parse(last.value) < DAY_MS)
        return;
    const detailDays = await settingNumber(env, "detail_retention_days", 365);
    const shortDays = await settingNumber(env, "short_record_retention_days", 7);
    const detailCutoff = new Date(Date.now() - detailDays * DAY_MS).toISOString();
    const shortCutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
    try {
        await cleanupShortRetention(env, shortCutoff);
        await settleExpiredCriticismFreezes(env, now);
        await settleRequiredTaskPenalties(env, now);
        const offset = await timezoneOffsetMinutes(env);
        await archiveOldActivity(env, detailCutoff, offset);
        await hardDeleteSoftDeleted(env, detailCutoff);
        await cleanupSystemErrorLogs(env);
        await updateSetting(env, "cleanup_last_run_at", now);
    } catch (error) {
        await logSystemError(env, {
            source: "maintenance",
            message: error?.message || String(error || "maintenance failed"),
            stack: error?.stack || "",
            status: 500
        });
        throw error;
    }
}
let bootstrapLock = false;
export async function bootstrap(env) {
    if (bootstrapPromise) {
        await bootstrapPromise;
        return;
    }
    if (bootstrapLock) {
        while (bootstrapLock && !bootstrapPromise) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (bootstrapPromise) await bootstrapPromise;
        return;
    }
    bootstrapLock = true;
    bootstrapPromise = (async () => {
        await ensureSystemSettings(env);
        await ensureSystemErrorLogs(env);
        await ensureAdmin(env);
        await maybeRunMaintenance(env);
    })().catch((error) => {
        bootstrapPromise = null;
        throw error;
    }).finally(() => {
        bootstrapLock = false;
    });
    await bootstrapPromise;
}
export async function ensureRewardOnceSchema(env) {
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
export async function actorFromRequest(request, env) {
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
            ? { type: "child", id: child.id, role: "child", parentId: child.parent_id, parent_id: child.parent_id, username: child.username, displayName: child.display_name }
            : null;
    }
    if (session.actor_type === "user" && String(session.actor_id || "").startsWith("delegate:")) {
        await ensureParentDelegatesSchema(env);
        const delegateId = String(session.actor_id).slice("delegate:".length);
        const delegate = await env.DB.prepare(`SELECT d.id, d.parent_id, d.username, d.display_name, d.operator_label, u.display_name parent_display_name
FROM parent_delegates d
JOIN users u ON u.id=d.parent_id
WHERE d.id=? AND d.status='active' AND d.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL`)
            .bind(delegateId)
            .first();
        return delegate ? {
            type: "user",
            id: delegate.parent_id,
            delegateId: delegate.id,
            role: "parent_delegate",
            parentId: delegate.parent_id,
            parent_id: delegate.parent_id,
            username: delegate.username,
            displayName: delegate.display_name,
            operatorLabel: delegate.operator_label || delegate.display_name || delegate.parent_display_name
        } : null;
    }
    const user = await env.DB.prepare("SELECT id, role, username, display_name, operator_label FROM users WHERE id=? AND status='active' AND deleted_at IS NULL")
        .bind(session.actor_id)
        .first();
    return user ? { type: "user", id: user.id, role: user.role, username: user.username, displayName: user.display_name, operatorLabel: user.operator_label || user.display_name } : null;
}
export function requireRole(actor, roles) {
    if (!actor)
        throw fail("UNAUTHENTICATED", "请先登录", 401);
    if (!roles.includes(actor.role))
        throw fail("FORBIDDEN", "没有权限执行此操作", 403);
    return actor;
}
export function parentOwnerId(actor) {
    return actor?.role === "parent_delegate" ? actor.parentId || actor.parent_id || actor.id : actor?.id;
}
export function actorAudit(actor) {
    if (!actor)
        return { type: "system", id: "", label: "system" };
    if (actor.role === "parent_delegate") {
        return { type: "user", id: `delegate:${actor.delegateId || ""}`, label: actor.operatorLabel || actor.displayName || "协同管理" };
    }
    if (actor.role === "parent") {
        return { type: "user", id: actor.id, label: actor.operatorLabel || actor.displayName || "家长" };
    }
    if (actor.role === "child") {
        return { type: "child", id: actor.id, label: actor.displayName || "孩子" };
    }
    return { type: actor.type || "user", id: actor.id || "", label: actor.displayName || actor.username || "操作者" };
}
export async function childIdsForParent(env, parentId) {
    const rows = await env.DB.prepare("SELECT id FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(parentId).all();
    return rows.results.map((row) => row.id);
}
export async function usernameExists(env, username, ignore) {
    const normalized = String(username || "").trim();
    if (!normalized)
        return false;
    const user = await env.DB.prepare("SELECT id FROM users WHERE username=? AND deleted_at IS NULL").bind(normalized).first();
    if (user && ignore !== `user:${user.id}`)
        return true;
    const child = await env.DB.prepare("SELECT id FROM children WHERE username=? AND deleted_at IS NULL").bind(normalized).first();
    if (child && ignore !== `child:${child.id}`)
        return true;
    await ensureParentDelegatesSchema(env);
    const delegate = await env.DB.prepare("SELECT id FROM parent_delegates WHERE username=? AND deleted_at IS NULL").bind(normalized).first();
    return !!(delegate && ignore !== `delegate:${delegate.id}`);
}
export async function validateChildIds(env, parentId, childIds) {
    if (!childIds || !childIds.length) return;
    const placeholders = childIds.map(() => "?").join(",");
    const rows = await env.DB.prepare(`SELECT id FROM children WHERE id IN (${placeholders}) AND parent_id=? AND deleted_at IS NULL`)
        .bind(...childIds, parentId)
        .all();
    const valid = new Set(rows.results.map((r) => r.id));
    const invalid = childIds.filter((id) => !valid.has(id));
    if (invalid.length) throw fail("FORBIDDEN", `孩子 ID 不属于当前家长: ${invalid.join(", ")}`, 403);
}
export async function validateTaskIds(env, parentId, taskIds) {
    if (!taskIds || !taskIds.length) return;
    const placeholders = taskIds.map(() => "?").join(",");
    const rows = await env.DB.prepare(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND parent_id=? AND deleted_at IS NULL`)
        .bind(...taskIds, parentId)
        .all();
    const valid = new Set(rows.results.map((r) => r.id));
    const invalid = taskIds.filter((id) => !valid.has(id));
    if (invalid.length) throw fail("FORBIDDEN", `任务 ID 不属于当前家长: ${invalid.join(", ")}`, 403);
}
export async function validateCategoryOwnership(env, parentId, categoryId) {
    if (!categoryId) return;
    const cat = await env.DB.prepare("SELECT id, is_system FROM task_categories WHERE id=? AND is_active=1 AND ((is_system=1 AND owner_id IS NULL) OR owner_id=?)")
        .bind(categoryId, parentId)
        .first();
    if (!cat) throw fail("FORBIDDEN", "分类不存在或不属于当前家长", 403);
}
export async function replaceAssignees(env, parentId, table, key, keyValue, childIds) {
    await validateChildIds(env, parentId, childIds || []);
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${key}=?`).bind(keyValue).run();
    for (const childId of (childIds || [])) {
        await env.DB.prepare(`INSERT INTO ${table} (${key}, child_id) VALUES (?, ?)`).bind(keyValue, childId).run();
    }
}
export async function replaceRewardPrerequisites(env, parentId, rewardId, prerequisites = []) {
    const taskIds = prerequisites.map((item) => String(item.taskId || item.task_id || "").trim()).filter(Boolean);
    await validateTaskIds(env, parentId, taskIds);
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
export async function rewardPrerequisites(env, rewardId) {
    return (await env.DB.prepare(`SELECT rp.task_id, rp.required_count, t.title, t.period
FROM reward_prerequisites rp
JOIN tasks t ON t.id=rp.task_id
WHERE rp.reward_id=?
ORDER BY t.created_at DESC`).bind(rewardId).all()).results;
}
export async function completedTaskCount(env, childId, taskId, periodKeyValue = null) {
    const periodClause = periodKeyValue ? " AND period_key=?" : "";
    const params = periodKeyValue ? [childId, taskId, periodKeyValue] : [childId, taskId];
    const row = await env.DB.prepare(`SELECT COUNT(*) v FROM task_submissions WHERE child_id=? AND task_id=? AND status='approved'${periodClause}`)
        .bind(...params)
        .first();
    return Number(row?.v || 0);
}
export async function unmetRewardPrerequisites(env, rewardId, childId, at = nowIso()) {
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
export async function rewardLockedByAchievement(env, rewardId, childId) {
    const rows = (await env.DB.prepare(`SELECT a.id, ca.unlocked_at
FROM achievements a
LEFT JOIN child_achievements ca ON ca.achievement_id=a.id AND ca.child_id=?
WHERE a.unlock_reward_id=? AND a.is_active=1 AND a.deleted_at IS NULL`)
        .bind(childId, rewardId)
        .all()).results;
    return rows.length > 0 && rows.every((row) => !row.unlocked_at);
}
export async function replaceRewardAchievementRequirement(env, parentId, rewardId, achievementId) {
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
export async function deleteAchievementWithExclusiveReward(env, parentId, achievementId) {
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
export const ACHIEVEMENT_RULE_TYPES = new Set([
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
export const ACHIEVEMENT_WINDOW_TYPES = new Set(["all_time", "current_week", "current_month", "custom"]);
export function normalizeAchievementInput(input = {}) {
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
export function countRowsInWindow(rows, dateKey, achievement, offset, now) {
    const windowType = achievement.window_type || "all_time";
    return rows.filter((row) => inAchievementWindow(row[dateKey], windowType, now, offset, achievement.window_start, achievement.window_end)).length;
}
export async function balance(env, childId) {
    const frozen = await frozenPointsForChild(env, childId);
    if (frozen > 0) {
        const row = await env.DB.prepare(`SELECT MAX(0, COALESCE(SUM(amount), 0) - ?) as balance FROM point_ledger WHERE child_id=?`).bind(frozen, childId).first();
        return Number(row?.balance || 0);
    }
    const row = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) balance FROM point_ledger WHERE child_id=?").bind(childId).first();
    return Number(row?.balance || 0);
}
export async function balancesForChildren(env, childIds) {
    if (!childIds.length)
        return new Map();
    const placeholders = childIds.map(() => "?").join(",");
    const frozenMap = await frozenPointsForChildren(env, childIds);
    const rows = (await env.DB.prepare(`SELECT child_id, COALESCE(SUM(amount), 0) balance FROM point_ledger WHERE child_id IN (${placeholders}) GROUP BY child_id`)
        .bind(...childIds)
        .all()).results;
    return new Map(rows.map((row) => {
        const frozen = frozenMap.get(row.child_id) || 0;
        const raw = Number(row.balance || 0);
        return [row.child_id, frozen > 0 ? Math.max(0, raw - frozen) : raw];
    }));
}
export async function frozenPointsForChild(env, childId) {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(frozen_amount), 0) frozen FROM point_ledger WHERE child_id=? AND freeze_status='frozen' AND revoked_at IS NULL AND remedied_at IS NULL").bind(childId).first();
    return Number(row?.frozen || 0);
}
export async function frozenPointsForChildren(env, childIds) {
    if (!childIds.length)
        return new Map();
    const placeholders = childIds.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT child_id, COALESCE(SUM(frozen_amount), 0) frozen FROM point_ledger WHERE child_id IN (${placeholders}) AND freeze_status='frozen' AND revoked_at IS NULL AND remedied_at IS NULL GROUP BY child_id`)
        .bind(...childIds)
        .all()).results;
    return new Map(rows.map((row) => [row.child_id, Number(row.frozen || 0)]));
}
export async function recalcAchievements(env, parentId, childId) {
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
    const notifications = [];
    await env.DB.transaction(async () => {
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
                    notifications.push({
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
    });
    for (const notification of notifications) {
        await notify(env, notification);
    }
}
export async function listWithAssignees(env, kind, parentId) {
    if (kind === "tasks") await ensureRequiredTaskSchema(env);
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
export async function listConfig(env, parentId) {
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
// Imported items default to disabled (is_active=0) for safety review
export function importedActive(item) {
    return 0;
}
export async function insertTaskFromConfig(env, parentId, item, categoryMap, childMap) {
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
    await ensureRequiredTaskSchema(env);
    const taskId = id();
    const isRequired = period !== "once" && item.is_required ? 1 : 0;
    const requiredCount = isRequired ? Math.max(1, Number(item.required_count || item.requiredCount || 1)) : 0;
    const requiredPenaltyPoints = isRequired ? Math.max(0, Number(item.required_penalty_points || item.requiredPenaltyPoints || 0)) : 0;
    await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active, is_required, required_count, required_penalty_points) VALUES (?, ?, ?, ?, ?, ?, 'earn', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(taskId, parentId, categoryId, title, item.description || "", period, Number(item.points || 0), item.icon_type || "emoji", item.icon_value || "✅", Math.max(1, Number(item.limit_count || item.limitCount || 1)), weekdayJson(item.enabledWeekdays || item.enabled_weekdays), importedActive(item), isRequired, requiredCount, requiredPenaltyPoints)
        .run();
    const requestedAssignees = item.assignee_names || item.assigneeNames || [];
    await replaceAssignees(env, parentId, "task_assignees", "task_id", taskId, requestedAssignees.map((name) => childMap.get(name)).filter(Boolean));
    return { created: true, ignoredAssignments: requestedAssignees.filter((name) => !childMap.get(name)).length };
}
export async function importConfig(env, parentId, input) {
    await ensureFeedbackSchema(env);
    await ensureCriticismRemedySchema(env);
    const stats = {
        categories: { created: 0, skipped: 0 },
        tasks: { created: 0, skipped: 0 },
        rewards: { created: 0, skipped: 0 },
        achievements: { created: 0, skipped: 0 },
        feedbackTemplates: { created: 0, skipped: 0 }
    };
    stats.ignoredAssignments = 0;
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
        const result = await insertTaskFromConfig(env, parentId, item, categoryMap, childMap);
        stats.ignoredAssignments += Number(result?.ignoredAssignments || 0);
        if (result?.created)
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
        const requestedAssignees = item.assignee_names || item.assigneeNames || [];
        stats.ignoredAssignments += requestedAssignees.filter((name) => !childMap.get(name)).length;
        await replaceAssignees(env, parentId, "reward_assignees", "reward_id", rewardId, requestedAssignees.map((name) => childMap.get(name)).filter(Boolean));
        await replaceRewardPrerequisites(env, parentId, rewardId, item.prerequisites || []);
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
        const isRemediable = kind === "criticism" && Number(item.is_remediable ?? item.isRemediable ?? 0) === 1 ? 1 : 0;
        const points = Math.max(0, Number(item.points || 0));
        const remedyPoints = isRemediable ? Math.max(0, Math.min(points, Number(item.remedy_points ?? item.remedyPoints ?? 0))) : 0;
        const remedyDeadlineHours = isRemediable ? Math.max(1, Number(item.remedy_deadline_hours ?? item.remedyDeadlineHours ?? 24)) : 24;
        await env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id(), parentId, kind, title, item.description || "", points, item.icon_type || "emoji", item.icon_value || (kind === "praise" ? "✨" : "⚠️"), importedActive(item), isRemediable, isRemediable ? String(item.remedy_condition ?? item.remedyCondition ?? "").trim() : "", remedyPoints, remedyDeadlineHours)
            .run();
        stats.feedbackTemplates.created += 1;
    }
    return stats;
}
export async function childUsageForPeriod(env, table, idColumn, itemId, childId, periodKeyValue, activeStatuses) {
    const placeholders = activeStatuses.map(() => "?").join(",");
    const row = await env.DB.prepare(`SELECT COUNT(*) v FROM ${table} WHERE ${idColumn}=? AND child_id=? AND period_key=? AND status IN (${placeholders})`)
        .bind(itemId, childId, periodKeyValue, ...activeStatuses)
        .first();
    return Number(row?.v || 0);
}
export async function childUsageCountsForPeriods(env, table, idColumn, childId, itemPeriods, activeStatuses) {
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
export async function childLatestTaskStatuses(env, childId, itemPeriods) {
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
export async function notify(env, input) {
    await ensureOperatorAuditSchema(env);
    const createdAt = input.createdAt || nowIso();
    await env.DB.prepare("INSERT INTO notifications (id, recipient_type, recipient_id, actor_type, actor_id, actor_label_snapshot, title, body, event_type, related_type, related_id, requires_ack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id(), input.recipientType, input.recipientId, input.actorType, input.actorId || null, input.actorLabel || input.actorLabelSnapshot || "", input.title, input.body || "", input.eventType, input.relatedType || null, input.relatedId || null, input.requiresAck ? 1 : 0, createdAt)
        .run();
}
export function notificationRecipient(actor) {
    return actor.role === "child" ? { type: "child", id: actor.id } : { type: "user", id: actor.id };
}
export function eventTypeLabel(value) {
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
        criticism: "批评",
        task_required_penalty: "必做扣分"
    };
    return labels[value] || "消息";
}
export async function notificationSource(env, item) {
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
        const row = await env.DB.prepare("SELECT pl.source_type, pl.source_id, ft.title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id WHERE pl.id=?").bind(item.related_id).first();
        if (row?.title) {
            const label = row.source_type === "criticism" ? "批评" : "表扬";
            return { sourceTypeLabel: label, sourceLabel: `${label}：${row.title}` };
        }
        if (row?.source_type === "feedback_recall") {
            const original = await env.DB.prepare("SELECT pl.source_type, ft.title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id WHERE pl.id=?").bind(row.source_id).first();
            if (original?.title) {
                const label = original.source_type === "criticism" ? "批评" : "表扬";
                return { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}：${original.title}` };
            }
            if (original?.source_type) {
                const label = eventTypeLabel(original.source_type);
                return { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}` };
            }
        }
        if (row?.source_type === "task_required_penalty") {
            const taskRow = await env.DB.prepare("SELECT title FROM tasks WHERE id=?").bind(row.source_id).first();
            if (taskRow?.title)
                return { sourceTypeLabel: "必做扣分", sourceLabel: `任务：${taskRow.title}` };
            return { sourceTypeLabel: "必做扣分", sourceLabel: "必做扣分" };
        }
        if (row?.source_type) {
            const label = eventTypeLabel(row.source_type);
            return { sourceTypeLabel: label, sourceLabel: label };
        }
    }
    const fallback = eventTypeLabel(item.event_type);
    return { sourceTypeLabel: fallback, sourceLabel: fallback };
}
export async function withNotificationSources(env, rows) {
    return Promise.all(rows.map(async (item) => ({ ...item, actorLabel: item.actor_label_snapshot || "", ...(await notificationSource(env, item)) })));
}
export async function ledgerSource(env, row) {
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
        let label = row.source_type === "praise" ? "表扬" : "批评";
        if (row.source_type === "criticism" && row.freeze_status === "frozen") label = "批评冻结";
        if (row.source_type === "criticism" && row.freeze_status === "remedied") label = "批评补救";
        if (row.source_type === "criticism" && row.freeze_status === "settled") label = "批评结算";
        if (found?.title)
            return { sourceTypeLabel: label, sourceLabel: `${label}：${found.title}` };
        return { sourceTypeLabel: label, sourceLabel: label };
    }
    if (row.source_type === "task_required_penalty") {
        const found = await env.DB.prepare("SELECT title FROM tasks WHERE id=?").bind(row.source_id).first();
        if (found?.title)
            return { sourceTypeLabel: "必做扣分", sourceLabel: `任务：${found.title}` };
        return { sourceTypeLabel: "必做扣分", sourceLabel: "必做扣分" };
    }
    if (row.source_type === "feedback_recall") {
        const original = await env.DB.prepare("SELECT pl.source_type, ft.title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id WHERE pl.id=?").bind(row.source_id).first();
        if (original?.title) {
            const label = original.source_type === "criticism" ? "批评" : "表扬";
            return { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}撤回：${original.title}` };
        }
        if (original?.source_type) {
            const label = eventTypeLabel(original.source_type);
            return { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}撤回` };
        }
    }
    const fallback = eventTypeLabel(row.source_type);
    return { sourceTypeLabel: fallback, sourceLabel: fallback };
}
export async function withLedgerSources(env, rows, offset) {
    return Promise.all(rows.map(async (row) => ({
        ...row,
        actorLabel: row.actor_label_snapshot || "",
        localCreatedAt: localTimeText(row.created_at, offset),
        localRemedyDeadlineAt: row.remedy_deadline_at ? localTimeText(row.remedy_deadline_at, offset) : "",
        ...(await ledgerSource(env, row))
    })));
}
export function sessionCookie(value, env, request) {
    const proto = request?.headers?.get("x-forwarded-proto")
        || (request?.url ? new URL(request.url).protocol.replace(":", "") : "")
        || (env.APP_URL ? new URL(env.APP_URL).protocol.replace(":", "") : "http");
    const secure = proto === "https" ? "; Secure" : "";
    return `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${180 * 86400}${secure}`;
}
export function validateNonGetRequest(request, env) {
    if (request.method === "GET" || request.method === "HEAD") return;
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (!origin && !referer) {
        if (env.ENVIRONMENT === "production") throw fail("FORBIDDEN", "请求缺少来源信息", 403);
        return;
    }
    const url = new URL(request.url);
    const allowed = [url.origin];
    if (env.APP_URL) {
        try { allowed.push(new URL(env.APP_URL).origin); } catch {}
    }
    try {
        const sourceOrigin = new URL(origin || referer || "").origin;
        if (!allowed.includes(sourceOrigin)) throw fail("FORBIDDEN", "请求来源不允许", 403);
    } catch {
        throw fail("FORBIDDEN", "请求来源格式不正确", 403);
    }
}
export function isPrivateUrl(urlString) {
    try {
        const url = new URL(urlString);
        if (url.protocol !== "https:" && url.protocol !== "http:") return true;
        const h = url.hostname;
        if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127.")) return true;
        if (h.startsWith("10.")) return true;
        if (h.startsWith("172.")) {
            const second = parseInt(h.split(".")[1], 10);
            if (second >= 16 && second <= 31) return true;
        }
        if (h.startsWith("192.168.")) return true;
        if (h === "169.254.169.254" || h.startsWith("169.254.")) return true;
        if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".arpa")) return true;
        if (/^0x[0-9a-f]+/i.test(h) || /^0\d+/.test(h) || h.includes("%")) return true;
        return false;
    }
    catch {
        return true;
    }
}
