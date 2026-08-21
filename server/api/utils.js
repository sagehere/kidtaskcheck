import { DEFAULT_TIMEZONE_OFFSET_MINUTES, consecutiveDayStreak, consecutiveSameTaskStreak, daysWithoutEvents, inAchievementWindow, isWeekdayAllowed, nextPeriodReset, normalizeTaskSubmissionDeadline, normalizeWeekdays, periodKey, prerequisitePeriodKey, reportWindowRange, signedPoints } from "../../src/lib/domain.js";
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
export const DEFAULT_AI_JOB_RETENTION_DAYS = 92;
const onceByDb = new WeakMap();
export function oncePerDb(env, key, work) {
    let tasks = onceByDb.get(env.DB);
    if (!tasks) {
        tasks = new Map();
        onceByDb.set(env.DB, tasks);
    }
    const existing = tasks.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(work);
    tasks.set(key, pending);
    pending.catch(() => {
        if (tasks.get(key) === pending) tasks.delete(key);
    });
    return pending;
}
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
export function normalizeCompletionStandards(input) {
    const raw = Array.isArray(input) ? input : [];
    return raw
        .map((item) => ({
            label: String(item?.label || "").trim().slice(0, 40),
            points: Math.max(0, Math.min(999999, Number(item?.points || 0)))
        }))
        .filter((item) => item.label);
}
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
        throw fail("BAD_REQUEST", "请求体必须是有效 JSON", 400);
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
async function ensureParentDelegatesSchemaNow(env) {
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
async function ensureOperatorAuditSchemaNow(env) {
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
    await ensureColumn(env, "children", "daily_review_enabled", "daily_review_enabled INTEGER NOT NULL DEFAULT 1");
    await ensureColumn(env, "children", "daily_review_seconds", "daily_review_seconds INTEGER NOT NULL DEFAULT 30");
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
async function ensureParentAiServiceSettingsNow(env) {
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
    await ensureColumn(env, "parent_ai_service_settings", "schedule_image_prompt", "schedule_image_prompt TEXT NOT NULL DEFAULT ''");
}
export function ensureParentAiServiceSettings(env) {
    return oncePerDb(env, "parent-ai-service-settings", () => ensureParentAiServiceSettingsNow(env));
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
const DEFAULT_DAILY_REVIEW_SECONDS = 30;
const MAX_DAILY_REVIEW_SECONDS = 300;
function dailyReviewSeconds(value) {
    const seconds = Number(value);
    return Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_DAILY_REVIEW_SECONDS ? seconds : DEFAULT_DAILY_REVIEW_SECONDS;
}
async function childDailyReviewSettings(env, childId) {
    const child = await env.DB.prepare("SELECT daily_review_enabled, daily_review_seconds FROM children WHERE id=? AND deleted_at IS NULL")
        .bind(childId)
        .first();
    return { enabled: !!child && Number(child.daily_review_enabled) !== 0, seconds: dailyReviewSeconds(child?.daily_review_seconds) };
}
function dailyReviewWindow(offsetMinutes, at = nowIso()) {
    const local = new Date(new Date(at).getTime() + offsetMinutes * 60000);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth();
    const day = local.getUTCDate();
    const startMs = Date.UTC(year, month, day - 1) - offsetMinutes * 60000;
    const endMs = Date.UTC(year, month, day) - offsetMinutes * 60000;
    return {
        reviewDate: new Date(Date.UTC(year, month, day - 1)).toISOString().slice(0, 10),
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString()
    };
}
async function findOrCreateChildDailyReview(env, childId, offsetMinutes, at = nowIso()) {
    await ensureChildDailyReviewSchema(env);
    const window = dailyReviewWindow(offsetMinutes, at);
    await env.DB.prepare("INSERT OR IGNORE INTO child_daily_reviews (child_id, review_date, presented_at) VALUES (?, ?, ?)")
        .bind(childId, window.reviewDate, at)
        .run();
    const review = await env.DB.prepare("SELECT * FROM child_daily_reviews WHERE child_id=? AND review_date=?")
        .bind(childId, window.reviewDate)
        .first();
    return { ...window, review };
}
export async function childDailyReview(env, childId, offsetMinutes, at = nowIso(), resetCountdown = false) {
    const settings = await childDailyReviewSettings(env, childId);
    if (!settings.enabled)
        return null;
    const { reviewDate, start, end, review: existingReview } = await findOrCreateChildDailyReview(env, childId, offsetMinutes, at);
    let review = existingReview;
    if (review?.acknowledged_at)
        return null;
    if (resetCountdown) {
        await env.DB.prepare("UPDATE child_daily_reviews SET presented_at=? WHERE child_id=? AND review_date=? AND acknowledged_at IS NULL")
            .bind(at, childId, reviewDate)
            .run();
        review = await env.DB.prepare("SELECT * FROM child_daily_reviews WHERE child_id=? AND review_date=?")
            .bind(childId, reviewDate)
            .first();
        if (review?.acknowledged_at)
            return null;
    }
    const rows = (await env.DB.prepare(`SELECT * FROM point_ledger
WHERE child_id=? AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)
ORDER BY datetime(created_at) DESC, created_at DESC, id DESC`)
        .bind(childId, start, end)
        .all()).results;
    const notificationCount = Number((await env.DB.prepare(`SELECT COUNT(*) count FROM notifications
WHERE recipient_type='child' AND recipient_id=? AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)`)
        .bind(childId, start, end)
        .first())?.count || 0);
    const items = await withLedgerSources(env, rows, offsetMinutes);
    const totals = items.reduce((value, row) => {
        const amount = Number(row.amount || 0);
        value.gained += Math.max(0, amount);
        value.deducted += Math.max(0, -amount);
        value.net += amount;
        value.frozen += Math.max(0, Number(row.frozen_amount || 0));
        value.praiseCount += row.source_type === "praise" ? 1 : 0;
        return value;
    }, { gained: 0, deducted: 0, net: 0, frozen: 0, praiseCount: 0 });
    return {
        reviewDate,
        presentedAt: review.presented_at,
        acknowledgeAvailableAt: new Date(Date.parse(review.presented_at) + settings.seconds * 1000).toISOString(),
        timezoneLabel: timezoneLabel(offsetMinutes),
        totals,
        items,
        praiseItems: items.filter((row) => row.source_type === "praise"),
        notificationCount
    };
}
export async function childDailyReviewRequired(env, childId, offsetMinutes, at = nowIso()) {
    if (!(await childDailyReviewSettings(env, childId)).enabled)
        return false;
    const { review } = await findOrCreateChildDailyReview(env, childId, offsetMinutes, at);
    return !review?.acknowledged_at;
}
export async function acknowledgeChildDailyReview(env, childId, offsetMinutes, reviewDate, at = nowIso()) {
    const settings = await childDailyReviewSettings(env, childId);
    if (!settings.enabled)
        return { status: "acknowledged" };
    const current = await findOrCreateChildDailyReview(env, childId, offsetMinutes, at);
    if (String(reviewDate || "") !== current.reviewDate)
        return { status: "invalid" };
    if (current.review?.acknowledged_at)
        return { status: "acknowledged" };
    if (Date.parse(current.review.presented_at) + settings.seconds * 1000 > Date.parse(at))
        return { status: "countdown", acknowledgeAvailableAt: new Date(Date.parse(current.review.presented_at) + settings.seconds * 1000).toISOString() };
    await env.DB.batch([
        env.DB.prepare("UPDATE child_daily_reviews SET acknowledged_at=? WHERE child_id=? AND review_date=? AND acknowledged_at IS NULL")
            .bind(at, childId, current.reviewDate),
        env.DB.prepare(`UPDATE notifications SET read_at=?
WHERE recipient_type='child' AND recipient_id=? AND read_at IS NULL
  AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?)`)
            .bind(at, childId, current.start, current.end)
    ]);
    return { status: "acknowledged" };
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
async function tableExists(env, table) {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    return !!row;
}
export async function ensureConfigGroupsSchema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS config_groups (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, name)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_config_groups_parent ON config_groups(parent_id, updated_at DESC)").run();
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
async function ensureFeedbackSchemaNow(env) {
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
async function ensureCriticismRemedySchemaNow(env) {
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
async function ensureAchievementSchemaNow(env) {
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
    await ensureColumn(env, "child_achievements", "hidden_from_child_at", "hidden_from_child_at TEXT");
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
async function ensureRequiredTaskSchemaNow(env) {
    await ensureColumn(env, "tasks", "is_required", "is_required INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_count", "required_count INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_penalty_points", "required_penalty_points INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_remedy_enabled", "required_remedy_enabled INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_remedy_condition", "required_remedy_condition TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "tasks", "required_remedy_points", "required_remedy_points INTEGER NOT NULL DEFAULT 0");
    await ensureColumn(env, "tasks", "required_remedy_deadline_hours", "required_remedy_deadline_hours INTEGER NOT NULL DEFAULT 24");
    await ensureColumn(env, "tasks", "grading_mode", "grading_mode TEXT NOT NULL DEFAULT 'fixed'");
    await ensureColumn(env, "tasks", "completion_standards_json", "completion_standards_json TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn(env, "tasks", "submission_deadline_json", "submission_deadline_json TEXT NOT NULL DEFAULT 'null'");
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
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_submission_deadline_exemptions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, child_id, period_key)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_deadline_exemptions_child ON task_submission_deadline_exemptions(child_id, period_key)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_deadline_exemptions_parent ON task_submission_deadline_exemptions(parent_id, period_key)").run();
}
export async function ensureTaskSetSchema(env) {
    return oncePerDb(env, "task-set-schema", async () => {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_sets (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_type TEXT NOT NULL DEFAULT 'emoji',
  icon_value TEXT NOT NULL DEFAULT '🧩',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_set_members (
  task_set_id TEXT NOT NULL REFERENCES task_sets(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_set_id, task_id), UNIQUE(task_id)
)`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_set_settlements (
  id TEXT PRIMARY KEY, task_set_id TEXT NOT NULL REFERENCES task_sets(id),
  child_id TEXT NOT NULL REFERENCES children(id), parent_id TEXT NOT NULL REFERENCES users(id),
  round_number INTEGER NOT NULL, total_points INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_set_id, child_id, round_number)
)`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_set_settlement_items (
  settlement_id TEXT NOT NULL REFERENCES task_set_settlements(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES task_submissions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id), approved_points INTEGER NOT NULL,
  PRIMARY KEY (settlement_id, submission_id), UNIQUE(submission_id)
)`).run();
        await ensureColumn(env, "task_submissions", "task_set_id", "task_set_id TEXT REFERENCES task_sets(id)");
        await ensureColumn(env, "task_submissions", "approved_points", "approved_points INTEGER");
        await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_sets_parent ON task_sets(parent_id, is_active, deleted_at, created_at)").run();
        await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_set_members_set ON task_set_members(task_set_id, sort_order)").run();
        await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_task_set_items_submission ON task_set_settlement_items(submission_id)").run();
        await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_task_set_progress ON task_submissions(task_set_id, child_id, status, submitted_at)").run();
    });
}
export async function taskSetEligibleChildIds(env, parentId, taskIds) {
    if (!taskIds.length) return [];
    const placeholders = taskIds.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT ta.child_id
FROM task_assignees ta
JOIN tasks t ON t.id=ta.task_id
JOIN children c ON c.id=ta.child_id
WHERE t.parent_id=? AND t.id IN (${placeholders}) AND t.is_active=1 AND t.deleted_at IS NULL
  AND c.parent_id=? AND c.status='active' AND c.deleted_at IS NULL
GROUP BY ta.child_id HAVING COUNT(DISTINCT ta.task_id)=?`).bind(parentId, ...taskIds, parentId, taskIds.length).all()).results;
    return rows.map((row) => row.child_id);
}
export async function taskSetForSubmission(env, parentId, childId, taskId) {
    await ensureTaskSetSchema(env);
    const set = await env.DB.prepare(`SELECT ts.id, ts.title FROM task_sets ts
JOIN task_set_members m ON m.task_set_id=ts.id AND m.task_id=?
WHERE ts.parent_id=? AND ts.is_active=1 AND ts.deleted_at IS NULL`).bind(taskId, parentId).first();
    if (!set) return null;
    const eligible = await taskSetEligibleChildIds(env, parentId, (await env.DB.prepare("SELECT task_id FROM task_set_members WHERE task_set_id=? ORDER BY sort_order").bind(set.id).all()).results.map((row) => row.task_id));
    return eligible.includes(childId) ? set : null;
}
export async function taskSetHasOpenProgress(env, taskSetId) {
    await ensureTaskSetSchema(env);
    return !!(await env.DB.prepare(`SELECT 1 FROM task_submissions s
WHERE s.task_set_id=? AND (s.status='pending' OR (s.status='approved' AND NOT EXISTS (
  SELECT 1 FROM task_set_settlement_items i WHERE i.submission_id=s.id
))) LIMIT 1`).bind(taskSetId).first());
}
export async function listTaskSets(env, parentId) {
    await ensureTaskSetSchema(env);
    const sets = (await env.DB.prepare("SELECT * FROM task_sets WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(parentId).all()).results;
    if (!sets.length) return [];
    const ids = sets.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const members = (await env.DB.prepare(`SELECT m.task_set_id, m.task_id, m.sort_order, t.title, t.points, t.grading_mode, t.completion_standards_json
FROM task_set_members m JOIN tasks t ON t.id=m.task_id
WHERE m.task_set_id IN (${placeholders}) ORDER BY m.task_set_id, m.sort_order`).bind(...ids).all()).results;
    const bySet = new Map();
    for (const member of members) {
        const current = bySet.get(member.task_set_id) || [];
        current.push(member);
        bySet.set(member.task_set_id, current);
    }
    return Promise.all(sets.map(async (set) => {
        const rows = bySet.get(set.id) || [];
        const possible = rows.map((row) => {
            const standards = row.grading_mode === "completion" ? (() => { try { return normalizeCompletionStandards(JSON.parse(row.completion_standards_json || "[]")); } catch { return []; } })() : [];
            const points = standards.length ? standards.map((item) => item.points) : [Number(row.points || 0)];
            return { ...row, minPoints: Math.min(...points), maxPoints: Math.max(...points) };
        });
        return { ...set, members: possible, taskIds: rows.map((row) => row.task_id), eligibleChildIds: await taskSetEligibleChildIds(env, parentId, rows.map((row) => row.task_id)), minPoints: possible.reduce((sum, row) => sum + row.minPoints, 0), maxPoints: possible.reduce((sum, row) => sum + row.maxPoints, 0) };
    }));
}
export async function taskSetProgress(env, taskSetId, childId) {
    const members = (await env.DB.prepare("SELECT task_id FROM task_set_members WHERE task_set_id=? ORDER BY sort_order").bind(taskSetId).all()).results;
    if (!members.length) return { approved: 0, pending: 0, total: 0, settledRounds: 0 };
    const taskIds = members.map((row) => row.task_id);
    const placeholders = taskIds.map(() => "?").join(",");
    const [approvedRows, pendingRow, settledRow] = await Promise.all([
        env.DB.prepare(`SELECT s.task_id FROM task_submissions s
WHERE s.task_set_id=? AND s.child_id=? AND s.status='approved' AND s.task_id IN (${placeholders})
  AND NOT EXISTS (SELECT 1 FROM task_set_settlement_items i WHERE i.submission_id=s.id)
GROUP BY s.task_id`).bind(taskSetId, childId, ...taskIds).all(),
        env.DB.prepare(`SELECT COUNT(*) v FROM task_submissions WHERE task_set_id=? AND child_id=? AND status='pending'`).bind(taskSetId, childId).first(),
        env.DB.prepare("SELECT COUNT(*) v FROM task_set_settlements WHERE task_set_id=? AND child_id=?").bind(taskSetId, childId).first()
    ]);
    return { approved: approvedRows.results.length, pending: Number(pendingRow?.v || 0), total: taskIds.length, settledRounds: Number(settledRow?.v || 0) };
}
export async function settleTaskSetIfReady(env, submission, audit) {
    const taskSet = await env.DB.prepare("SELECT * FROM task_sets WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(submission.task_set_id, submission.parent_id).first();
    if (!taskSet) return { settled: false, taskSet: null, progress: { approved: 0, pending: 0, total: 0, settledRounds: 0 } };
    const members = (await env.DB.prepare("SELECT m.task_id, t.title FROM task_set_members m JOIN tasks t ON t.id=m.task_id WHERE m.task_set_id=? ORDER BY m.sort_order").bind(taskSet.id).all()).results;
    const selected = [];
    for (const member of members) {
        const row = await env.DB.prepare(`SELECT s.id, s.task_id, s.approved_points FROM task_submissions s
WHERE s.task_set_id=? AND s.child_id=? AND s.task_id=? AND s.status='approved'
  AND NOT EXISTS (SELECT 1 FROM task_set_settlement_items i WHERE i.submission_id=s.id)
ORDER BY s.reviewed_at, s.submitted_at, s.id LIMIT 1`).bind(taskSet.id, submission.child_id, member.task_id).first();
        if (!row) return { settled: false, taskSet, progress: await taskSetProgress(env, taskSet.id, submission.child_id) };
        selected.push({ ...row, title: member.title });
    }
    const round = Number((await env.DB.prepare("SELECT COUNT(*) v FROM task_set_settlements WHERE task_set_id=? AND child_id=?").bind(taskSet.id, submission.child_id).first())?.v || 0) + 1;
    const settlementId = id();
    const totalPoints = selected.reduce((sum, row) => sum + Number(row.approved_points || 0), 0);
    const detail = selected.map((row) => `${row.title} ${Number(row.approved_points || 0)}分`).join("、");
    await env.DB.prepare("INSERT INTO task_set_settlements (id, task_set_id, child_id, parent_id, round_number, total_points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(settlementId, taskSet.id, submission.child_id, submission.parent_id, round, totalPoints, nowIso()).run();
    for (const row of selected) {
        await env.DB.prepare("INSERT INTO task_set_settlement_items (settlement_id, submission_id, task_id, approved_points) VALUES (?, ?, ?, ?)")
            .bind(settlementId, row.id, row.task_id, Number(row.approved_points || 0)).run();
    }
    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, actor_type, actor_id, actor_label_snapshot) VALUES (?, ?, ?, ?, 'task_set', ?, NULL, ?, ?, ?, ?)")
        .bind(id(), submission.child_id, submission.parent_id, totalPoints, settlementId, `任务集结算：${taskSet.title}（${detail}）`, audit.type, audit.id, audit.label).run();
    return { settled: true, taskSet, settlementId, totalPoints, progress: await taskSetProgress(env, taskSet.id, submission.child_id) };
}
async function ensureChildScheduleSchemaNow(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS child_schedule_slots (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  start_minutes INTEGER NOT NULL CHECK(start_minutes>=0 AND start_minutes<1440),
  end_minutes INTEGER NOT NULL CHECK(end_minutes>0 AND end_minutes<=1440),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(end_minutes>start_minutes)
)`).run();
    await ensureColumn(env, "child_schedule_slots", "plan_html", "plan_html TEXT NOT NULL DEFAULT ''");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS child_schedule_items (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES child_schedule_slots(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_schedule_slots_child ON child_schedule_slots(child_id, sort_order)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_schedule_items_slot ON child_schedule_items(slot_id, sort_order)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_schedule_items_child_task ON child_schedule_items(child_id, task_id)").run();
}
async function ensureChildDailyReviewSchemaNow(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS child_daily_reviews (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL,
  presented_at TEXT NOT NULL,
  acknowledged_at TEXT,
  PRIMARY KEY (child_id, review_date)
)`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_child_daily_reviews_pending ON child_daily_reviews(child_id, acknowledged_at, review_date)").run();
}
export function ensureParentDelegatesSchema(env) {
    return oncePerDb(env, "parent-delegates-schema", () => ensureParentDelegatesSchemaNow(env));
}
export function ensureOperatorAuditSchema(env) {
    return oncePerDb(env, "operator-audit-schema", () => ensureOperatorAuditSchemaNow(env));
}
export function ensureFeedbackSchema(env) {
    return oncePerDb(env, "feedback-schema", () => ensureFeedbackSchemaNow(env));
}
export function ensureCriticismRemedySchema(env) {
    return oncePerDb(env, "criticism-remedy-schema", () => ensureCriticismRemedySchemaNow(env));
}
export function ensureAchievementSchema(env) {
    return oncePerDb(env, "achievement-schema", () => ensureAchievementSchemaNow(env));
}
export function ensureRequiredTaskSchema(env) {
    return oncePerDb(env, "required-task-schema", () => ensureRequiredTaskSchemaNow(env));
}
export function ensureChildScheduleSchema(env) {
    return oncePerDb(env, "child-schedule-schema", () => ensureChildScheduleSchemaNow(env));
}
export function ensureChildDailyReviewSchema(env) {
    return oncePerDb(env, "child-daily-review-schema", () => ensureChildDailyReviewSchemaNow(env));
}
const SESSION_DAYS = 180;
const REMEMBER_SESSION_DAYS = 3650;
const REMEMBER_SESSION_RENEW_AFTER_MS = 30 * 86400000;

export function sessionDurationDays(rememberMe = false) {
    return rememberMe ? REMEMBER_SESSION_DAYS : SESSION_DAYS;
}

export function sessionExpiresAt(rememberMe = false) {
    return new Date(Date.now() + sessionDurationDays(rememberMe) * 86400000).toISOString();
}

export function isRememberedSession(session) {
    return Date.parse(session?.expires_at || "") - Date.now() > (SESSION_DAYS + 30) * 86400000;
}

export async function renewRememberedSession(env, session) {
    if (!isRememberedSession(session)) return false;
    const remaining = Date.parse(session.expires_at) - Date.now();
    if (remaining > (REMEMBER_SESSION_DAYS * 86400000) - REMEMBER_SESSION_RENEW_AFTER_MS) return false;
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token=?")
        .bind(sessionExpiresAt(true), session.token)
        .run();
    return true;
}

export function sanitizeSchedulePlanHtml(value) {
    let html = String(value || "").slice(0, 5000);
    html = html.replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    html = html.replace(/<\s*\/?\s*([a-z0-9-]+)(?:\s[^>]*)?>/gi, (match, rawTag) => {
        const tag = String(rawTag || "").toLowerCase();
        const allowed = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"]);
        if (!allowed.has(tag)) return "";
        const closing = /^<\s*\//.test(match);
        if (tag === "br") return "<br>";
        return closing ? `</${tag}>` : `<${tag}>`;
    });
    return html.trim();
}

export function schedulePlanHtmlToText(value) {
    return String(value || "")
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\s*\/\s*(p|li)\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function ensureRetentionSchemaNow(env) {
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
('ai_job_retention_days', '92'),
('cleanup_last_run_at', ''),
('cleanup_last_stats_json', '{}')`).run();
}
async function ensureReportWindowIndexesNow(env) {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ledger_child_parent_created ON point_ledger(child_id, parent_id, created_at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ledger_child_parent_created_id ON point_ledger(child_id, parent_id, created_at, id)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_child_parent_submitted ON task_submissions(child_id, parent_id, submitted_at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_redemptions_child_parent_requested ON reward_redemptions(child_id, parent_id, requested_at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_child_achievements_child_unlocked ON child_achievements(child_id, unlocked_at)").run();
}
export function ensureRetentionSchema(env) {
    return oncePerDb(env, "retention-schema", () => ensureRetentionSchemaNow(env));
}
export function ensureReportWindowIndexes(env) {
    return oncePerDb(env, "report-window-indexes", () => ensureReportWindowIndexesNow(env));
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
WHERE source_type IN ('criticism', 'task_required_penalty')
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
export async function settleRequiredTaskPenalties(env, at = nowIso(), onlyChildId) {
    await ensureRequiredTaskSchema(env);
    await ensureCriticismRemedySchema(env);
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
    const businessAt = new Date(Date.parse(dailyReviewWindow(offset, at).end) - 1).toISOString();
    const shouldSettleDaily = hour >= 0;
    const shouldSettleWeekly = dayOfWeek === 1 && hour >= 0;
    const shouldSettleMonthly = dayOfMonth === 1 && hour >= 0;
    if (!shouldSettleDaily && !shouldSettleWeekly && !shouldSettleMonthly)
        return { settled: 0 };
    const tasks = env.DB.prepare(`SELECT t.id, t.parent_id, t.period, t.required_count, t.required_penalty_points, t.required_remedy_enabled, t.required_remedy_condition, t.required_remedy_points, t.required_remedy_deadline_hours, t.title, t.created_at, t.updated_at,
  ta.child_id
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
WHERE t.is_required=1
  AND t.required_count>0
  AND t.is_active=1
  AND t.deleted_at IS NULL${onlyChildId ? " AND ta.child_id=?" : ""}`);
    if (onlyChildId)
        tasks.bind(onlyChildId);
    const taskRows = (await tasks.all()).results;
    let settled = 0;
    for (const task of taskRows) {
        let periodKeyValue = null;
        if (task.period === "daily" && shouldSettleDaily)
            periodKeyValue = dailyKey;
        else if (task.period === "weekly" && shouldSettleWeekly)
            periodKeyValue = weeklyKey;
        else if (task.period === "monthly" && shouldSettleMonthly)
            periodKeyValue = monthlyKey;
        else
            continue;
        const activeFrom = task.updated_at || task.created_at;
        const activeFromKey = periodKey(task.period, activeFrom, offset);
        if (activeFrom && new Date(activeFrom).getTime() <= now.getTime() && activeFromKey > periodKeyValue)
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
                .bind(id(), task.id, task.child_id, task.parent_id, periodKeyValue, task.required_count, actualCount, businessAt)
                .run();
            settled++;
            continue;
        }
        const ledgerId = id();
        const remediable = Number(task.required_remedy_enabled || 0) === 1;
        const remedyPoints = remediable ? Math.min(actualPenalty, Math.max(0, Number(task.required_remedy_points || 0))) : 0;
        const remedyDeadlineHours = remediable ? Math.max(1, Number(task.required_remedy_deadline_hours || 24)) : 0;
        const remedyDeadlineAt = remediable ? new Date(new Date(at).getTime() + remedyDeadlineHours * 3600000).toISOString() : null;
        await env.DB.prepare(`INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, effective_amount, frozen_amount, freeze_status, remedy_condition, remedy_points, remedy_deadline_at, created_at)
VALUES (?, ?, ?, ?, 'task_required_penalty', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(ledgerId, task.child_id, task.parent_id, remediable ? 0 : -actualPenalty, task.id, periodKeyValue, `必做任务未达标扣分`, remediable ? 0 : -actualPenalty, remediable ? actualPenalty : 0, remediable ? "frozen" : "", remediable ? String(task.required_remedy_condition || "").trim() : "", remedyPoints, remedyDeadlineAt, businessAt)
            .run();
        await notify(env, {
            recipientType: "child",
            recipientId: task.child_id,
            actorType: "system",
            actorId: null,
            title: "必做任务未达标扣分",
            body: remediable ? `必做任务「${task.title}」未达标，冻结 ${actualPenalty} 积分；完成补救可挽回 ${remedyPoints} 积分。` : `必做任务「${task.title}」未达标，扣除 ${actualPenalty} 积分。`,
            eventType: "task_required_penalty",
            relatedType: "point_ledger",
            relatedId: ledgerId,
            createdAt: businessAt
        });
        await env.DB.prepare(`INSERT INTO task_required_penalties (id, task_id, child_id, parent_id, period_key, required_count, actual_count, penalty_points, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(id(), task.id, task.child_id, task.parent_id, periodKeyValue, task.required_count, actualCount, actualPenalty, businessAt)
            .run();
        await recalcAchievements(env, task.parent_id, task.child_id);
        settled++;
    }
    return { settled };
}
export async function activeRemedyCriticisms(env, childId, offset, at = nowIso()) {
    return activeRemedyItems(env, childId, offset, "criticism", at);
}
export async function activeRequiredPenaltyRemedies(env, childId, offset, at = nowIso()) {
    return activeRemedyItems(env, childId, offset, "task_required_penalty", at);
}
export async function activeRemedyItemsForChildren(env, children, offset, at = nowIso()) {
    if (!children.length) return [];
    const childIds = children.map((child) => child.id);
    const placeholders = childIds.map(() => "?").join(",");
    const names = new Map(children.map((child) => [child.id, child.display_name]));
    const rows = (await env.DB.prepare(`SELECT pl.*, COALESCE(ft.title, t.title) template_title
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON pl.source_type='criticism' AND ft.id=pl.source_id
LEFT JOIN tasks t ON pl.source_type='task_required_penalty' AND t.id=pl.source_id
WHERE pl.child_id IN (${placeholders})
  AND pl.source_type IN ('criticism', 'task_required_penalty')
  AND pl.freeze_status='frozen'
  AND pl.revoked_at IS NULL
  AND pl.remedied_at IS NULL
  AND pl.remedy_deadline_at>?
ORDER BY pl.remedy_deadline_at ASC`).bind(...childIds, at).all()).results;
    const nowMs = Date.parse(at);
    return rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        childId: row.child_id,
        childName: names.get(row.child_id) || "",
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
async function activeRemedyItems(env, childId, offset, sourceType, at) {
    const rows = (await env.DB.prepare(`SELECT pl.*, COALESCE(ft.title, t.title) template_title
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON pl.source_type='criticism' AND ft.id=pl.source_id
LEFT JOIN tasks t ON pl.source_type='task_required_penalty' AND t.id=pl.source_id
WHERE pl.child_id=?
  AND pl.source_type=?
  AND pl.freeze_status='frozen'
  AND pl.revoked_at IS NULL
  AND pl.remedied_at IS NULL
  AND pl.remedy_deadline_at>?
ORDER BY pl.remedy_deadline_at ASC`).bind(childId, sourceType, at).all()).results;
    const nowMs = Date.parse(at);
    return rows.map((row) => ({
        id: row.id,
        sourceType,
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
    return { refundedRedemptions: refunded.length, recalledLedgerEntries: recalled.length };
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
        await env.DB.prepare(`INSERT INTO activity_archives (
  id, parent_id, child_id, month_key, net_points, tasks_approved, tasks_rejected,
  rewards_requested, rewards_redeemed, rewards_cancelled, praise_count, criticism_count, achievements_unlocked, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(parent_id, child_id, month_key) DO UPDATE SET
  net_points=activity_archives.net_points + excluded.net_points,
  tasks_approved=activity_archives.tasks_approved + excluded.tasks_approved,
  tasks_rejected=activity_archives.tasks_rejected + excluded.tasks_rejected,
  rewards_requested=activity_archives.rewards_requested + excluded.rewards_requested,
  rewards_redeemed=activity_archives.rewards_redeemed + excluded.rewards_redeemed,
  rewards_cancelled=activity_archives.rewards_cancelled + excluded.rewards_cancelled,
  praise_count=activity_archives.praise_count + excluded.praise_count,
  criticism_count=activity_archives.criticism_count + excluded.criticism_count,
  achievements_unlocked=activity_archives.achievements_unlocked + excluded.achievements_unlocked,
  archived_at=excluded.archived_at`)
            .bind(archiveId, group.parent_id, group.child_id, group.month_key, Number(group.net_points || 0), Number(tasksApproved?.v || 0), Number(tasksRejected?.v || 0), Number(rewardsRequested?.v || 0), Number(rewardsRedeemed?.v || 0), Number(rewardsCancelled?.v || 0), Number(praiseCount?.v || 0), Number(criticismCount?.v || 0), Number(achievementsUnlocked?.v || 0), nowIso())
            .run();
        const ledger = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='activity_archive' AND source_id=?").bind(archiveId).first();
        if (ledger && Number(group.net_points || 0) !== 0) {
            await env.DB.prepare("UPDATE point_ledger SET amount=amount + ? WHERE id=?")
                .bind(Number(group.net_points || 0), ledger.id)
                .run();
        } else if (!ledger && Number(group.net_points || 0) !== 0) {
            await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, created_at) VALUES (?, ?, ?, ?, 'activity_archive', ?, ?, ?, ?)")
                .bind(id(), group.child_id, group.parent_id, Number(group.net_points || 0), archiveId, group.month_key, "Monthly activity archive", monthEnd)
                .run();
        }
    }
    const ledgerDelete = await env.DB.prepare("DELETE FROM point_ledger WHERE created_at<? AND source_type!='activity_archive'").bind(cutoffIso).run();
    await ensureTaskSetSchema(env);
    const submissionDelete = await env.DB.prepare(`DELETE FROM task_submissions
WHERE submitted_at<? AND status!='pending' AND (task_set_id IS NULL OR EXISTS (
  SELECT 1 FROM task_set_settlement_items i WHERE i.submission_id=task_submissions.id
))`).bind(cutoffIso).run();
    const redemptionDelete = await env.DB.prepare("DELETE FROM reward_redemptions WHERE requested_at<? AND status!='pending'").bind(cutoffIso).run();
    const notificationDelete = await env.DB.prepare("DELETE FROM notifications WHERE created_at<? AND read_at IS NOT NULL").bind(cutoffIso).run();
    return {
        archiveGroups: groups.length,
        archivedLedgerEntries: rows.length,
        deletedLedgerEntries: ledgerDelete?.meta?.changes || 0,
        deletedSubmissions: submissionDelete?.meta?.changes || 0,
        deletedRedemptions: redemptionDelete?.meta?.changes || 0,
        deletedNotifications: notificationDelete?.meta?.changes || 0
    };
}
export async function hardDeleteSoftDeleted(env, cutoffIso) {
    const expiredSessions = await env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(nowIso()).run();
    const taskCandidateSql = `SELECT id FROM tasks
WHERE deleted_at IS NOT NULL AND deleted_at<?
  AND NOT EXISTS (SELECT 1 FROM task_submissions WHERE task_id=tasks.id)
  AND NOT EXISTS (SELECT 1 FROM reward_prerequisites WHERE task_id=tasks.id)
  AND NOT EXISTS (SELECT 1 FROM achievements WHERE target_task_id=tasks.id)
  AND NOT EXISTS (SELECT 1 FROM task_required_penalties WHERE task_id=tasks.id)
  AND NOT EXISTS (SELECT 1 FROM child_schedule_items WHERE task_id=tasks.id)`;
    const taskAssignees = await env.DB.prepare(`DELETE FROM task_assignees WHERE task_id IN (${taskCandidateSql})`).bind(cutoffIso).run();
    const tasks = await env.DB.prepare(`DELETE FROM tasks WHERE id IN (${taskCandidateSql})`).bind(cutoffIso).run();
    const rewardCandidateSql = `SELECT id FROM rewards
WHERE deleted_at IS NOT NULL AND deleted_at<?
  AND NOT EXISTS (SELECT 1 FROM reward_redemptions WHERE reward_id=rewards.id)
  AND NOT EXISTS (SELECT 1 FROM achievements WHERE unlock_reward_id=rewards.id)`;
    const rewardAssignees = await env.DB.prepare(`DELETE FROM reward_assignees WHERE reward_id IN (${rewardCandidateSql})`).bind(cutoffIso).run();
    const rewardPrerequisites = await env.DB.prepare(`DELETE FROM reward_prerequisites WHERE reward_id IN (${rewardCandidateSql})`).bind(cutoffIso).run();
    const rewards = await env.DB.prepare(`DELETE FROM rewards WHERE id IN (${rewardCandidateSql})`).bind(cutoffIso).run();
    const achievements = await env.DB.prepare(`DELETE FROM achievements
WHERE deleted_at IS NOT NULL AND deleted_at<?
  AND NOT EXISTS (SELECT 1 FROM child_achievements WHERE achievement_id=achievements.id)`).bind(cutoffIso).run();
    const feedbackTemplates = await env.DB.prepare(`DELETE FROM feedback_templates
WHERE deleted_at IS NOT NULL AND deleted_at<?
  AND NOT EXISTS (SELECT 1 FROM point_ledger WHERE source_id=feedback_templates.id AND source_type IN ('praise', 'criticism', 'feedback_recall'))`).bind(cutoffIso).run();
    return {
        expiredSessions: expiredSessions?.meta?.changes || 0,
        taskAssignees: taskAssignees?.meta?.changes || 0,
        tasks: tasks?.meta?.changes || 0,
        rewardAssignees: rewardAssignees?.meta?.changes || 0,
        rewardPrerequisites: rewardPrerequisites?.meta?.changes || 0,
        rewards: rewards?.meta?.changes || 0,
        achievements: achievements?.meta?.changes || 0,
        feedbackTemplates: feedbackTemplates?.meta?.changes || 0
    };
}
export async function cleanupAiJobHistory(env, cutoffIso) {
    const cleanupJobs = [
        {
            table: "ai_generation_queue",
            sql: "DELETE FROM ai_generation_queue WHERE status IN ('completed', 'failed') AND COALESCE(completed_at, created_at)<?"
        },
        {
            table: "ai_scheduled_refresh_runs",
            sql: "DELETE FROM ai_scheduled_refresh_runs WHERE status IN ('completed', 'completed_with_errors', 'failed') AND COALESCE(completed_at, triggered_at)<?"
        },
        {
            table: "ai_cartoon_report_jobs",
            sql: "DELETE FROM ai_cartoon_report_jobs WHERE status IN ('completed', 'failed') AND COALESCE(completed_at, updated_at, created_at)<?"
        },
        {
            table: "ai_print_checklist_image_jobs",
            sql: "DELETE FROM ai_print_checklist_image_jobs WHERE status IN ('completed', 'failed') AND COALESCE(completed_at, updated_at, created_at)<?"
        },
        {
            table: "ai_schedule_image_jobs",
            sql: "DELETE FROM ai_schedule_image_jobs WHERE status IN ('completed', 'failed') AND COALESCE(completed_at, updated_at, created_at)<?"
        }
    ];
    const deleted = {};
    for (const job of cleanupJobs) {
        deleted[job.table] = 0;
        if (await tableExists(env, job.table)) {
            const result = await env.DB.prepare(job.sql).bind(cutoffIso).run();
            deleted[job.table] = result?.meta?.changes || 0;
        }
    }
    return deleted;
}
const AI_JOB_STAT_TABLES = [
    { key: "generationQueue", table: "ai_generation_queue", label: "AI text queue", createdColumn: "created_at", failureStatuses: ["failed"], terminalStatuses: ["completed", "failed"] },
    { key: "scheduledRefreshRuns", table: "ai_scheduled_refresh_runs", label: "Scheduled AI refresh", createdColumn: "triggered_at", failureStatuses: ["failed", "completed_with_errors"], terminalStatuses: ["completed", "completed_with_errors", "failed"] },
    { key: "cartoonReportJobs", table: "ai_cartoon_report_jobs", label: "Cartoon report images", createdColumn: "created_at", failureStatuses: ["failed"], terminalStatuses: ["completed", "failed"] },
    { key: "printChecklistImageJobs", table: "ai_print_checklist_image_jobs", label: "Print checklist images", createdColumn: "created_at", failureStatuses: ["failed"], terminalStatuses: ["completed", "failed"] },
    { key: "scheduleImageJobs", table: "ai_schedule_image_jobs", label: "Schedule images", createdColumn: "created_at", failureStatuses: ["failed"], terminalStatuses: ["completed", "failed"] }
];

function sqlStringList(values) {
    return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}

async function aiJobTableStats(env, spec, sinceIso) {
    if (!(await tableExists(env, spec.table))) {
        return { ...spec, exists: false, total: 0, backlog: 0, pending: 0, processing: 0, failedRecent: 0, terminalRecent: 0, failureRate: 0, statusCounts: {} };
    }
    const rows = (await env.DB.prepare(`SELECT status, COUNT(*) count FROM ${spec.table} GROUP BY status`).all()).results;
    const statusCounts = {};
    for (const row of rows) statusCounts[row.status] = Number(row.count || 0);
    const terminalList = sqlStringList(spec.terminalStatuses);
    const failureList = sqlStringList(spec.failureStatuses);
    const recent = await env.DB.prepare(`SELECT COUNT(*) terminal_count,
  COALESCE(SUM(CASE WHEN status IN (${failureList}) THEN 1 ELSE 0 END), 0) failed_count
FROM ${spec.table}
WHERE ${spec.createdColumn}>=? AND status IN (${terminalList})`).bind(sinceIso).first();
    const terminalRecent = Number(recent?.terminal_count || 0);
    const failedRecent = Number(recent?.failed_count || 0);
    const pending = Number(statusCounts.pending || 0);
    const processing = Number(statusCounts.processing || 0);
    return {
        ...spec,
        exists: true,
        total: Object.values(statusCounts).reduce((sum, value) => sum + Number(value || 0), 0),
        backlog: pending + processing,
        pending,
        processing,
        failedRecent,
        terminalRecent,
        failureRate: terminalRecent > 0 ? failedRecent / terminalRecent : 0,
        statusCounts
    };
}

export async function getMaintenanceStats(env) {
    await ensureRetentionSchema(env);
    await ensureReportWindowIndexes(env);
    const [detailDays, shortDays, aiJobDays, lastRun, lastStats] = await Promise.all([
        settingNumber(env, "detail_retention_days", 365),
        settingNumber(env, "short_record_retention_days", 7),
        settingNumber(env, "ai_job_retention_days", DEFAULT_AI_JOB_RETENTION_DAYS),
        env.DB.prepare("SELECT value FROM system_settings WHERE key='cleanup_last_run_at'").first(),
        env.DB.prepare("SELECT value FROM system_settings WHERE key='cleanup_last_stats_json'").first()
    ]);
    let parsedLastStats = {};
    try {
        parsedLastStats = lastStats?.value ? JSON.parse(lastStats.value) : {};
    } catch {
        parsedLastStats = {};
    }
    const sinceIso = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const queues = [];
    for (const spec of AI_JOB_STAT_TABLES) {
        queues.push(await aiJobTableStats(env, spec, sinceIso));
    }
    return {
        retentionDays: { detail: detailDays, shortRecord: shortDays, aiJob: aiJobDays },
        lastRunAt: lastRun?.value || "",
        lastRunStats: parsedLastStats,
        aiJobs: {
            since: sinceIso,
            queues,
            totalBacklog: queues.reduce((sum, item) => sum + Number(item.backlog || 0), 0),
            failedRecent: queues.reduce((sum, item) => sum + Number(item.failedRecent || 0), 0),
            terminalRecent: queues.reduce((sum, item) => sum + Number(item.terminalRecent || 0), 0)
        }
    };
}
export async function maybeRunMaintenance(env) {
    await ensureRetentionSchema(env);
    await ensureReportWindowIndexes(env);
    const last = await env.DB.prepare("SELECT value FROM system_settings WHERE key='cleanup_last_run_at'").first();
    const now = nowIso();
    if (last?.value && Date.parse(now) - Date.parse(last.value) < DAY_MS)
        return;
    const detailDays = await settingNumber(env, "detail_retention_days", 365);
    const shortDays = await settingNumber(env, "short_record_retention_days", 7);
    const aiJobDays = await settingNumber(env, "ai_job_retention_days", DEFAULT_AI_JOB_RETENTION_DAYS);
    const detailCutoff = new Date(Date.now() - detailDays * DAY_MS).toISOString();
    const shortCutoff = new Date(Date.now() - shortDays * DAY_MS).toISOString();
    const aiJobCutoff = new Date(Date.now() - aiJobDays * DAY_MS).toISOString();
    try {
        const shortRetention = await cleanupShortRetention(env, shortCutoff);
        const expiredCriticisms = await settleExpiredCriticismFreezes(env, now);
        const requiredPenalties = await settleRequiredTaskPenalties(env, now);
        const offset = await timezoneOffsetMinutes(env);
        const activityArchive = await archiveOldActivity(env, detailCutoff, offset);
        const softDeleted = await hardDeleteSoftDeleted(env, detailCutoff);
        const aiJobHistory = await cleanupAiJobHistory(env, aiJobCutoff);
        await cleanupSystemErrorLogs(env);
        const stats = {
            ranAt: now,
            retentionDays: { detail: detailDays, shortRecord: shortDays, aiJob: aiJobDays },
            cutoffs: { detail: detailCutoff, shortRecord: shortCutoff, aiJob: aiJobCutoff },
            shortRetention,
            expiredCriticisms,
            requiredPenalties,
            activityArchive,
            softDeleted,
            aiJobHistory
        };
        await updateSetting(env, "cleanup_last_stats_json", JSON.stringify(stats));
        await updateSetting(env, "cleanup_last_run_at", now);
        return stats;
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
export async function bootstrap(env) {
    return oncePerDb(env, "bootstrap", async () => {
        await ensureSystemSettings(env);
        await ensureSystemErrorLogs(env);
        await ensureAdmin(env);
        await ensureChildScheduleSchema(env);
        await ensureChildDailyReviewSchema(env);
        await maybeRunMaintenance(env);
    });
}
async function ensureRewardOnceSchemaNow(env) {
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
export function ensureRewardOnceSchema(env) {
    return oncePerDb(env, "reward-once-schema", () => ensureRewardOnceSchemaNow(env));
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
export async function lockedRewardIdsByAchievement(env, rewardIds, childId) {
    if (!rewardIds.length) return new Set();
    const placeholders = rewardIds.map(() => "?").join(",");
    const rows = (await env.DB.prepare(`SELECT a.unlock_reward_id
FROM achievements a
LEFT JOIN child_achievements ca ON ca.achievement_id=a.id AND ca.child_id=?
WHERE a.unlock_reward_id IN (${placeholders}) AND a.is_active=1 AND a.deleted_at IS NULL
GROUP BY a.unlock_reward_id
HAVING COUNT(*) > 0 AND SUM(CASE WHEN ca.unlocked_at IS NOT NULL THEN 1 ELSE 0 END)=0`)
        .bind(childId, ...rewardIds)
        .all()).results;
    return new Set(rows.map((row) => row.unlock_reward_id));
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
    const rows = await env.DB.prepare(`SELECT * FROM ${kind} WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC`).bind(parentId).all();
    const table = kind === "tasks" ? "task_assignees" : "reward_assignees";
    const key = kind === "tasks" ? "task_id" : "reward_id";
    const ids = rows.results.map((row) => row.id);
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(",");
    const [assignmentRows, prerequisiteRows, achievementRows, taskSetRows] = await Promise.all([
        env.DB.prepare(`SELECT ${key} item_id, child_id FROM ${table} WHERE ${key} IN (${placeholders})`).bind(...ids).all(),
        kind === "rewards"
            ? env.DB.prepare(`SELECT rp.reward_id, rp.task_id, rp.required_count, t.title, t.period
FROM reward_prerequisites rp JOIN tasks t ON t.id=rp.task_id
WHERE rp.reward_id IN (${placeholders}) ORDER BY t.created_at DESC`).bind(...ids).all()
            : { results: [] },
        kind === "rewards"
            ? env.DB.prepare(`SELECT id, title, unlock_reward_id FROM achievements
WHERE parent_id=? AND unlock_reward_id IN (${placeholders}) AND deleted_at IS NULL
ORDER BY updated_at DESC, created_at DESC`).bind(parentId, ...ids).all()
            : { results: [] },
        kind === "tasks"
            ? env.DB.prepare(`SELECT m.task_id, ts.id task_set_id, ts.title task_set_title, ts.is_active task_set_active
FROM task_set_members m JOIN task_sets ts ON ts.id=m.task_set_id
WHERE m.task_id IN (${placeholders}) AND ts.deleted_at IS NULL`).bind(...ids).all()
            : { results: [] }
    ]);
    const assignees = new Map();
    for (const row of assignmentRows.results) {
        const current = assignees.get(row.item_id) || [];
        current.push(row.child_id);
        assignees.set(row.item_id, current);
    }
    const prerequisites = new Map();
    for (const row of prerequisiteRows.results) {
        const current = prerequisites.get(row.reward_id) || [];
        current.push({ task_id: row.task_id, required_count: row.required_count, title: row.title, period: row.period });
        prerequisites.set(row.reward_id, current);
    }
    const requiredAchievements = new Map();
    for (const row of achievementRows.results) {
        if (!requiredAchievements.has(row.unlock_reward_id)) requiredAchievements.set(row.unlock_reward_id, row);
    }
    const taskSets = new Map(taskSetRows.results.map((row) => [row.task_id, row]));
    return rows.results.map((row) => {
        let completionStandards = [];
        try { completionStandards = normalizeCompletionStandards(JSON.parse(row.completion_standards_json || "[]")); }
        catch { completionStandards = []; }
        const requiredAchievement = requiredAchievements.get(row.id);
        return {
            ...row,
            enabledWeekdays: normalizeWeekdays(row.enabled_weekdays),
            redeemWeekdays: normalizeWeekdays(row.redeem_weekdays),
            completionStandards: kind === "tasks" ? completionStandards : [],
            submissionDeadline: kind === "tasks" ? normalizeTaskSubmissionDeadline(row.period, row.submission_deadline_json) : null,
            prerequisites: kind === "rewards" ? (prerequisites.get(row.id) || []) : [],
            requiredAchievementId: requiredAchievement?.id || "",
            requiredAchievementTitle: requiredAchievement?.title || "",
            assignees: assignees.get(row.id) || [],
            taskSetId: taskSets.get(row.id)?.task_set_id || "",
            taskSetTitle: taskSets.get(row.id)?.task_set_title || "",
            taskSetActive: Number(taskSets.get(row.id)?.task_set_active || 0)
        };
    });
}
export async function listConfig(env, parentId) {
    await Promise.all([ensureFeedbackSchema(env), ensureRequiredTaskSchema(env), ensureTaskSetSchema(env)]);
    const [categories, tasks, taskSets, rewards, achievements, feedbackTemplates] = await Promise.all([
        env.DB.prepare("SELECT * FROM task_categories WHERE is_active=1 AND ((is_system=1 AND id NOT IN (SELECT source_system_id FROM task_categories WHERE owner_id=? AND source_system_id IS NOT NULL)) OR owner_id=?) ORDER BY is_system DESC, created_at DESC").bind(parentId, parentId).all(),
        listWithAssignees(env, "tasks", parentId),
        listTaskSets(env, parentId),
        listWithAssignees(env, "rewards", parentId),
        env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(parentId).all(),
        env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(parentId).all()
    ]);
    return {
        categories: categories.results,
        tasks,
        taskSets,
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
    const requiredRemedyEnabled = isRequired && requiredPenaltyPoints > 0 && Number(item.required_remedy_enabled ?? item.requiredRemedyEnabled ?? 0) === 1 ? 1 : 0;
    const requiredRemedyCondition = requiredRemedyEnabled ? String(item.required_remedy_condition ?? item.requiredRemedyCondition ?? "").trim() : "";
    const requiredRemedyPoints = requiredRemedyEnabled ? Math.min(requiredPenaltyPoints, Math.max(0, Number(item.required_remedy_points ?? item.requiredRemedyPoints ?? 0))) : 0;
    const requiredRemedyDeadlineHours = requiredRemedyEnabled ? Math.max(1, Number(item.required_remedy_deadline_hours ?? item.requiredRemedyDeadlineHours ?? 24)) : 24;
    const gradingMode = item.grading_mode === "completion" || item.gradingMode === "completion" ? "completion" : "fixed";
    const completionStandards = gradingMode === "completion" ? normalizeCompletionStandards(item.completionStandards || item.completion_standards || JSON.parse(item.completion_standards_json || "[]")) : [];
    const submissionDeadline = normalizeTaskSubmissionDeadline(period, item.submissionDeadline ?? item.submission_deadline ?? item.submission_deadline_json);
    await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active, is_required, required_count, required_penalty_points, required_remedy_enabled, required_remedy_condition, required_remedy_points, required_remedy_deadline_hours, grading_mode, completion_standards_json, submission_deadline_json) VALUES (?, ?, ?, ?, ?, ?, 'earn', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(taskId, parentId, categoryId, title, item.description || "", period, Number(item.points || 0), item.icon_type || "emoji", item.icon_value || "✅", Math.max(1, Number(item.limit_count || item.limitCount || 1)), weekdayJson(item.enabledWeekdays || item.enabled_weekdays), importedActive(item), isRequired, requiredCount, requiredPenaltyPoints, requiredRemedyEnabled, requiredRemedyCondition, requiredRemedyPoints, requiredRemedyDeadlineHours, gradingMode, JSON.stringify(completionStandards), JSON.stringify(submissionDeadline))
        .run();
    const requestedAssignees = item.assignee_names || item.assigneeNames || [];
    await replaceAssignees(env, parentId, "task_assignees", "task_id", taskId, requestedAssignees.map((name) => childMap.get(name)).filter(Boolean));
    return { created: true, ignoredAssignments: requestedAssignees.filter((name) => !childMap.get(name)).length };
}
const CONFIG_GROUP_LIMIT = 5;

function configGroupName(input) {
    return String(input || "").trim().slice(0, 40);
}

function configSnapshotSummary(snapshot) {
    return {
        categories: Array.isArray(snapshot?.categories) ? snapshot.categories.length : 0,
        tasks: Array.isArray(snapshot?.tasks) ? snapshot.tasks.length : 0,
        taskSets: Array.isArray(snapshot?.taskSets) ? snapshot.taskSets.length : 0,
        rewards: Array.isArray(snapshot?.rewards) ? snapshot.rewards.length : 0,
        achievements: Array.isArray(snapshot?.achievements) ? snapshot.achievements.length : 0,
        feedbackTemplates: Array.isArray(snapshot?.feedbackTemplates) ? snapshot.feedbackTemplates.length : 0
    };
}

function parseConfigSnapshot(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}

async function activeChildrenForSnapshot(env, parentId) {
    const rows = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(parentId).all()).results;
    return {
        ids: new Set(rows.map((row) => row.id)),
        byName: new Map(rows.map((row) => [row.display_name, row.id]))
    };
}

function configSnapshotPayload(config, childNames) {
    const childName = (childId) => childNames.get(childId) || "";
    return {
        version: 1,
        capturedAt: nowIso(),
        categories: config.categories.map((item) => ({ ...item })),
        tasks: config.tasks.map((item) => ({
            ...item,
            assignee_names: (item.assignees || []).map(childName).filter(Boolean)
        })),
        taskSets: (config.taskSets || []).map((item) => ({ ...item, taskIds: item.taskIds || [] })),
        rewards: config.rewards.map((item) => ({
            ...item,
            assignee_names: (item.assignees || []).map(childName).filter(Boolean)
        })),
        achievements: config.achievements.map((item) => ({ ...item })),
        feedbackTemplates: config.feedbackTemplates.map((item) => ({ ...item }))
    };
}

export async function captureConfigGroupSnapshot(env, parentId) {
    await ensureConfigGroupsSchema(env);
    await ensureCategorySchema(env);
    await ensureRewardOnceSchema(env);
    await ensureAchievementSchema(env);
    await ensureFeedbackSchema(env);
    await ensureCriticismRemedySchema(env);
    const config = await listConfig(env, parentId);
    const children = (await env.DB.prepare("SELECT id, display_name FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(parentId).all()).results;
    const childNames = new Map(children.map((child) => [child.id, child.display_name]));
    return configSnapshotPayload(config, childNames);
}

function configGroupSummaryRow(row) {
    return {
        id: row.id,
        name: row.name,
        is_active: Number(row.is_active || 0),
        activated_at: row.activated_at || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        summary: configSnapshotSummary(parseConfigSnapshot(row.snapshot_json))
    };
}

export async function listConfigGroups(env, parentId) {
    await ensureConfigGroupsSchema(env);
    const rows = (await env.DB.prepare("SELECT * FROM config_groups WHERE parent_id=? ORDER BY is_active DESC, updated_at DESC, created_at DESC").bind(parentId).all()).results;
    return rows.map(configGroupSummaryRow);
}

export async function createConfigGroup(env, parentId, nameInput) {
    await ensureConfigGroupsSchema(env);
    const name = configGroupName(nameInput);
    if (!name) throw fail("BAD_REQUEST", "请输入配置组名称");
    const count = await env.DB.prepare("SELECT COUNT(*) v FROM config_groups WHERE parent_id=?").bind(parentId).first();
    if (Number(count?.v || 0) >= CONFIG_GROUP_LIMIT) throw fail("CONFIG_GROUP_LIMIT", "每个家长最多保存 5 个配置组", 409);
    const exists = await env.DB.prepare("SELECT id FROM config_groups WHERE parent_id=? AND name=?").bind(parentId, name).first();
    if (exists) throw fail("NAME_EXISTS", "配置组名称已存在", 409);
    const snapshot = await captureConfigGroupSnapshot(env, parentId);
    const groupId = id();
    const now = nowIso();
    await env.DB.prepare("INSERT INTO config_groups (id, parent_id, name, snapshot_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
        .bind(groupId, parentId, name, JSON.stringify(snapshot), now, now)
        .run();
    return configGroupSummaryRow(await env.DB.prepare("SELECT * FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first());
}

export async function renameConfigGroup(env, parentId, groupId, nameInput) {
    await ensureConfigGroupsSchema(env);
    const name = configGroupName(nameInput);
    if (!name) throw fail("BAD_REQUEST", "请输入配置组名称");
    const group = await env.DB.prepare("SELECT id FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first();
    if (!group) throw fail("NOT_FOUND", "配置组不存在", 404);
    const exists = await env.DB.prepare("SELECT id FROM config_groups WHERE parent_id=? AND name=? AND id<>?").bind(parentId, name, groupId).first();
    if (exists) throw fail("NAME_EXISTS", "配置组名称已存在", 409);
    await env.DB.prepare("UPDATE config_groups SET name=?, updated_at=? WHERE id=? AND parent_id=?").bind(name, nowIso(), groupId, parentId).run();
    return configGroupSummaryRow(await env.DB.prepare("SELECT * FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first());
}

export async function refreshConfigGroupSnapshot(env, parentId, groupId) {
    await ensureConfigGroupsSchema(env);
    const group = await env.DB.prepare("SELECT id FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first();
    if (!group) throw fail("NOT_FOUND", "配置组不存在", 404);
    const snapshot = await captureConfigGroupSnapshot(env, parentId);
    await env.DB.prepare("UPDATE config_groups SET snapshot_json=?, updated_at=? WHERE id=? AND parent_id=?")
        .bind(JSON.stringify(snapshot), nowIso(), groupId, parentId)
        .run();
    return configGroupSummaryRow(await env.DB.prepare("SELECT * FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first());
}

function snapshotAssignees(item, children) {
    const rawIds = Array.isArray(item.assignees) ? item.assignees : [];
    const rawNames = Array.isArray(item.assignee_names || item.assigneeNames) ? (item.assignee_names || item.assigneeNames) : [];
    const ids = [...rawIds, ...rawNames.map((name) => children.byName.get(name)).filter(Boolean)];
    const unique = [...new Set(ids)];
    return { valid: unique.filter((childId) => children.ids.has(childId)), skipped: unique.filter((childId) => !children.ids.has(childId)).length };
}

export async function applyConfigGroupSnapshot(env, parentId, snapshot) {
    await ensureCategorySchema(env);
    await ensureRewardOnceSchema(env);
    await Promise.all([ensureRequiredTaskSchema(env), ensureTaskSetSchema(env)]);
    await ensureAchievementSchema(env);
    await ensureFeedbackSchema(env);
    await ensureCriticismRemedySchema(env);
    const openTaskSet = await env.DB.prepare(`SELECT 1 FROM task_submissions s
JOIN task_sets ts ON ts.id=s.task_set_id
WHERE ts.parent_id=? AND ts.deleted_at IS NULL AND (s.status='pending' OR (s.status='approved' AND NOT EXISTS (
  SELECT 1 FROM task_set_settlement_items i WHERE i.submission_id=s.id
))) LIMIT 1`).bind(parentId).first();
    if (openTaskSet) throw fail("TASK_SET_IN_PROGRESS", "存在进行中的任务集，暂不能覆盖或清空配置", 409);
    const stats = { categories: 0, tasks: 0, taskSets: 0, rewards: 0, achievements: 0, feedbackTemplates: 0, skippedAssignments: 0 };
    const children = await activeChildrenForSnapshot(env, parentId);
    await env.DB.transaction(async () => {
        const now = nowIso();
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, updated_at=? WHERE parent_id=? AND deleted_at IS NULL").bind(now, now, parentId).run();
        await env.DB.prepare("UPDATE task_sets SET deleted_at=?, is_active=0, updated_at=? WHERE parent_id=? AND deleted_at IS NULL").bind(now, now, parentId).run();
        await env.DB.prepare("UPDATE rewards SET deleted_at=?, updated_at=? WHERE parent_id=? AND deleted_at IS NULL").bind(now, now, parentId).run();
        await env.DB.prepare("UPDATE achievements SET deleted_at=?, updated_at=? WHERE parent_id=? AND deleted_at IS NULL").bind(now, now, parentId).run();
        await env.DB.prepare("UPDATE feedback_templates SET deleted_at=?, updated_at=? WHERE parent_id=? AND deleted_at IS NULL").bind(now, now, parentId).run();
        await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE owner_id=? AND is_system=0 AND is_active=1").bind(parentId).run();
        const categoryMap = new Map();
        for (const item of snapshot.categories || []) {
            if (Number(item.is_system || 0) === 1) {
                const system = await env.DB.prepare("SELECT id FROM task_categories WHERE id=? AND is_system=1 AND is_active=1").bind(item.id).first();
                if (system) {
                    categoryMap.set(item.id, system.id);
                    continue;
                }
            }
            const categoryId = id();
            await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system, is_active) VALUES (?, ?, ?, ?, ?, 0, 1)")
                .bind(categoryId, parentId, String(item.name || "未命名分类").trim() || "未命名分类", item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || "⭐")
                .run();
            categoryMap.set(item.id, categoryId);
            stats.categories += 1;
        }
        const fallbackCategoryId = categoryMap.values().next().value;
        const taskMap = new Map();
        for (const item of snapshot.tasks || []) {
            const categoryId = categoryMap.get(item.category_id || item.categoryId) || fallbackCategoryId;
            if (!categoryId) continue;
            const period = item.period || "daily";
            const taskId = id();
            const isRequired = period !== "once" && Number(item.is_required ?? item.isRequired ?? 0) ? 1 : 0;
            const requiredCount = isRequired ? Math.max(1, Number(item.required_count ?? item.requiredCount ?? 1)) : 0;
            const requiredPenaltyPoints = isRequired ? Math.max(0, Number(item.required_penalty_points ?? item.requiredPenaltyPoints ?? 0)) : 0;
            const requiredRemedyEnabled = isRequired && requiredPenaltyPoints > 0 && Number(item.required_remedy_enabled ?? item.requiredRemedyEnabled ?? 0) === 1 ? 1 : 0;
            const requiredRemedyCondition = requiredRemedyEnabled ? String(item.required_remedy_condition ?? item.requiredRemedyCondition ?? "").trim() : "";
            const requiredRemedyPoints = requiredRemedyEnabled ? Math.min(requiredPenaltyPoints, Math.max(0, Number(item.required_remedy_points ?? item.requiredRemedyPoints ?? 0))) : 0;
            const requiredRemedyDeadlineHours = requiredRemedyEnabled ? Math.max(1, Number(item.required_remedy_deadline_hours ?? item.requiredRemedyDeadlineHours ?? 24)) : 24;
            const gradingMode = item.grading_mode === "completion" || item.gradingMode === "completion" ? "completion" : "fixed";
            const completionStandards = gradingMode === "completion" ? normalizeCompletionStandards(item.completionStandards || item.completion_standards || JSON.parse(item.completion_standards_json || "[]")) : [];
            const submissionDeadline = normalizeTaskSubmissionDeadline(period, item.submissionDeadline ?? item.submission_deadline ?? item.submission_deadline_json);
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active, is_required, required_count, required_penalty_points, required_remedy_enabled, required_remedy_condition, required_remedy_points, required_remedy_deadline_hours, grading_mode, completion_standards_json, submission_deadline_json) VALUES (?, ?, ?, ?, ?, ?, 'earn', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, parentId, categoryId, String(item.title || "未命名任务").trim() || "未命名任务", item.description || "", period, Number(item.points || 0), item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || "✅", Math.max(1, Number(item.limit_count ?? item.limitCount ?? 1)), weekdayJson(item.enabledWeekdays || item.enabled_weekdays), Number(item.is_active ?? item.isActive ?? 1) === 0 ? 0 : 1, isRequired, requiredCount, requiredPenaltyPoints, requiredRemedyEnabled, requiredRemedyCondition, requiredRemedyPoints, requiredRemedyDeadlineHours, gradingMode, JSON.stringify(completionStandards), JSON.stringify(submissionDeadline))
                .run();
            const assigned = snapshotAssignees(item, children);
            stats.skippedAssignments += assigned.skipped;
            await replaceAssignees(env, parentId, "task_assignees", "task_id", taskId, assigned.valid);
            taskMap.set(item.id, taskId);
            stats.tasks += 1;
        }
        for (const item of snapshot.taskSets || []) {
            const taskIds = (item.taskIds || []).map((taskId) => taskMap.get(taskId)).filter(Boolean);
            if (taskIds.length < 2 || !(await taskSetEligibleChildIds(env, parentId, taskIds)).length) continue;
            const taskSetId = id();
            await env.DB.prepare("INSERT INTO task_sets (id, parent_id, title, description, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, 'emoji', ?, ?)")
                .bind(taskSetId, parentId, String(item.title || "未命名任务集").trim() || "未命名任务集", item.description || "", item.icon_value || item.iconValue || "🧩", Number(item.is_active ?? item.isActive ?? 1) === 0 ? 0 : 1).run();
            for (let index = 0; index < taskIds.length; index++)
                await env.DB.prepare("INSERT INTO task_set_members (task_set_id, task_id, sort_order) VALUES (?, ?, ?)").bind(taskSetId, taskIds[index], index).run();
            stats.taskSets += 1;
        }
        const achievementMap = new Map();
        for (const item of snapshot.achievements || []) {
            const rule = normalizeAchievementInput({
                ...item,
                targetTaskId: taskMap.get(item.target_task_id || item.targetTaskId) || "",
                targetCategoryId: categoryMap.get(item.target_category_id || item.targetCategoryId) || ""
            });
            const achievementId = id();
            await env.DB.prepare("INSERT INTO achievements (id, parent_id, title, description, metric, threshold, icon_type, icon_value, rule_type, window_type, window_start, window_end, target_task_id, target_category_id, unlock_reward_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(achievementId, parentId, String(item.title || "未命名成就").trim() || "未命名成就", item.description || "", rule.metric, rule.threshold, item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, null)
                .run();
            achievementMap.set(item.id, achievementId);
            stats.achievements += 1;
        }
        for (const item of snapshot.rewards || []) {
            const rewardId = id();
            await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, redeem_weekdays, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(rewardId, parentId, String(item.title || "未命名奖励").trim() || "未命名奖励", item.description || "", Number(item.cost_points ?? item.costPoints ?? 0), item.stock ?? null, item.limit_period || item.limitPeriod || "daily", (item.limit_period || item.limitPeriod) === "once" ? 1 : item.limit_count ?? item.limitCount ?? 1, weekdayJson(item.redeemWeekdays || item.redeem_weekdays), item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || "🎁", Number(item.is_active ?? item.isActive ?? 1) === 0 ? 0 : 1)
                .run();
            const assigned = snapshotAssignees(item, children);
            stats.skippedAssignments += assigned.skipped;
            await replaceAssignees(env, parentId, "reward_assignees", "reward_id", rewardId, assigned.valid);
            const prerequisites = (item.prerequisites || []).map((prerequisite) => ({
                ...prerequisite,
                task_id: taskMap.get(prerequisite.task_id || prerequisite.taskId)
            })).filter((prerequisite) => prerequisite.task_id);
            await replaceRewardPrerequisites(env, parentId, rewardId, prerequisites);
            const requiredAchievementId = achievementMap.get(item.requiredAchievementId || item.required_achievement_id);
            if (requiredAchievementId) await replaceRewardAchievementRequirement(env, parentId, rewardId, requiredAchievementId);
            stats.rewards += 1;
        }
        for (const item of snapshot.feedbackTemplates || snapshot.feedback_templates || []) {
            const kind = item.kind === "criticism" ? "criticism" : "praise";
            const points = Math.max(0, Number(item.points || 0));
            const isRemediable = kind === "criticism" && Number(item.is_remediable ?? item.isRemediable ?? 0) === 1 ? 1 : 0;
            const remedyPoints = isRemediable ? Math.max(0, Math.min(points, Number(item.remedy_points ?? item.remedyPoints ?? 0))) : 0;
            const remedyDeadlineHours = isRemediable ? Math.max(1, Number(item.remedy_deadline_hours ?? item.remedyDeadlineHours ?? 24)) : 24;
            await env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), parentId, kind, String(item.title || "未命名条款").trim() || "未命名条款", item.description || "", points, item.icon_type || item.iconType || "emoji", item.icon_value || item.iconValue || (kind === "praise" ? "✨" : "⚠️"), Number(item.is_active ?? item.isActive ?? 1) === 0 ? 0 : 1, isRemediable, isRemediable ? String(item.remedy_condition ?? item.remedyCondition ?? "").trim() : "", remedyPoints, remedyDeadlineHours)
                .run();
            stats.feedbackTemplates += 1;
        }
    });
    return stats;
}

export async function clearCurrentConfig(env, parentId) {
    const current = await listConfig(env, parentId);
    const cleared = {
        categories: current.categories.filter((item) => Number(item.is_system || 0) === 0).length,
        tasks: current.tasks.length,
        taskSets: (current.taskSets || []).length,
        rewards: current.rewards.length,
        achievements: current.achievements.length,
        feedbackTemplates: current.feedbackTemplates.length
    };
    await applyConfigGroupSnapshot(env, parentId, {
        categories: [],
        tasks: [],
        taskSets: [],
        rewards: [],
        achievements: [],
        feedbackTemplates: []
    });
    return cleared;
}

export async function activateConfigGroup(env, parentId, groupId) {
    await ensureConfigGroupsSchema(env);
    const group = await env.DB.prepare("SELECT * FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first();
    if (!group) throw fail("NOT_FOUND", "配置组不存在", 404);
    const snapshot = parseConfigSnapshot(group.snapshot_json);
    const stats = await applyConfigGroupSnapshot(env, parentId, snapshot);
    const now = nowIso();
    await env.DB.prepare("UPDATE config_groups SET is_active=0 WHERE parent_id=?").bind(parentId).run();
    await env.DB.prepare("UPDATE config_groups SET is_active=1, activated_at=?, updated_at=? WHERE id=? AND parent_id=?").bind(now, now, groupId, parentId).run();
    return { ...configGroupSummaryRow(await env.DB.prepare("SELECT * FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).first()), applied: stats };
}

export async function deleteConfigGroup(env, parentId, groupId) {
    await ensureConfigGroupsSchema(env);
    const result = await env.DB.prepare("DELETE FROM config_groups WHERE id=? AND parent_id=?").bind(groupId, parentId).run();
    if ((result?.meta?.changes || 0) < 1) throw fail("NOT_FOUND", "配置组不存在", 404);
    return true;
}

export async function importConfig(env, parentId, input) {
    await ensureFeedbackSchema(env);
    await ensureCriticismRemedySchema(env);
    await ensureTaskSetSchema(env);
    const stats = {
        categories: { created: 0, skipped: 0 },
        tasks: { created: 0, skipped: 0 },
        taskSets: { created: 0, skipped: 0 },
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
    const taskRows = (await env.DB.prepare("SELECT id, title FROM tasks WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC")
        .bind(parentId)
        .all()).results;
    const taskMap = new Map(taskRows.map((task) => [task.title, task.id]));
    const taskMapByKey = new Map(taskRows.map((task) => [`${task.title}:${task.period}`, task.id]));
    for (const item of input.taskSets || []) {
        const title = String(item.title || "").trim();
        const exists = title ? await env.DB.prepare("SELECT 1 FROM task_sets WHERE parent_id=? AND title=? AND deleted_at IS NULL").bind(parentId, title).first() : true;
        const taskIds = (item.members || []).map((member) => taskMapByKey.get(`${member.title}:${member.period || "daily"}`) || taskMap.get(member.title)).filter(Boolean);
        if (exists || taskIds.length < 2 || new Set(taskIds).size !== taskIds.length) { stats.taskSets.skipped += 1; continue; }
        const occupied = await env.DB.prepare(`SELECT 1 FROM task_set_members WHERE task_id IN (${taskIds.map(() => "?").join(",")}) LIMIT 1`).bind(...taskIds).first();
        if (occupied) { stats.taskSets.skipped += 1; continue; }
        const taskSetId = id();
        await env.DB.prepare("INSERT INTO task_sets (id, parent_id, title, description, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, 'emoji', ?, 0)")
            .bind(taskSetId, parentId, title, item.description || "", item.icon_value || item.iconValue || "🧩").run();
        for (let index = 0; index < taskIds.length; index++)
            await env.DB.prepare("INSERT INTO task_set_members (task_set_id, task_id, sort_order) VALUES (?, ?, ?)").bind(taskSetId, taskIds[index], index).run();
        stats.taskSets.created += 1;
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
        const prerequisites = (item.prerequisites || []).map((prerequisite) => ({
            ...prerequisite,
            task_id: prerequisite.task_id || prerequisite.taskId || taskMap.get(prerequisite.task_title || prerequisite.taskTitle)
        }));
        await replaceRewardPrerequisites(env, parentId, rewardId, prerequisites);
        if (item.required_achievement_title || item.requiredAchievementTitle)
            pendingRewardRequirements.push({ rewardId, achievementTitle: item.required_achievement_title || item.requiredAchievementTitle });
        stats.rewards.created += 1;
    }
    for (const item of input.achievements || []) {
        const title = String(item.title || "").trim();
        const rule = normalizeAchievementInput({
            ...item,
            targetTaskId: taskMap.get(item.target_task_title || item.targetTaskTitle) || item.target_task_id || item.targetTaskId,
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
        task_required_penalty: "必做扣分",
        task_set_completed: "任务集",
        task_set: "任务集"
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

function sourceIds(rows, predicate, field) {
    return [...new Set(rows.filter(predicate).map((row) => row[field]).filter(Boolean))];
}

async function sourceMaps(env, input) {
    const maps = {
        tasksBySubmission: new Map(),
        rewardsByRedemption: new Map(),
        rewards: new Map(),
        feedbackTemplates: new Map(),
        tasks: new Map(),
        ledgers: new Map(),
        recallSources: new Map(),
        taskSetSettlements: new Map()
    };
    const load = async (ids, sql, target) => {
        if (!ids.length) return;
        const rows = (await env.DB.prepare(`${sql} IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results;
        for (const row of rows) target.set(row.id, row);
    };
    await Promise.all([
        load(input.taskSubmissionIds, "SELECT s.id, t.title, t.grading_mode, ts.title task_set_title FROM task_submissions s JOIN tasks t ON t.id=s.task_id LEFT JOIN task_sets ts ON ts.id=s.task_set_id WHERE s.id", maps.tasksBySubmission),
        load(input.rewardRedemptionIds, "SELECT rr.id, r.title FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id", maps.rewardsByRedemption),
        load(input.rewardIds, "SELECT id, title FROM rewards WHERE id", maps.rewards),
        load(input.templateIds, "SELECT id, title FROM feedback_templates WHERE id", maps.feedbackTemplates),
        load(input.taskIds, "SELECT id, title FROM tasks WHERE id", maps.tasks),
        load(input.ledgerIds, "SELECT pl.id, pl.source_type, pl.source_id, ft.title AS feedback_title, t.title AS task_title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id LEFT JOIN tasks t ON t.id=pl.source_id WHERE pl.id", maps.ledgers),
        load(input.recallIds, "SELECT pl.id, pl.source_type, ft.title FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id WHERE pl.id", maps.recallSources),
        load(input.taskSetSettlementIds || [], "SELECT ss.id, ts.title FROM task_set_settlements ss JOIN task_sets ts ON ts.id=ss.task_set_id WHERE ss.id", maps.taskSetSettlements)
    ]);
    return maps;
}

export async function withNotificationSources(env, rows) {
    const maps = await sourceMaps(env, {
        taskSubmissionIds: sourceIds(rows, (item) => item.related_type === "task_submission", "related_id"),
        rewardRedemptionIds: sourceIds(rows, (item) => item.related_type === "reward_redemption", "related_id"),
        rewardIds: sourceIds(rows, (item) => item.related_type === "reward", "related_id"),
        templateIds: [],
        taskIds: [],
        ledgerIds: sourceIds(rows, (item) => item.related_type === "point_ledger", "related_id"),
        recallIds: [],
        taskSetSettlementIds: sourceIds(rows, (item) => item.related_type === "task_set_settlement", "related_id")
    });
    const ledgerRows = [...maps.ledgers.values()];
    const recallIds = sourceIds(ledgerRows, (row) => row.source_type === "feedback_recall", "source_id");
    if (recallIds.length) {
        const recalls = await sourceMaps(env, { taskSubmissionIds: [], rewardRedemptionIds: [], rewardIds: [], templateIds: [], taskIds: [], ledgerIds: [], recallIds, taskSetSettlementIds: [] });
        maps.recallSources = recalls.recallSources;
    }
    return rows.map((item) => {
        let source = null;
        if (item.related_type === "task_submission") {
            const row = maps.tasksBySubmission.get(item.related_id);
            if (row?.title) source = row.task_set_title ? { sourceTypeLabel: "任务集", sourceLabel: `任务集：${row.task_set_title} / 子任务：${row.title}` } : { sourceTypeLabel: "任务", sourceLabel: `任务：${row.title}` };
        } else if (item.related_type === "reward_redemption") {
            const row = maps.rewardsByRedemption.get(item.related_id);
            if (row?.title) source = { sourceTypeLabel: "奖励", sourceLabel: `奖励：${row.title}` };
        } else if (item.related_type === "reward") {
            const row = maps.rewards.get(item.related_id);
            if (row?.title) source = { sourceTypeLabel: "奖励", sourceLabel: `奖励：${row.title}` };
        } else if (item.related_type === "task_set_settlement") {
            const row = maps.taskSetSettlements.get(item.related_id);
            if (row?.title) source = { sourceTypeLabel: "任务集", sourceLabel: `任务集：${row.title}` };
        } else if (item.related_type === "point_ledger") {
            const row = maps.ledgers.get(item.related_id);
            if (row?.feedback_title) {
                const label = row.source_type === "criticism" ? "批评" : "表扬";
                source = { sourceTypeLabel: label, sourceLabel: `${label}：${row.feedback_title}` };
            } else if (row?.source_type === "feedback_recall") {
                const original = maps.recallSources.get(row.source_id);
                if (original?.title) {
                    const label = original.source_type === "criticism" ? "批评" : "表扬";
                    source = { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}：${original.title}` };
                } else if (original?.source_type) {
                    const label = eventTypeLabel(original.source_type);
                    source = { sourceTypeLabel: `${label}撤回`, sourceLabel: label };
                }
            } else if (row?.source_type === "task_required_penalty") {
                source = row.task_title ? { sourceTypeLabel: "必做扣分", sourceLabel: `任务：${row.task_title}` } : { sourceTypeLabel: "必做扣分", sourceLabel: "必做扣分" };
            } else if (row?.source_type) {
                const label = eventTypeLabel(row.source_type);
                source = { sourceTypeLabel: label, sourceLabel: label };
            }
        }
        const fallback = eventTypeLabel(item.event_type);
        const taskSubmission = item.related_type === "task_submission" ? maps.tasksBySubmission.get(item.related_id) : null;
        return { ...item, actorLabel: item.actor_label_snapshot || "", requiresCompletionSelection: taskSubmission?.grading_mode === "completion", ...(source || { sourceTypeLabel: fallback, sourceLabel: fallback }) };
    });
}
export async function ledgerSource(env, row) {
    if (row.source_type === "task_set") {
        const found = await env.DB.prepare("SELECT ts.title FROM task_set_settlements ss JOIN task_sets ts ON ts.id=ss.task_set_id WHERE ss.id=?").bind(row.source_id).first();
        if (found?.title) return { sourceTypeLabel: "任务集", sourceLabel: `任务集：${found.title}` };
    }
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
        const label = Number(row.amount) > 0 ? "必做扣分退回" : row.freeze_status === "frozen" ? "必做扣分冻结" : row.freeze_status === "remedied" ? "必做补救" : row.freeze_status === "settled" ? "必做扣分结算" : "必做扣分";
        if (found?.title)
            return { sourceTypeLabel: label, sourceLabel: `任务：${found.title}` };
        return { sourceTypeLabel: label, sourceLabel: label };
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
    const maps = await sourceMaps(env, {
        taskSubmissionIds: sourceIds(rows, (row) => row.source_type === "task", "source_id"),
        rewardRedemptionIds: sourceIds(rows, (row) => ["reward", "reward_cancel", "reward_refund"].includes(row.source_type), "source_id"),
        rewardIds: [],
        templateIds: sourceIds(rows, (row) => row.source_type === "praise" || row.source_type === "criticism", "source_id"),
        taskIds: sourceIds(rows, (row) => row.source_type === "task_required_penalty", "source_id"),
        ledgerIds: [],
        recallIds: sourceIds(rows, (row) => row.source_type === "feedback_recall", "source_id"),
        taskSetSettlementIds: sourceIds(rows, (row) => row.source_type === "task_set", "source_id")
    });
    return rows.map((row) => {
        let source = null;
        if (row.source_type === "task") {
            const found = maps.tasksBySubmission.get(row.source_id);
            if (found?.title) source = { sourceTypeLabel: "任务", sourceLabel: `任务：${found.title}` };
        } else if (["reward", "reward_cancel", "reward_refund"].includes(row.source_type)) {
            const found = maps.rewardsByRedemption.get(row.source_id);
            if (found?.title) source = { sourceTypeLabel: row.source_type === "reward" ? "奖励兑换" : "奖励退还", sourceLabel: `奖励：${found.title}` };
        } else if (row.source_type === "praise" || row.source_type === "criticism") {
            let label = row.source_type === "praise" ? "表扬" : "批评";
            if (row.source_type === "criticism" && row.freeze_status === "frozen") label = "批评冻结";
            if (row.source_type === "criticism" && row.freeze_status === "remedied") label = "批评补救";
            if (row.source_type === "criticism" && row.freeze_status === "settled") label = "批评结算";
            const found = maps.feedbackTemplates.get(row.source_id);
            source = found?.title ? { sourceTypeLabel: label, sourceLabel: `${label}：${found.title}` } : { sourceTypeLabel: label, sourceLabel: label };
        } else if (row.source_type === "task_required_penalty") {
            const label = Number(row.amount) > 0 ? "必做扣分退回" : row.freeze_status === "frozen" ? "必做扣分冻结" : row.freeze_status === "remedied" ? "必做补救" : row.freeze_status === "settled" ? "必做扣分结算" : "必做扣分";
            const found = maps.tasks.get(row.source_id);
            source = found?.title ? { sourceTypeLabel: label, sourceLabel: `任务：${found.title}` } : { sourceTypeLabel: label, sourceLabel: label };
        } else if (row.source_type === "task_set") {
            const found = maps.taskSetSettlements.get(row.source_id);
            source = found?.title ? { sourceTypeLabel: "任务集", sourceLabel: `任务集：${found.title}` } : { sourceTypeLabel: "任务集", sourceLabel: "任务集" };
        } else if (row.source_type === "feedback_recall") {
            const original = maps.recallSources.get(row.source_id);
            if (original?.title) {
                const label = original.source_type === "criticism" ? "批评" : "表扬";
                source = { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}撤回：${original.title}` };
            } else if (original?.source_type) {
                const label = eventTypeLabel(original.source_type);
                source = { sourceTypeLabel: `${label}撤回`, sourceLabel: `${label}撤回` };
            }
        }
        const fallback = eventTypeLabel(row.source_type);
        return {
            ...row,
            actorLabel: row.actor_label_snapshot || "",
            localCreatedAt: localTimeText(row.created_at, offset),
            localRemedyDeadlineAt: row.remedy_deadline_at ? localTimeText(row.remedy_deadline_at, offset) : "",
            ...(source || { sourceTypeLabel: fallback, sourceLabel: fallback })
        };
    });
}
export function sessionCookie(value, env, request, maxAgeDays = SESSION_DAYS) {
    const proto = request?.headers?.get("x-forwarded-proto")
        || (request?.url ? new URL(request.url).protocol.replace(":", "") : "")
        || (env.APP_URL ? new URL(env.APP_URL).protocol.replace(":", "") : "http");
    const secure = proto === "https" ? "; Secure" : "";
    return `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeDays * 86400}${secure}`;
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
