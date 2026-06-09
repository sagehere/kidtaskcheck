import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, DAY_MS } from "../utils.js";

export const DEFAULT_WEEKLY_REPORT_PROMPT = `你是一位育儿教育专家。请根据以下孩子本周的表现数据，生成一份周报评语。
要求：1. 先简要总结本周整体表现 2. 指出本周最值得表扬的亮点
3. 温和地指出需要改进的地方 4. 给出针对性的具体建议
5. 语言温暖鼓励、有洞察力 6. 长度500-800字 7. 用中文输出`;

export const DEFAULT_MONTHLY_REPORT_PROMPT = `你是一位有经验的儿童成长顾问。请根据以下孩子本月的表现数据，生成一份月报评语。
要求：1. 分析本月整体表现趋势 2. 与上一周期对比进步和不足
3. 多维度评价（任务完成、奖励兑换、品德表现等）4. 指出最值得表扬的亮点
5. 温和地指出需要改进的地方 6. 给出下个月的成长建议
7. 语言温暖鼓励、有洞察力 8. 长度800-1200字 9. 用中文输出`;

export async function previousWeekReportSummary(env, childId, offset) {
    const now = nowIso();
    const range = reportWindowRange("weekly", now, offset);
    const weekStart = new Date(new Date(range.start).getTime() - 7 * DAY_MS).toISOString();
    const weekEnd = range.start;
    const pkey = periodKey("weekly", weekEnd, offset);
    const [taskRows, rewardRows, ledgerRows, feedbackRows, achievementRows] = await Promise.all([
        env.DB.prepare(`SELECT s.*, t.title, t.points, t.point_type
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
WHERE s.child_id=? AND s.submitted_at>=? AND s.submitted_at<? AND s.status='approved'`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.requested_at>=? AND rr.requested_at<? AND rr.status='redeemed'`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND created_at>=? AND created_at<? ORDER BY created_at")
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<?`)
            .bind(childId, weekStart, weekEnd).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<?`)
            .bind(childId, weekStart, weekEnd).all(),
    ]);
    return {
        pkey,
        tasks: taskRows.results,
        rewards: rewardRows.results,
        ledger: ledgerRows.results,
        feedback: feedbackRows.results,
        achievements: achievementRows.results,
    };
}

export async function previousDayReportSummary(env, childId, offset, input = nowIso()) {
    const local = new Date(new Date(input).getTime() + offset * 60000);
    const dayEnd = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset * 60000).toISOString();
    const dayStart = new Date(new Date(dayEnd).getTime() - DAY_MS).toISOString();
    const pkey = periodKey("daily", dayStart, offset);
    const [taskRows, rewardRows, ledgerRows, feedbackRows, achievementRows] = await Promise.all([
        env.DB.prepare(`SELECT s.*, t.title, t.points, t.point_type
FROM task_submissions s JOIN tasks t ON t.id=s.task_id
WHERE s.child_id=? AND s.submitted_at>=? AND s.submitted_at<?`)
            .bind(childId, dayStart, dayEnd).all(),
        env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.requested_at>=? AND rr.requested_at<?`)
            .bind(childId, dayStart, dayEnd).all(),
        env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND created_at>=? AND created_at<? ORDER BY created_at")
            .bind(childId, dayStart, dayEnd).all(),
        env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<?`)
            .bind(childId, dayStart, dayEnd).all(),
        env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<?`)
            .bind(childId, dayStart, dayEnd).all(),
    ]);
    return {
        pkey,
        range: { start: dayStart, end: dayEnd, label: pkey },
        tasks: taskRows.results,
        rewards: rewardRows.results,
        ledger: ledgerRows.results,
        feedback: feedbackRows.results,
        achievements: achievementRows.results,
    };
}

