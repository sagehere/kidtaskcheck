import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, DAY_MS, balance } from "../utils.js";
import { getParentAiServiceConfig, aiConfigHash, aiReportConfigHash, loadAiGreetingSnapshot } from "./cache.js";
import { buildAiPrompt, buildReportAiPrompt, previousWeekReportSummary } from "./prompt.js";
import { callParentAiService, callParentAiServiceForReport } from "./providers.js";

export class NonRetryableError extends Error {
    constructor(message) {
        super(message);
        this.name = "NonRetryableError";
    }
}

export async function generateParentAiGreeting(env, child, offset, forceRefresh = false) {
    if (!child.ai_enabled)
        throw new NonRetryableError("ai_disabled");
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
        throw new NonRetryableError("ai_config_incomplete");
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
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare("SELECT kind, title, points, is_active, description FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(child.parent_id).all(),
    ]);
    const assignments = { tasks: assignedTasks.results, rewards: assignedRewards.results, feedbackTemplates: feedbackTemplates.results };
    const aiPrompt = buildAiPrompt(child, report, config, assignments);
    if (!aiPrompt)
        return "";
    const greeting = await callParentAiService(env, aiPrompt, config);
    if (greeting) {
        await env.DB.prepare("INSERT OR REPLACE INTO ai_child_greetings (child_id, previous_week_key, config_hash, greeting, generated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(child.id, weekKey, hash, greeting, now)
            .run();
    }
    return greeting;
}

export async function generateReportCommentary(env, child, periodType, periodKey, offset, forceRefresh = false) {
    if (!child?.ai_enabled) throw new NonRetryableError("ai_disabled");
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model) throw new NonRetryableError("ai_config_incomplete");
    const hash = aiReportConfigHash(config, periodType);
    const now = nowIso();
    const cached = await env.DB.prepare("SELECT commentary FROM ai_report_commentaries WHERE child_id=? AND period_key=? AND period_type=? AND config_hash=?")
        .bind(child.id, periodKey, periodType, hash)
        .first();
    if (cached?.commentary && !forceRefresh) return cached.commentary;
    const range = reportWindowRange(periodType, now, offset);
    const [ledgerRows, taskRows, rewardRows, feedbackRows, achievementRows, assignedTasks, assignedRewards, feedbackTemplates] = await Promise.all([
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND parent_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC")
            .bind(child.id, child.parent_id, range.start, range.end).all(),
        env.DB.prepare(`SELECT s.*, t.title, tc.name category_name
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE s.child_id=? AND s.parent_id=? AND s.submitted_at>=? AND s.submitted_at<? ORDER BY s.submitted_at DESC`)
            .bind(child.id, child.parent_id, range.start, range.end).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.requested_at>=? AND rr.requested_at<? ORDER BY rr.requested_at DESC`)
            .bind(child.id, child.parent_id, range.start, range.end).all(),
        env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<? ORDER BY pl.created_at DESC`)
            .bind(child.id, child.parent_id, range.start, range.end).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND a.parent_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<? ORDER BY ca.unlocked_at DESC`)
            .bind(child.id, child.parent_id, range.start, range.end).all(),
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare("SELECT kind, title, points, is_active, description FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(child.parent_id).all(),
    ]);
    const netPoints = ledgerRows.results.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const currentBalance = await balance(env, child.id);
    const taskResults = taskRows.results;
    const categoryCounts = [...taskResults.filter((row) => row.status === "approved").reduce((map, row) => map.set(row.category_name || "未分类", (map.get(row.category_name || "未分类") || 0) + 1), new Map()).entries()];
    const reportData = {
        tasks: taskResults,
        rewards: rewardRows.results,
        ledger: ledgerRows.results,
        feedback: feedbackRows.results,
        achievements: achievementRows.results,
        netPoints,
        currentBalance,
        categoryCounts,
        range,
        assignments: {
            tasks: assignedTasks.results,
            rewards: assignedRewards.results,
            feedbackTemplates: feedbackTemplates.results,
        },
    };
    const aiPrompt = buildReportAiPrompt(child, reportData, config, periodType, offset);
    if (!aiPrompt) return "";
    const commentary = await callParentAiServiceForReport(env, aiPrompt, config);
    if (commentary) {
        await env.DB.prepare("INSERT OR REPLACE INTO ai_report_commentaries (child_id, parent_id, period_key, period_type, config_hash, commentary, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(child.id, child.parent_id, periodKey, periodType, hash, commentary, now)
            .run();
    }
    return commentary;
}
