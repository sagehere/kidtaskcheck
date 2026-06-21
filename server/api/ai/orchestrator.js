import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, balance, timezoneOffsetMinutes, ensureChildScheduleSchema } from "../utils.js";
import { getParentAiServiceConfig, aiConfigHash, aiReportConfigHash, ensureAiReportCommentaries } from "./cache.js";
import { buildDailyGreetingPrompt, buildReportAiPrompt, previousDayReportSummary } from "./prompt.js";
import { callParentAiService, callParentAiServiceForReport, callParentImageService } from "./providers.js";

export class NonRetryableError extends Error {
    constructor(message) {
        super(message);
        this.name = "NonRetryableError";
    }
}

export function previousCompletedReportRange(periodType, input, offset) {
    const current = reportWindowRange(periodType, input, offset);
    const previousAnchor = new Date(new Date(current.start).getTime() - 1).toISOString();
    return reportWindowRange(periodType, previousAnchor, offset);
}

export async function collectReportData(env, child, parentId, range) {
    const [ledgerRows, taskRows, rewardRows, feedbackRows, achievementRows, assignedTasks, assignedRewards, feedbackTemplates] = await Promise.all([
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND parent_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC")
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT s.*, t.title, tc.name category_name
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE s.child_id=? AND s.parent_id=? AND s.submitted_at>=? AND s.submitted_at<? ORDER BY s.submitted_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.requested_at>=? AND rr.requested_at<? ORDER BY rr.requested_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<? ORDER BY pl.created_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND a.parent_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<? ORDER BY ca.unlocked_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, parentId).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, parentId).all(),
        env.DB.prepare("SELECT kind, title, points, is_active, description FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(parentId).all(),
    ]);
    const tasks = taskRows.results;
    const ledger = ledgerRows.results;
    const netPoints = ledger.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const currentBalance = await balance(env, child.id);
    const categoryCounts = [...tasks.filter((row) => row.status === "approved").reduce((map, row) => map.set(row.category_name || "未分类", (map.get(row.category_name || "未分类") || 0) + 1), new Map()).entries()];
    return {
        tasks,
        rewards: rewardRows.results,
        ledger,
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
}

function truncatePrompt(userPrompt, summary, maxLength = 1000) {
    const prefix = String(userPrompt || "").trim();
    if (!prefix) return "";
    const separator = "\n\n报表内容：\n";
    const budget = maxLength - prefix.length - separator.length;
    if (budget <= 0) return prefix.slice(0, maxLength);
    return `${prefix}${separator}${summary.slice(0, budget)}`;
}

export function buildCartoonReportPrompt(child, reportData, config, periodType) {
    const userPrompt = config?.imagePrompt || "";
    const approved = reportData.tasks.filter((row) => row.status === "approved").length;
    const rejected = reportData.tasks.filter((row) => row.status === "rejected").length;
    const pending = reportData.tasks.filter((row) => row.status === "pending").length;
    const praiseCount = reportData.feedback.filter((row) => row.source_type === "praise").length;
    const criticismCount = reportData.feedback.filter((row) => row.source_type === "criticism").length;
    const categories = reportData.categoryCounts?.length ? reportData.categoryCounts.map(([name, count]) => `${name}${count}项`).join("，") : "暂无分类完成";
    const rewards = reportData.rewards?.slice(0, 5).map((row) => row.title).filter(Boolean).join("，") || "暂无奖励兑换";
    const achievements = reportData.achievements?.slice(0, 5).map((row) => row.title).filter(Boolean).join("，") || "暂无新成就";
    const commentary = reportData.aiCommentary || "暂无AI评语";
    const periodLabel = periodType === "monthly" ? "上月月报" : "上周周报";
    const summary = [
        `孩子：${child.display_name}`,
        `报告：${periodLabel}，周期 ${reportData.range?.label || ""}`,
        `任务：通过${approved}项，待审${pending}项，驳回${rejected}项`,
        `分类亮点：${categories}`,
        `表扬批评：表扬${praiseCount}次，批评${criticismCount}次`,
        `积分：本期${reportData.netPoints >= 0 ? "+" : ""}${reportData.netPoints}，当前余额${reportData.currentBalance}`,
        `AI评语：${commentary}`,
        `奖励：${rewards}`,
        `成就：${achievements}`,
        "请画成适合孩子看的卡通报告画面，画面要积极、清晰、避免出现真实个人隐私文字。"
    ].join("\n");
    return truncatePrompt(userPrompt, summary);
}

