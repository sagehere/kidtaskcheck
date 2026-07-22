import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, balance, timezoneOffsetMinutes, ensureRequiredTaskSchema, ensureChildScheduleSchema, schedulePlanHtmlToText, withLedgerSources } from "../utils.js";
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

function reportSummary(tasks, ledger, feedback, achievements) {
    const approved = tasks.filter((row) => row.status === "approved").length;
    const rejected = tasks.filter((row) => row.status === "rejected").length;
    const pending = tasks.filter((row) => row.status === "pending").length;
    const reviewed = approved + rejected;
    return {
        approved,
        rejected,
        pending,
        reviewed,
        approvalRate: reviewed ? Math.round(approved / reviewed * 100) : null,
        netPoints: ledger.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        praiseCount: feedback.filter((row) => row.source_type === "praise").length,
        criticismCount: feedback.filter((row) => row.source_type === "criticism").length,
        achievementCount: achievements.length,
    };
}

function reportPeriodKeys(range, offset) {
    const keys = new Set();
    for (let at = new Date(range.start).getTime(); at < new Date(range.end).getTime(); at += 86400000) {
        const input = new Date(at).toISOString();
        keys.add(periodKey("daily", input, offset));
        for (const period of ["weekly", "monthly"]) {
            const itemRange = reportWindowRange(period, input, offset);
            if (itemRange.start >= range.start && itemRange.end <= range.end) keys.add(itemRange.label);
        }
    }
    return [...keys];
}

