import { id, nowIso, ensureColumn, logSystemError, timezoneOffsetMinutes } from "../utils.js";
import { generateCartoonReportImage } from "./orchestrator.js";
import { NonRetryableError } from "./orchestrator.js";
import { AiProviderError } from "./providers.js";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_LOCK_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const MINUTE_MS = 60_000;

export async function ensureAiCartoonReportJobs(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_cartoon_report_jobs (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK(period_type IN ('weekly', 'monthly')),
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  error_code TEXT,
  image_url TEXT,
  format TEXT NOT NULL DEFAULT 'jpeg',
  filename TEXT NOT NULL DEFAULT '',
  prompt_preview TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  next_attempt_at TEXT,
  locked_until TEXT,
  UNIQUE(parent_id, child_id, period_type, period_key)
)`).run();
    await ensureColumn(env, "ai_cartoon_report_jobs", "error_code", "error_code TEXT");
    await ensureColumn(env, "ai_cartoon_report_jobs", "next_attempt_at", "next_attempt_at TEXT");
    await ensureColumn(env, "ai_cartoon_report_jobs", "locked_until", "locked_until TEXT");
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_cartoon_jobs_ready ON ai_cartoon_report_jobs(status, next_attempt_at, created_at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_cartoon_jobs_parent ON ai_cartoon_report_jobs(parent_id, child_id, period_type, period_key)").run();
}

export function publicCartoonJob(row) {
    if (!row) return null;
    return {
        id: row.id,
        childId: row.child_id,
        period: row.period_type,
        periodKey: row.period_key,
        status: row.status,
        retryCount: Number(row.retry_count || 0),
        lastError: row.last_error || "",
        imageUrl: row.image_url || "",
        format: row.format || "jpeg",
        filename: row.filename || "",
        promptPreview: row.prompt_preview || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at || ""
    };
}

export async function enqueueCartoonReportJob(env, { parentId, childId, periodType, periodKey, resetFailed = false }) {
    await ensureAiCartoonReportJobs(env);
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO ai_cartoon_report_jobs
(id, parent_id, child_id, period_type, period_key, status, retry_count, max_retries, created_at, updated_at, next_attempt_at)
VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
ON CONFLICT(parent_id, child_id, period_type, period_key) DO UPDATE SET
  status=CASE WHEN ai_cartoon_report_jobs.status='failed' AND ? THEN 'pending' ELSE ai_cartoon_report_jobs.status END,
  retry_count=CASE WHEN ai_cartoon_report_jobs.status='failed' AND ? THEN 0 ELSE ai_cartoon_report_jobs.retry_count END,
  last_error=CASE WHEN ai_cartoon_report_jobs.status='failed' AND ? THEN NULL ELSE ai_cartoon_report_jobs.last_error END,
  error_code=CASE WHEN ai_cartoon_report_jobs.status='failed' AND ? THEN NULL ELSE ai_cartoon_report_jobs.error_code END,
  next_attempt_at=CASE WHEN ai_cartoon_report_jobs.status='failed' AND ? THEN excluded.next_attempt_at ELSE ai_cartoon_report_jobs.next_attempt_at END,
  updated_at=excluded.updated_at`)
        .bind(id(), parentId, childId, periodType, periodKey, DEFAULT_MAX_RETRIES, now, now, now, resetFailed ? 1 : 0, resetFailed ? 1 : 0, resetFailed ? 1 : 0, resetFailed ? 1 : 0, resetFailed ? 1 : 0)
        .run();
    return env.DB.prepare("SELECT * FROM ai_cartoon_report_jobs WHERE parent_id=? AND child_id=? AND period_type=? AND period_key=?")
        .bind(parentId, childId, periodType, periodKey)
        .first();
}

export async function loadCartoonReportJob(env, parentId, jobId) {
    await ensureAiCartoonReportJobs(env);
    return env.DB.prepare("SELECT * FROM ai_cartoon_report_jobs WHERE id=? AND parent_id=?").bind(jobId, parentId).first();
}

function retryDelayMs(retryCount) {
    return RETRY_DELAYS_MS[Math.min(Math.max(retryCount, 0), RETRY_DELAYS_MS.length - 1)];
}

function errorInfo(error) {
    if (error instanceof NonRetryableError) return { code: error.message || "NON_RETRYABLE", message: error.message || "non retryable", retryable: false };
    if (error instanceof AiProviderError) return { code: error.code || "AI_PROVIDER_ERROR", message: error.message || "AI provider error", retryable: !!error.retryable };
    return { code: "AI_CARTOON_REPORT_ERROR", message: String(error?.message || error || "cartoon report failed"), retryable: true };
}