export async function generateParentAiGreeting(env, child, offset, forceRefresh = false, options = {}) {
    if (!child.ai_enabled)
        throw new NonRetryableError("ai_disabled");
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
        throw new NonRetryableError("ai_config_incomplete");
    const hash = aiConfigHash(config);
    const now = nowIso();
    const dayKey = options.periodKey || periodKey("daily", now, offset);
    const cached = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? AND previous_week_key=? AND config_hash=?")
        .bind(child.id, dayKey, hash)
        .first();
    if (cached?.greeting && !forceRefresh)
        return cached.greeting;
    const report = await previousDayReportSummary(env, child.id, offset, options.input || now);
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
    const aiPrompt = buildDailyGreetingPrompt(child, report, config, assignments);
    if (!aiPrompt)
        return "";
    const greeting = await callParentAiService(env, aiPrompt, config, options.ai || {});
    if (greeting && options.cache !== false) {
        await env.DB.prepare("INSERT OR REPLACE INTO ai_child_greetings (child_id, previous_week_key, config_hash, greeting, generated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(child.id, dayKey, hash, greeting, now)
            .run();
    }
    return greeting;
}

export async function generateReportCommentary(env, child, periodType, periodKey, offset, forceRefresh = false, options = {}) {
    if (!child?.ai_enabled) throw new NonRetryableError("ai_disabled");
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model) throw new NonRetryableError("ai_config_incomplete");
    const hash = aiReportConfigHash(config, periodType);
    const now = nowIso();
    if (options.cache !== false) {
        await ensureAiReportCommentaries(env);
        const cached = await env.DB.prepare("SELECT commentary FROM ai_report_commentaries WHERE child_id=? AND period_key=? AND period_type=? AND config_hash=?")
            .bind(child.id, periodKey, periodType, hash)
            .first();
        if (cached?.commentary && !forceRefresh) return cached.commentary;
    }
    const range = options.range || reportWindowRange(periodType, now, offset);
    const reportData = await collectReportData(env, child, child.parent_id, range);
    const aiPrompt = buildReportAiPrompt(child, reportData, config, periodType, offset);
    if (!aiPrompt) return "";
    const commentary = options.ai
        ? await callParentAiService(env, aiPrompt, config, { maxTokens: 600, noTruncate: true, ...options.ai })
        : await callParentAiServiceForReport(env, aiPrompt, config);
    if (commentary && options.cache !== false) {
        await env.DB.prepare("INSERT OR REPLACE INTO ai_report_commentaries (child_id, parent_id, period_key, period_type, config_hash, commentary, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(child.id, child.parent_id, periodKey, periodType, hash, commentary, now)
            .run();
    }
    return commentary;
}

export async function generateCartoonReportImage(env, child, periodType, range) {
    if (!child?.ai_enabled) throw new NonRetryableError("ai_disabled");
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.imagePrompt) {
        throw new NonRetryableError("ai_image_config_incomplete");
    }
    const reportData = await collectReportData(env, child, child.parent_id, range);
    let aiCommentary = "";
    try {
        const textConfig = await getParentAiServiceConfig(env, child.parent_id);
        if (textConfig.baseUrl && textConfig.apiKey && textConfig.model) {
            const offset = await timezoneOffsetMinutes(env);
            aiCommentary = await generateReportCommentary(env, child, periodType, range.label, offset, false, { range });
        }
    } catch {
        aiCommentary = "";
    }
    reportData.aiCommentary = aiCommentary;
    const prompt = buildCartoonReportPrompt(child, reportData, config, periodType);
    if (!prompt) throw new NonRetryableError("ai_image_prompt_empty");
    const imageUrl = await callParentImageService(env, prompt, config);
    return {
        imageUrl,
        format: config.imageFormat || "jpeg",
        filename: `${child.display_name}-${periodType === "monthly" ? "monthly" : "weekly"}-cartoon-report.${config.imageFormat || "jpeg"}`,
        promptPreview: prompt.slice(0, 240)
    };
}

