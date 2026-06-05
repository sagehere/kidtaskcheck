import { nowIso, id, ensureColumn, logSystemError } from "../utils.js";
import { generateParentAiGreeting, generateReportCommentary, NonRetryableError } from "./orchestrator.js";
import { AiProviderError } from "./providers.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_LOCK_MS = 5 * 60_000;
const MINUTE_MS = 60_000;

export async function ensureAiGenerationQueue(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_generation_queue (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  type TEXT NOT NULL CHECK(type IN ('greeting', 'report_weekly', 'report_monthly')),
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
)`).run();
    await ensureColumn(env, "ai_generation_queue", "error_code", "error_code TEXT");
    await ensureColumn(env, "ai_generation_queue", "next_attempt_at", "next_attempt_at TEXT");
    await ensureColumn(env, "ai_generation_queue", "locked_until", "locked_until TEXT");
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_queue_unique_job ON ai_generation_queue(parent_id, child_id, type, period_key)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_queue_ready ON ai_generation_queue(status, next_attempt_at, created_at)").run();
}

export async function enqueueAiGenerationJob(env, { parentId, childId, type, periodKey }) {
    await ensureAiGenerationQueue(env);
    const createdAt = nowIso();
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO ai_generation_queue
(id, parent_id, child_id, type, period_key, status, retry_count, max_retries, created_at, next_attempt_at)
VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
        .bind(id(), parentId, childId, type, periodKey, DEFAULT_MAX_RETRIES, createdAt, createdAt)
        .run();
    return (result?.meta?.changes || 0) > 0;
}

export async function enqueueScheduledAiJobs(env, children, jobs) {
    let enqueued = 0;
    let existing = 0;
    for (const child of children) {
        for (const job of jobs) {
            const created = await enqueueAiGenerationJob(env, {
                parentId: child.parent_id,
                childId: child.id,
                type: job.type,
                periodKey: job.periodKey
            });
            if (created) enqueued++;
            else existing++;
        }
    }
    return { enqueued, existing };
}

function retryDelayMs(retryCount) {
    return RETRY_DELAYS_MS[Math.min(Math.max(retryCount, 0), RETRY_DELAYS_MS.length - 1)];
}

function errorInfo(error) {
    if (error instanceof NonRetryableError) {
        return { code: error.message || "NON_RETRYABLE", message: error.message || "non retryable", retryable: false };
    }
    if (error instanceof AiProviderError) {
        return { code: error.code || "AI_PROVIDER_ERROR", message: error.message || "AI provider error", retryable: !!error.retryable };
    }
    return { code: "AI_GENERATION_ERROR", message: String(error?.message || error || "AI generation failed"), retryable: true };
}

function utcFromLocalDate(year, monthIndex, day, offset) {
    return new Date(Date.UTC(year, monthIndex, day) - offset * MINUTE_MS);
}

function rangeFromPeriodKey(type, periodKey, offset) {
    if (type === "report_monthly") {
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

async function reserveNextJob(env, now, lockMs) {
    await ensureAiGenerationQueue(env);
    await env.DB.prepare(`UPDATE ai_generation_queue
SET status='pending', locked_until=NULL
WHERE status='processing' AND locked_until IS NOT NULL AND locked_until<?`)
        .bind(now)
        .run();
    const job = await env.DB.prepare(`SELECT * FROM ai_generation_queue
WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
ORDER BY created_at ASC
LIMIT 1`)
        .bind(now)
        .first();
    if (!job) return null;
    const lockUntil = new Date(Date.parse(now) + lockMs).toISOString();
    const result = await env.DB.prepare(`UPDATE ai_generation_queue
SET status='processing', started_at=?, locked_until=?
WHERE id=? AND status='pending'`)
        .bind(now, lockUntil, job.id)
        .run();
    if ((result?.meta?.changes || 0) < 1) return null;
    return { ...job, status: "processing", started_at: now, locked_until: lockUntil };
}

async function loadChild(env, job) {
    return env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
        .bind(job.child_id, job.parent_id)
        .first();
}

async function runJob(env, job, offset, ranges) {
    const child = await loadChild(env, job);
    if (!child) throw new NonRetryableError("child_missing");
    const aiOptions = { throwOnError: true };
    if (job.type === "greeting") {
        return generateParentAiGreeting(env, child, offset, true, { ai: aiOptions });
    }
    const periodType = job.type === "report_monthly" ? "monthly" : "weekly";
    return generateReportCommentary(env, child, periodType, job.period_key, offset, true, {
        range: ranges?.[`${job.type}:${job.period_key}`] || rangeFromPeriodKey(job.type, job.period_key, offset),
        ai: aiOptions
    });
}

async function completeJob(env, job, generated) {
    await env.DB.prepare(`UPDATE ai_generation_queue
SET status='completed', last_error=NULL, error_code=NULL, locked_until=NULL, completed_at=?
WHERE id=?`)
        .bind(nowIso(), job.id)
        .run();
    return !!generated;
}

async function failJob(env, job, info) {
    const retryCount = Number(job.retry_count || 0) + 1;
    const maxRetries = Number(job.max_retries || DEFAULT_MAX_RETRIES);
    const canRetry = info.retryable && retryCount < maxRetries;
    const status = canRetry ? "pending" : "failed";
    const nextAttemptAt = canRetry ? new Date(Date.now() + retryDelayMs(retryCount - 1)).toISOString() : null;
    await env.DB.prepare(`UPDATE ai_generation_queue
SET status=?, retry_count=?, error_code=?, last_error=?, next_attempt_at=?, locked_until=NULL, completed_at=?
WHERE id=?`)
        .bind(status, retryCount, info.code, info.message.slice(0, 500), nextAttemptAt, status === "failed" ? nowIso() : null, job.id)
        .run();
    if (status === "failed") {
        await logSystemError(env, {
            source: "ai_queue",
            message: info.message,
            stack: "",
            status: 500,
            metadata: {
                queueId: job.id,
                parentId: job.parent_id,
                childId: job.child_id,
                type: job.type,
                periodKey: job.period_key,
                errorCode: info.code,
                retryCount
            }
        });
    }
    return canRetry;
}

function sleep(ms) {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function processAiGenerationQueue(env, { offset = 480, ranges = {}, maxJobs = undefined, intervalMs = undefined, lockMs = DEFAULT_LOCK_MS } = {}) {
    const limit = Number.isFinite(Number(maxJobs)) ? Number(maxJobs) : Number(env.AI_QUEUE_MAX_JOBS || 20);
    const delay = Number.isFinite(Number(intervalMs)) ? Number(intervalMs) : Number(env.AI_QUEUE_INTERVAL_MS ?? (env.ENVIRONMENT === "test" ? 0 : 2000));
    const stats = { processed: 0, completed: 0, failed: 0, retried: 0, empty: false };
    for (let index = 0; index < limit; index++) {
        const job = await reserveNextJob(env, nowIso(), lockMs);
        if (!job) {
            stats.empty = true;
            break;
        }
        stats.processed++;
        try {
            const generated = await runJob(env, job, offset, ranges);
            await completeJob(env, job, generated);
            stats.completed++;
        } catch (error) {
            const retrying = await failJob(env, job, errorInfo(error));
            if (retrying) stats.retried++;
            else stats.failed++;
        }
        if (index < limit - 1) await sleep(delay);
    }
    return stats;
}