export async function collectReportData(env, child, parentId, range, offset = 480) {
    await ensureRequiredTaskSchema(env);
    const requiredKeys = reportPeriodKeys(range, offset);
    const requiredQuery = requiredKeys.length
        ? env.DB.prepare(`SELECT trp.*, t.title, t.period FROM task_required_penalties trp
JOIN tasks t ON t.id=trp.task_id
WHERE trp.child_id=? AND trp.parent_id=? AND trp.period_key IN (${requiredKeys.map(() => "?").join(",")})
ORDER BY trp.period_key DESC, t.title`).bind(child.id, parentId, ...requiredKeys).all()
        : Promise.resolve({ results: [] });
    const [ledgerRows, taskRows, rewardRows, achievementRows, assignedTasks, assignedRewards, feedbackTemplates, requiredRows] = await Promise.all([
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND parent_id=? AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?) ORDER BY datetime(created_at) DESC, created_at DESC, id DESC")
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT s.*, t.title, t.is_required, t.required_count, tc.name category_name,
  (SELECT pl.amount FROM point_ledger pl WHERE pl.parent_id=s.parent_id AND pl.source_type='task' AND pl.source_id=s.id ORDER BY datetime(pl.created_at) DESC LIMIT 1) awarded_points,
  (SELECT pl.note FROM point_ledger pl WHERE pl.parent_id=s.parent_id AND pl.source_type='task' AND pl.source_id=s.id ORDER BY datetime(pl.created_at) DESC LIMIT 1) award_note
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE s.child_id=? AND s.parent_id=? AND datetime(s.submitted_at)>=datetime(?) AND datetime(s.submitted_at)<datetime(?) ORDER BY datetime(s.submitted_at) DESC, s.submitted_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND datetime(rr.requested_at)>=datetime(?) AND datetime(rr.requested_at)<datetime(?) ORDER BY datetime(rr.requested_at) DESC, rr.requested_at DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND a.parent_id=? AND datetime(ca.unlocked_at)>=datetime(?) AND datetime(ca.unlocked_at)<datetime(?) ORDER BY datetime(ca.unlocked_at) DESC`)
            .bind(child.id, parentId, range.start, range.end).all(),
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description, t.is_required, t.required_count, t.required_penalty_points, t.grading_mode, t.completion_standards_json
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, parentId).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, parentId).all(),
        env.DB.prepare("SELECT kind, title, points, is_active, description FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(parentId).all(),
        requiredQuery,
    ]);
    const ledger = await withLedgerSources(env, ledgerRows.results, offset);
    const awards = new Map(ledger.filter((row) => row.source_type === "task").map((row) => [row.source_id, row]));
    const tasks = taskRows.results.map((row) => ({
        ...row,
        awardedPoints: Number(row.awarded_points ?? awards.get(row.id)?.amount ?? 0),
        awardNote: row.award_note || awards.get(row.id)?.note || "",
    }));
    const feedback = ledger.filter((row) => (row.source_type === "praise" || row.source_type === "criticism") && !row.revoked_at);
    const achievements = achievementRows.results;
    const summary = reportSummary(tasks, ledger, feedback, achievements);
    const currentBalance = await balance(env, child.id);
    const categoryCounts = [...tasks.filter((row) => row.status === "approved").reduce((map, row) => map.set(row.category_name || "未分类", (map.get(row.category_name || "未分类") || 0) + 1), new Map()).entries()];
    const pointBreakdown = [...ledger.reduce((map, row) => {
        const key = row.sourceTypeLabel || row.source_type;
        const item = map.get(key) || { label: key, count: 0, points: 0 };
        item.count += 1;
        item.points += Number(row.amount || 0);
        map.set(key, item);
        return map;
    }, new Map()).values()];
    return {
        tasks,
        rewards: rewardRows.results,
        ledger,
        feedback,
        achievements,
        requiredEvents: requiredRows.results,
        summary,
        netPoints: summary.netPoints,
        currentBalance,
        categoryCounts,
        pointBreakdown,
        range,
        assignments: {
            tasks: assignedTasks.results,
            rewards: assignedRewards.results,
            feedbackTemplates: feedbackTemplates.results,
        },
    };
}

export async function collectReportComparison(env, child, periodType, range, offset) {
    const previousRange = previousCompletedReportRange(periodType, range.start, offset);
    const [current, previous] = await Promise.all([
        collectReportData(env, child, child.parent_id, range, offset),
        collectReportData(env, child, child.parent_id, previousRange, offset),
    ]);
    current.previousSummary = previous.summary;
    current.previousRange = previousRange;
    return current;
}

function truncatePrompt(userPrompt, summary, maxLength = 1800) {
    const prefix = String(userPrompt || "").trim();
    if (!prefix) return "";
    const separator = "\n\n报表内容：\n";
    const budget = maxLength - prefix.length - separator.length;
    if (budget <= 0) return prefix.slice(0, maxLength);
    return `${prefix}${separator}${summary.slice(0, budget)}`;
}

function compactList(items, limit, format, empty) {
    if (!items.length) return empty;
    const shown = items.slice(0, limit).map(format).join("；");
    return items.length > limit ? `${shown}；另有${items.length - limit}项未列出` : shown;
}

export function buildCartoonReportPrompt(child, reportData, config, periodType) {
    const userPrompt = config?.imagePrompt || "";
    const current = reportData.summary || {};
    const previous = reportData.previousSummary || {};
    const categories = reportData.categoryCounts?.length ? reportData.categoryCounts.map(([name, count]) => `${name}${count}项`).join("，") : "暂无分类完成";
    const rejected = compactList(reportData.tasks.filter((row) => row.status === "rejected"), 3, (row) => row.title, "暂无驳回任务");
    const required = compactList(reportData.requiredEvents || [], 3, (row) => `${row.title}${Number(row.penalty_points) > 0 ? `扣${row.penalty_points}分` : "已记录未扣分"}`, "暂无必做异常");
    const rewards = compactList(reportData.rewards || [], 5, (row) => row.title, "暂无奖励兑换");
    const achievements = compactList(reportData.achievements || [], 5, (row) => row.title, "暂无新成就");
    const commentary = String(reportData.aiCommentary || "暂无AI评语").slice(0, 240);
    const periodLabel = periodType === "monthly" ? "上月月报" : "上周周报";
    const summary = [
        `孩子：${child.display_name}`,
        `报告：${periodLabel}，周期 ${reportData.range?.label || ""}`,
        `亮点：通过${current.approved || 0}项，已审核通过率${current.approvalRate === null || current.approvalRate === undefined ? "暂无" : `${current.approvalRate}%`}，分类${categories}，成就${achievements}`,
        `对比：上期通过${previous.approved || 0}项、净积分${previous.netPoints > 0 ? "+" : ""}${previous.netPoints || 0}`,
        `问题：待审${current.pending || 0}项，驳回${current.rejected || 0}项（${rejected}），${required}`,
        `品德：表扬${current.praiseCount || 0}次，批评${current.criticismCount || 0}次`,
        `积分：本期${current.netPoints >= 0 ? "+" : ""}${current.netPoints || 0}，当前余额${reportData.currentBalance}`,
        `奖励：${rewards}`,
        `下一步参考：${commentary}`,
        "画面按“成长亮点、需要关注、下一步”三块组织；适合孩子阅读，可显示昵称，不显示账号等敏感信息，短标签必须清晰。"
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
    const reportData = await collectReportComparison(env, child, periodType, range, offset);
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
    const offset = await timezoneOffsetMinutes(env);
    const reportData = await collectReportComparison(env, child, periodType, range, offset);
    let aiCommentary = "";
    try {
        const textConfig = await getParentAiServiceConfig(env, child.parent_id);
        if (textConfig.baseUrl && textConfig.apiKey && textConfig.model) {
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
    await Promise.all([ensureRequiredTaskSchema(env), ensureChildScheduleSchema(env)]);
    const slots = (await env.DB.prepare("SELECT * FROM child_schedule_slots WHERE child_id=? ORDER BY sort_order, created_at")
        .bind(child.id).all()).results;
    const items = slots.length
        ? (await env.DB.prepare(`SELECT csi.*, t.title, t.points, t.period, t.limit_count, t.is_required, t.required_count, tc.name category_name
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
    const scheduleRows = slots.map((slot) => {
        const slotItems = items.filter((item) => item.slot_id === slot.id);
        const taskDesc = compactList(slotItems, 6, (item) => `${item.title}(${item.category_name || "未分类"},${item.points}分,${item.period === "daily" ? "每日" : item.period === "weekly" ? "每周" : "每月"}最多${item.limit_count || 1}次${item.is_required ? `,必做${item.required_count || 1}次` : ""})`, "空闲");
        const planText = schedulePlanHtmlToText(slot.plan_html || "");
        return `${fmtTime(slot.start_minutes)}-${fmtTime(slot.end_minutes)} ${slot.title || "未命名时段"}: 计划=${planText || "暂无"}; 可完成任务=${taskDesc}`;
    });
    const unscheduled = (await env.DB.prepare(`SELECT t.title, t.points, tc.name category_name
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL AND t.is_active=1
ORDER BY tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all()).results;
    const scheduledTaskIds = new Set(items.map((item) => item.task_id));
    const unscheduledTasks = unscheduled.filter((t) => !scheduledTaskIds.has(t.id));
    const unscheduledLines = compactList(unscheduledTasks, 8, (t) => `${t.title}(${t.category_name || "未分类"},${t.points}分)`, "");
    const prompt = truncatePrompt(config.scheduleImagePrompt, [
        `孩子：${child.display_name}`,
        `当前日程模板：`,
        ...scheduleRows,
        unscheduledLines ? `未安排任务：${unscheduledLines}` : "",
        "按时间顺序绘制清晰日程表，突出必做任务和空闲时段；可显示昵称，不显示账号等敏感信息。"
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
    await ensureRequiredTaskSchema(env);
    const [tasks, rewards, feedbackTemplates] = await Promise.all([
        env.DB.prepare(`SELECT t.title, tc.name category_name, t.period, t.limit_count, t.points, t.enabled_weekdays, t.is_active, t.description, t.is_required, t.required_count
FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL AND t.is_active=1
ORDER BY t.is_required DESC, tc.name, t.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT r.title, r.cost_points, r.limit_period, r.limit_count, r.redeem_weekdays, r.is_active, r.description,
  (SELECT GROUP_CONCAT(t.title || '×' || rp.required_count, '、') FROM reward_prerequisites rp JOIN tasks t ON t.id=rp.task_id WHERE rp.reward_id=r.id) prerequisites,
  (SELECT a.title FROM achievements a WHERE a.unlock_reward_id=r.id AND a.is_active=1 AND a.deleted_at IS NULL LIMIT 1) required_achievement
FROM rewards r JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL AND r.is_active=1
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, child.parent_id).all(),
        env.DB.prepare(`SELECT kind, title, points, is_active, description, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours
FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY kind, created_at DESC`).bind(child.parent_id).all(),
    ]);
    const periodLabel = (value) => value === "daily" ? "每日" : value === "weekly" ? "每周" : value === "monthly" ? "每月" : value === "once" ? "一次性" : "不限周期";
    const taskSummary = compactList(tasks.results, 12, (row) => `${row.category_name || "未分类"}-${row.title}(${periodLabel(row.period)}最多${row.limit_count || 1}次,${row.points}分${row.is_required ? `,必做${row.required_count || 1}次` : ""})`, "暂无任务");
    const rewardSummary = compactList(rewards.results, 12, (row) => `${row.title}(${row.cost_points}分,${periodLabel(row.limit_period)}${row.limit_count ? `最多${row.limit_count}次` : ""}${row.prerequisites ? `,前置${row.prerequisites}` : ""}${row.required_achievement ? `,需成就${row.required_achievement}` : ""})`, "暂无奖励");
    const feedbackSummary = compactList(feedbackTemplates.results, 12, (row) => {
        const type = row.kind === "praise" ? "表扬" : "批评";
        const remedy = row.kind === "criticism" && row.is_remediable ? `，可补救：${row.remedy_condition || "按要求补救"}，挽回${row.remedy_points || 0}分，${row.remedy_deadline_hours || 24}小时` : "";
        return `${type}-${row.title}(${type === "表扬" ? "+" : "-"}${Math.abs(Number(row.points || 0))}分${remedy})`;
    }, "暂无表扬批评条款");
    const prompt = truncatePrompt(config.checklistImagePrompt, [
        `孩子：${child.display_name}`,
        `任务清单：${taskSummary}`,
        `奖励清单：${rewardSummary}`,
        `表扬批评条款：${feedbackSummary}`,
        "按“任务目标、可兑换奖励、行为约定”三块绘制清单插画；突出必做任务与奖励条件，可显示昵称，不显示账号等敏感信息。"
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