export function buildAiPrompt(child, report, config, assignments) {
    if (!report) return "";
    const approved = report.tasks.filter((t) => t.status === "approved").length;
    const rejected = report.tasks.filter((t) => t.status === "rejected").length;
    const taskNames = [...new Set(report.tasks.filter((t) => t.status === "approved").map((t) => t.title))];
    const praiseCount = report.feedback.filter((f) => f.source_type === "praise").length;
    const criticismCount = report.feedback.filter((f) => f.source_type === "criticism").length;
    const netPoints = report.ledger.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const achievementTitles = report.achievements.map((a) => a.title);
    const age = child.birth_date ? Math.floor((Date.now() - new Date(child.birth_date).getTime()) / 31557600000) : null;
    const genderLabel = child.gender === "male" ? "男" : child.gender === "female" ? "女" : "";
    const parts = [`孩子姓名：${child.display_name}`];
    if (genderLabel)
        parts.push(`性别：${genderLabel}`);
    if (age !== null && Number.isFinite(age))
        parts.push(`年龄：${age}岁`);
    parts.push(`本周表现：完成了 ${approved} 项任务，${rejected > 0 ? `有 ${rejected} 项未通过，` : ""}获得表扬 ${praiseCount} 次，批评 ${criticismCount} 次。`);
    if (taskNames.length)
        parts.push(`完成的任务有：${taskNames.join("、")}。`);
    if (achievementTitles.length)
        parts.push(`解锁成就：${achievementTitles.join("、")}。`);
    parts.push(`本周净获得 ${netPoints > 0 ? "+" : ""}${netPoints} 积分。`);
    const totalTasks = assignments?.tasks?.length || 0;
    const activeTasks = assignments?.tasks?.filter((t) => t.is_active).length || 0;
    const activeRewards = (assignments?.rewards || []).filter((r) => r.is_active).length;
    const ftPraise = (assignments?.feedbackTemplates || []).filter((f) => f.is_active && f.kind === "praise").length;
    const ftCriticism = (assignments?.feedbackTemplates || []).filter((f) => f.is_active && f.kind === "criticism").length;
    parts.push(`当前设置有 ${activeTasks}/${totalTasks} 个活跃任务、${activeRewards} 个活跃奖励、${ftPraise} 条表扬模板、${ftCriticism} 条批评模板。`);
    const userPrompt = (config?.prompt || "")
        .replace("{child_name}", child.display_name)
        .replace("{gender}", genderLabel || "孩子")
        .replace("{age}", age !== null && Number.isFinite(age) ? String(age) : "未知");
    return `${userPrompt}\n\n孩子本周数据：\n${parts.join("\n")}`;
}

export function buildDailyGreetingPrompt(child, report, config, assignments) {
    if (!report) return "";
    const approved = report.tasks.filter((t) => t.status === "approved").length;
    const rejected = report.tasks.filter((t) => t.status === "rejected").length;
    const pending = report.tasks.filter((t) => t.status === "pending").length;
    const taskNames = [...new Set(report.tasks.filter((t) => t.status === "approved").map((t) => t.title))];
    const praiseCount = report.feedback.filter((f) => f.source_type === "praise").length;
    const criticismCount = report.feedback.filter((f) => f.source_type === "criticism").length;
    const frozenCriticismCount = report.feedback.filter((f) => f.source_type === "criticism" && f.freeze_status === "frozen").length;
    const netPoints = report.ledger.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const achievementTitles = report.achievements.map((a) => a.title);
    const age = child.birth_date ? Math.floor((Date.now() - new Date(child.birth_date).getTime()) / 31557600000) : null;
    const genderLabel = child.gender === "male" ? "男孩" : child.gender === "female" ? "女孩" : "";
    const parts = [`孩子姓名：${child.display_name}`, `上一日期间：${report.range?.label || report.pkey || ""}`];
    if (genderLabel) parts.push(`性别：${genderLabel}`);
    if (age !== null && Number.isFinite(age)) parts.push(`年龄：${age}岁`);
    parts.push(`任务：通过 ${approved} 项，待审核 ${pending} 项，未通过 ${rejected} 项。`);
    if (taskNames.length) parts.push(`完成的任务：${taskNames.join("、")}。`);
    parts.push(`表扬 ${praiseCount} 次，批评 ${criticismCount} 次，其中待补救批评 ${frozenCriticismCount} 次。`);
    parts.push(`上一日积分变化：${netPoints > 0 ? "+" : ""}${netPoints}。`);
    if (report.rewards.length) parts.push(`奖励记录：${report.rewards.map((r) => r.title).filter(Boolean).join("、")}。`);
    if (achievementTitles.length) parts.push(`解锁成就：${achievementTitles.join("、")}。`);
    const activeTasks = (assignments?.tasks || []).filter((t) => t.is_active).length;
    const activeRewards = (assignments?.rewards || []).filter((r) => r.is_active).length;
    parts.push(`当前有 ${activeTasks} 个活跃任务、${activeRewards} 个活跃奖励。`);
    const userPrompt = (config?.prompt || "")
        .replace("{child_name}", child.display_name)
        .replace("{gender}", genderLabel || "孩子")
        .replace("{age}", age !== null && Number.isFinite(age) ? String(age) : "未知");
    return `${userPrompt}\n\n孩子上一日情况报表：\n${parts.join("\n")}`;
}