export async function generateScheduleImage(env, child) {
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.scheduleImagePrompt) {
        throw new NonRetryableError("ai_schedule_image_config_incomplete");
    }
    await ensureChildScheduleSchema(env);
    const slots = (await env.DB.prepare("SELECT * FROM child_schedule_slots WHERE child_id=? ORDER BY sort_order, created_at")
        .bind(child.id).all()).results;
    const items = slots.length
        ? (await env.DB.prepare(`SELECT csi.*, t.title, t.points, t.period, t.is_required, t.required_count, tc.name category_name
FROM child_schedule_items csi
JOIN tasks t ON t.id=csi.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE csi.child_id=? ORDER BY csi.sort_order, csi.created_at`).bind(child.id).all()).results
        : [];
    const fmtTime = (m) => {
        const h = Math.floor(m / 60);
        const min = m % 60;
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    };
    const scheduleLines = slots.map((slot) => {
        const slotItems = items.filter((item) => item.slot_id === slot.id);
        const taskDesc = slotItems.map((item) => `${item.title}(${item.category_name || "未分类"},${item.points}分,${item.period === "daily" ? "每日" : item.period === "weekly" ? "每周" : "每月"}${item.is_required ? ",必做" : ""})`).join("；");
        return `${fmtTime(slot.start_minutes)}-${fmtTime(slot.end_minutes)} ${slot.title}: ${taskDesc || "空闲"}`;
    }).join("\n");
    const unscheduled = (await env.DB.prepare(`SELECT t.title, t.points, tc.name category_name
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL AND t.is_active=1
ORDER BY tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all()).results;
    const scheduledTaskIds = new Set(items.map((item) => item.task_id));
    const unscheduledLines = unscheduled.filter((t) => !scheduledTaskIds.has(t.id))
        .map((t) => `${t.title}(${t.category_name || "未分类"},${t.points}分)`).join("；");
    const prompt = truncatePrompt(config.scheduleImagePrompt, [
        `孩子：${child.display_name}`,
        `日程表：`,
        scheduleLines,
        unscheduledLines ? `未安排任务：${unscheduledLines}` : "",
        "请画成适合孩子查看的日程表插画，清晰展示各时段安排，积极、避免真实个人隐私文字。"
    ].join("\n"));
    if (!prompt) throw new NonRetryableError("ai_schedule_image_prompt_empty");
    const imageUrl = await callParentImageService(env, prompt, config);
    return {
        imageUrl,
        format: config.imageFormat || "jpeg",
        filename: `${child.display_name}-schedule-image.${config.imageFormat || "jpeg"}`,
        promptPreview: prompt.slice(0, 240)
    };
}

export async function generatePrintChecklistImage(env, child) {
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.checklistImagePrompt) {
        throw new NonRetryableError("ai_checklist_image_config_incomplete");
    }
    const [tasks, rewards, feedbackTemplates] = await Promise.all([
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT kind, title, points, is_active, description, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours
FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC`).bind(child.parent_id).all(),
    ]);
    const taskSummary = tasks.results.slice(0, 12).map((row) => `${row.category_name || "未分类"}-${row.title}(${row.period}, ${row.points}分)`).join("；") || "暂无任务";
    const rewardSummary = rewards.results.slice(0, 12).map((row) => `${row.title}(${row.cost_points}分)`).join("；") || "暂无奖励";
    const feedbackSummary = feedbackTemplates.results.slice(0, 12).map((row) => {
        const type = row.kind === "praise" ? "表扬" : "批评";
        const remedy = row.kind === "criticism" && row.is_remediable ? `，可补救：${row.remedy_condition || "按要求补救"}，挽回${row.remedy_points || 0}分，${row.remedy_deadline_hours || 24}小时` : "";
        return `${type}-${row.title}(${row.points}分${remedy})`;
    }).join("；") || "暂无表扬批评条款";
    const prompt = truncatePrompt(config.checklistImagePrompt, [
        `孩子：${child.display_name}`,
        `任务清单：${taskSummary}`,
        `奖励清单：${rewardSummary}`,
        `表扬批评条款：${feedbackSummary}`,
        "请画成适合孩子查看的清单插画，清晰、积极、避免真实个人隐私文字。"
    ].join("\n"));
    if (!prompt) throw new NonRetryableError("ai_checklist_image_prompt_empty");
    const imageUrl = await callParentImageService(env, prompt, config);
    return {
        imageUrl,
        format: config.imageFormat || "jpeg",
        filename: `${child.display_name}-print-checklist.${config.imageFormat || "jpeg"}`,
        promptPreview: prompt.slice(0, 240)
    };
}
