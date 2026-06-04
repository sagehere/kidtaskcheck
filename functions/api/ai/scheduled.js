import { nowIso, timezoneOffsetMinutes } from "../utils.js";
import { generateParentAiGreeting, generateReportCommentary, previousCompletedReportRange } from "./orchestrator.js";

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

async function generateForChildren(env, children, generate) {
    let success = 0;
    let failed = 0;
    let lastError = "";
    for (const child of children) {
        try {
            const result = await generate(child);
            if (result) success++;
            else failed++;
        } catch (error) {
            failed++;
            lastError = String(error?.message || error).slice(0, 200);
        }
    }
    return { success, failed, lastError };
}

async function runJob(env, jobType, periodKey, triggeredAt, generate) {
    const reserved = await reserveRun(env, jobType, periodKey, triggeredAt);
    if (!reserved) return { jobType, periodKey, skipped: true, success: 0, failed: 0 };
    const children = await activeAiChildren(env);
    const result = await generateForChildren(env, children, generate);
    await completeRun(env, jobType, periodKey, result);
    return { jobType, periodKey, skipped: false, ...result };
}

export async function runScheduledAiRefresh(env, scheduledAt = new Date()) {
    const offset = await timezoneOffsetMinutes(env);
    const triggeredAt = new Date(scheduledAt).toISOString();
    const parts = localParts(triggeredAt, offset);
    if (parts.hour !== 0) return { skipped: true, reason: "outside_midnight_window", jobs: [] };

    const jobs = [];
    if (parts.weekday === 1) {
        const weeklyRange = previousCompletedReportRange("weekly", triggeredAt, offset);
        jobs.push(
            await runJob(env, "greeting_weekly", weeklyRange.label, triggeredAt, (child) =>
                generateParentAiGreeting(env, child, offset, true)
            )
        );
        jobs.push(
            await runJob(env, "report_weekly", weeklyRange.label, triggeredAt, (child) =>
                generateReportCommentary(env, child, "weekly", weeklyRange.label, offset, true, { range: weeklyRange })
            )
        );
    }
    if (parts.day === 1) {
        const monthlyRange = previousCompletedReportRange("monthly", triggeredAt, offset);
        jobs.push(
            await runJob(env, "report_monthly", monthlyRange.label, triggeredAt, (child) =>
                generateReportCommentary(env, child, "monthly", monthlyRange.label, offset, true, { range: monthlyRange })
            )
        );
    }

    return { skipped: jobs.length === 0, reason: jobs.length ? "" : "no_due_jobs", jobs };
}
