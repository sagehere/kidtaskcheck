import { nowIso, timezoneOffsetMinutes } from "../utils.js";
import { periodKey } from "../../../src/lib/domain.js";
import { previousCompletedReportRange } from "./orchestrator.js";
import { enqueueScheduledAiJobs, processAiGenerationQueue } from "./queue.js";
import { processCartoonReportJobs, processPrintChecklistImageJobs } from "./cartoon-queue.js";

const MINUTE_MS = 60000;

export async function ensureAiScheduledRefreshRuns(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_scheduled_refresh_runs (
  job_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  triggered_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (job_type, period_key)
)`).run();
}

function localParts(input, offset) {
    const date = new Date(new Date(input).getTime() + offset * MINUTE_MS);
    return {
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes()
    };
}

async function reserveRun(env, jobType, periodKey, triggeredAt) {
    await ensureAiScheduledRefreshRuns(env);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO ai_scheduled_refresh_runs
(job_type, period_key, status, triggered_at)
VALUES (?, ?, 'processing', ?)`)
        .bind(jobType, periodKey, triggeredAt)
        .run();
    return (result?.meta?.changes || 0) > 0;
}

async function completeRun(env, jobType, periodKey, result) {
    await env.DB.prepare(`UPDATE ai_scheduled_refresh_runs
SET status=?, success_count=?, failed_count=?, last_error=?, completed_at=?
WHERE job_type=? AND period_key=?`)
        .bind(result.failed > 0 ? "completed_with_errors" : "completed", result.success, result.failed, result.lastError || null, nowIso(), jobType, periodKey)
        .run();
}

async function activeAiChildren(env) {
    const rows = await env.DB.prepare(`SELECT id, parent_id, display_name, ai_enabled, gender, birth_date
FROM children
WHERE ai_enabled=1 AND deleted_at IS NULL
ORDER BY parent_id, created_at ASC`).all();
    return rows.results;
}

async function runJob(env, jobType, periodKey, triggeredAt, children, enqueueJobs) {
    const reserved = await reserveRun(env, jobType, periodKey, triggeredAt);
    if (!reserved) return { jobType, periodKey, skipped: true, enqueued: 0, existing: 0 };
    const result = await enqueueScheduledAiJobs(env, children, enqueueJobs);
    await completeRun(env, jobType, periodKey, { success: result.enqueued, failed: 0, lastError: "" });
    return { jobType, periodKey, skipped: false, ...result };
}

export async function runScheduledAiRefresh(env, scheduledAt = new Date()) {
    const offset = await timezoneOffsetMinutes(env);
    const triggeredAt = new Date(scheduledAt).toISOString();
    const parts = localParts(triggeredAt, offset);
    const queueRanges = {};
    const children = await activeAiChildren(env);
    if (parts.hour !== 0) {
        const queue = await processAiGenerationQueue(env, { offset });
        const cartoonQueue = await processCartoonReportJobs(env);
        const printChecklistQueue = await processPrintChecklistImageJobs(env);
        return { skipped: true, reason: "outside_midnight_window", jobs: [], queue, cartoonQueue, printChecklistQueue };
    }

    const jobs = [];
    const dailyKey = periodKey("daily", triggeredAt, offset);
    jobs.push(
        await runJob(env, "greeting_daily", dailyKey, triggeredAt, children, [
            { type: "greeting", periodKey: dailyKey }
        ])
    );
    if (parts.weekday === 1) {
        const weeklyRange = previousCompletedReportRange("weekly", triggeredAt, offset);
        queueRanges[`report_weekly:${weeklyRange.label}`] = weeklyRange;
        jobs.push(
            await runJob(env, "report_weekly", weeklyRange.label, triggeredAt, children, [
                { type: "report_weekly", periodKey: weeklyRange.label }
            ])
        );
    }
    if (parts.day === 1) {
        const monthlyRange = previousCompletedReportRange("monthly", triggeredAt, offset);
        queueRanges[`report_monthly:${monthlyRange.label}`] = monthlyRange;
        jobs.push(
            await runJob(env, "report_monthly", monthlyRange.label, triggeredAt, children, [
                { type: "report_monthly", periodKey: monthlyRange.label }
            ])
        );
    }

    const queue = await processAiGenerationQueue(env, { offset, ranges: queueRanges });
    const cartoonQueue = await processCartoonReportJobs(env);
    const printChecklistQueue = await processPrintChecklistImageJobs(env);
    return { skipped: jobs.length === 0, reason: jobs.length ? "" : "no_due_jobs", jobs, queue, cartoonQueue, printChecklistQueue };
}