export function buildReportAiPrompt(child, reportData, config, periodType, offset) {
    const promptKey = periodType === "monthly" ? "monthlyPrompt" : "reportPrompt";
    const defaultPrompt = periodType === "monthly" ? DEFAULT_MONTHLY_REPORT_PROMPT : DEFAULT_WEEKLY_REPORT_PROMPT;
    const userPrompt = (config?.[promptKey] || defaultPrompt)
        .replace("{child_name}", child.display_name)
        .replace("{gender}", child.gender === "male" ? "男" : child.gender === "female" ? "女" : "孩子")
        .replace("{age}", child.birth_date ? String(Math.floor((Date.now() - new Date(child.birth_date).getTime()) / 31557600000)) : "未知");
    const approved = reportData.tasks.filter((t) => t.status === "approved").length;
    const rejected = reportData.tasks.filter((t) => t.status === "rejected").length;
    const total = reportData.tasks.length;
    const completionRate = total > 0 ? Math.round(approved / total * 100) : 0;
    const praiseCount = reportData.feedback.filter((f) => f.source_type === "praise").length;
    const criticismCount = reportData.feedback.filter((f) => f.source_type === "criticism").length;
    const achievementTitles = reportData.achievements.map((a) => a.title);
    const periodLabel = periodType === "monthly" ? "本月" : "本周";
    const parts = [`孩子姓名：${child.display_name}`, `${periodLabel}${periodType === "monthly" ? "月" : "周"}报期间：${reportData?.range?.label || ""}`];
    parts.push(`任务完成情况：共 ${total} 项任务，通过 ${approved} 项（${completionRate}%），${rejected > 0 ? `未通过 ${rejected} 项` : "全部通过"}。`);
    if (reportData.categoryCounts?.length)
        parts.push(`各分类完成：${reportData.categoryCounts.map(([cat, count]) => `${cat} ${count}项`).join("，")}。`);
    if (praiseCount || criticismCount)
        parts.push(`品德评价：${praiseCount} 次表扬，${criticismCount} 次批评。`);
    if (achievementTitles.length)
        parts.push(`解锁成就：${achievementTitles.join("、")}。`);
    parts.push(`积分变化：${periodLabel}净获得 ${reportData.netPoints > 0 ? "+" : ""}${reportData.netPoints} 分，当前余额 ${reportData.currentBalance} 分。`);
    if (reportData.rewards?.length)
        parts.push(`兑换奖励：${reportData.rewards.map((r) => r.title).join("、")}。`);
    const activeTasks = (reportData.assignments?.tasks || []).filter((t) => t.is_active).length;
    const activeRewards = (reportData.assignments?.rewards || []).filter((r) => r.is_active).length;
    parts.push(`当前设置有 ${activeTasks} 个活跃任务、${activeRewards} 个活跃奖励。`);
    return `${userPrompt}\n\n孩子${periodLabel}表现数据：\n${parts.join("\n")}`;
}