async function reserveNextCartoonJob(env, now, lockMs) {
    await ensureAiCartoonReportJobs(env);
    await env.DB.prepare(`UPDATE ai_cartoon_report_jobs
SET status='pending', locked_until=NULL
WHERE status='processing' AND locked_until IS NOT NULL AND locked_until<?`).bind(now).run();
    const job = await env.DB.prepare(`SELECT * FROM ai_cartoon_report_jobs
WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
ORDER BY created_at ASC
LIMIT 1`).bind(now).first();
    if (!job) return null;
    const lockUntil = new Date(Date.parse(now) + lockMs).toISOString();
    const result = await env.DB.prepare(`UPDATE ai_cartoon_report_jobs
SET status='processing', started_at=?, locked_until=?, updated_at=?
WHERE id=? AND status='pending'`).bind(now, lockUntil, now, job.id).run();
    if ((result?.meta?.changes || 0) < 1) return null;
    return { ...job, status: "processing", started_at: now, locked_until: lockUntil };
}

async function loadChild(env, job) {
    return env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
        .bind(job.child_id, job.parent_id)
        .first();
}

function utcFromLocalDate(year, monthIndex, day, offset) {
    return new Date(Date.UTC(year, monthIndex, day) - offset * MINUTE_MS);
}

function rangeFromPeriodKey(periodType, periodKey, offset) {
    if (periodType === "monthly") {
        const match = String(periodKey || "").match(/^(\d{4})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        return {
            start: utcFromLocalDate(year, monthIndex, 1, offset).toISOString(),
            end: utcFromLocalDate(year, monthIndex + 1, 1, offset).toISOString(),
            label: periodKey
        };
    }
    const match = String(periodKey || "").match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Weekday = jan4.getUTCDay() || 7;
    const monday = new Date(Date.UTC(year, 0, 4 - jan4Weekday + 1 + (week - 1) * 7));
    return {
        start: utcFromLocalDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), offset).toISOString(),
        end: utcFromLocalDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 7, offset).toISOString(),
        label: periodKey
    };
}

async function completeJob(env, job, result) {
    const now = nowIso();
    await env.DB.prepare(`UPDATE ai_cartoon_report_jobs
SET status='completed', last_error=NULL, error_code=NULL, image_url=?, format=?, filename=?, prompt_preview=?, locked_until=NULL, completed_at=?, updated_at=?
WHERE id=?`)
        .bind(result.imageUrl, result.format || "jpeg", result.filename || "", result.promptPreview || "", now, now, job.id)
        .run();
}

async function failJob(env, job, info) {
    const retryCount = Number(job.retry_count || 0) + 1;
    const maxRetries = Number(job.max_retries || DEFAULT_MAX_RETRIES);
    const canRetry = info.retryable && retryCount < maxRetries;
    const status = canRetry ? "pending" : "failed";
    const now = nowIso();
    const nextAttemptAt = canRetry ? new Date(Date.now() + retryDelayMs(retryCount - 1)).toISOString() : null;
    await env.DB.prepare(`UPDATE ai_cartoon_report_jobs
SET status=?, retry_count=?, error_code=?, last_error=?, next_attempt_at=?, locked_until=NULL, completed_at=?, updated_at=?
WHERE id=?`)
        .bind(status, retryCount, info.code, info.message.slice(0, 500), nextAttemptAt, status === "failed" ? now : null, now, job.id)
        .run();
    if (status === "failed") {
        await logSystemError(env, {
            source: "ai_cartoon_report_queue",
            message: info.message,
            status: 500,
            metadata: { jobId: job.id, parentId: job.parent_id, childId: job.child_id, periodType: job.period_type, periodKey: job.period_key, errorCode: info.code }
        });
    }
    return canRetry;
}

export async function processCartoonReportJobs(env, { maxJobs = undefined, lockMs = DEFAULT_LOCK_MS } = {}) {
    const limit = Number.isFinite(Number(maxJobs)) ? Number(maxJobs) : Number(env.AI_CARTOON_QUEUE_MAX_JOBS || 2);
    const stats = { processed: 0, completed: 0, failed: 0, retried: 0, empty: false };
    for (let index = 0; index < limit; index++) {
        const job = await reserveNextCartoonJob(env, nowIso(), lockMs);
        if (!job) {
            stats.empty = true;
            break;
        }
        stats.processed++;
        try {
            const child = await loadChild(env, job);
            if (!child) throw new NonRetryableError("child_missing");
            const offset = await timezoneOffsetMinutes(env);
            const range = rangeFromPeriodKey(job.period_type, job.period_key, offset);
            if (!range) throw new NonRetryableError("invalid_period_key");
            const result = await generateCartoonReportImage(env, child, job.period_type, range);
            await completeJob(env, job, result);
            stats.completed++;
        } catch (error) {
            const retrying = await failJob(env, job, errorInfo(error));
            if (retrying) stats.retried++;
            else stats.failed++;
        }
    }
    return stats;
}
