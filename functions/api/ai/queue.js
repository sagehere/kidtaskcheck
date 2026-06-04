import { reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, id, timezoneOffsetMinutes } from "../utils.js";
import { generateParentAiGreeting, generateReportCommentary, NonRetryableError } from "./orchestrator.js";

export const AI_REFRESH_DELAY_MS = 2000;
export const AI_REFRESH_COOLDOWN_MS = 30000;
export const AI_REFRESH_MAX_RETRIES = 3;
export const AI_QUEUE_BATCH_SIZE = 5;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_queue_status ON ai_generation_queue(status, created_at)").run();
}

export async function enqueueAiGeneration(env, parentId, childId, type, periodKey) {
    const now = nowIso();
    await ensureAiGenerationQueue(env);
    await env.DB.prepare("INSERT OR IGNORE INTO ai_generation_queue (id, parent_id, child_id, type, period_key, status, retry_count, max_retries, last_error, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, NULL, ?)")
        .bind(id(), parentId, childId, type, periodKey, now)
        .run();
}

export async function processAiQueue(env) {
    await ensureAiGenerationQueue(env);
    const offset = await timezoneOffsetMinutes(env);
    const pending = await env.DB.prepare("SELECT * FROM ai_generation_queue WHERE status='pending' ORDER BY created_at ASC LIMIT ?")
        .bind(AI_QUEUE_BATCH_SIZE)
        .all();
    if (!pending.results.length) return { processed: 0, failed: 0 };
    let processed = 0;
    let failed = 0;
    for (const item of pending.results) {
        try {
            await env.DB.prepare("UPDATE ai_generation_queue SET status='processing', started_at=? WHERE id=?")
                .bind(nowIso(), item.id)
                .run();
            const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND deleted_at IS NULL")
                .bind(item.child_id)
                .first();
            if (!child) {
                await env.DB.prepare("UPDATE ai_generation_queue SET status='failed', last_error='child_not_found', completed_at=? WHERE id=?")
                    .bind(nowIso(), item.id)
                    .run();
                failed++;
                continue;
            }
            let result = "";
            if (item.type === "greeting") {
                result = await generateParentAiGreeting(env, child, offset, true);
            } else if (item.type.startsWith("report_")) {
                const periodType = item.type === "report_monthly" ? "monthly" : "weekly";
                result = await generateReportCommentary(env, child, periodType, item.period_key, offset, true);
            }
            if (result) {
                await env.DB.prepare("UPDATE ai_generation_queue SET status='completed', completed_at=? WHERE id=?")
                    .bind(nowIso(), item.id)
                    .run();
                processed++;
            } else {
                if (item.retry_count >= item.max_retries) {
                    await env.DB.prepare("UPDATE ai_generation_queue SET status='failed', last_error='max_retries_exceeded', completed_at=? WHERE id=?")
                        .bind(nowIso(), item.id)
                        .run();
                    failed++;
                } else {
                    await env.DB.prepare("UPDATE ai_generation_queue SET status='pending', retry_count=retry_count+1 WHERE id=?")
                        .bind(item.id)
                        .run();
                    failed++;
                }
            }
        }
        catch (error) {
            const isNonRetryable = error instanceof NonRetryableError;
            const lastError = String(error?.message || error).slice(0, 200);
            if (isNonRetryable || item.retry_count >= item.max_retries) {
                await env.DB.prepare("UPDATE ai_generation_queue SET status='failed', last_error=?, completed_at=? WHERE id=?")
                    .bind(lastError, nowIso(), item.id)
                    .run();
            } else {
                await env.DB.prepare("UPDATE ai_generation_queue SET status='pending', retry_count=retry_count+1 WHERE id=?")
                    .bind(item.id)
                    .run();
            }
            failed++;
        }
        if (pending.results[pending.results.length - 1]?.id !== item.id)
            await sleep(AI_REFRESH_DELAY_MS);
    }
    return { processed, failed };
}

export async function getAiQueueStatus(env, parentId) {
    await ensureAiGenerationQueue(env);
    const [pending, processing, completed, errored] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as c FROM ai_generation_queue WHERE parent_id=? AND status='pending'").bind(parentId).first(),
        env.DB.prepare("SELECT COUNT(*) as c FROM ai_generation_queue WHERE parent_id=? AND status='processing'").bind(parentId).first(),
        env.DB.prepare("SELECT COUNT(*) as c FROM ai_generation_queue WHERE parent_id=? AND status='completed'").bind(parentId).first(),
        env.DB.prepare("SELECT COUNT(*) as c FROM ai_generation_queue WHERE parent_id=? AND status='failed'").bind(parentId).first(),
    ]);
    return {
        pending: pending?.c || 0,
        processing: processing?.c || 0,
        completed: completed?.c || 0,
        failed: errored?.c || 0,
    };
}

export async function refreshParentAiGreetings(env, offset, parentId) {
    const children = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE ai_enabled=1 AND deleted_at IS NULL AND parent_id=?").bind(parentId).all();
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
                const greeting = await generateParentAiGreeting(env, child, offset, true);
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

export async function refreshParentReportCommentaries(env, offset, parentId, periodType) {
    const children = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE ai_enabled=1 AND deleted_at IS NULL AND parent_id=?").bind(parentId).all();
    if (!children.results.length) return { success: 0, failed: 0 };
    const now = nowIso();
    const range = reportWindowRange(periodType, now, offset);
    const periodKey = range.label;
    let successCount = 0;
    let failCount = 0;
    for (const child of children.results) {
        try {
            const commentary = await generateReportCommentary(env, child, periodType, periodKey, offset, true);
            if (commentary) successCount++;
            else failCount++;
        }
        catch {
            failCount++;
        }
        await sleep(AI_REFRESH_DELAY_MS);
    }
    return { success: successCount, failed: failCount };
}

