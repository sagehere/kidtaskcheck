import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, DAY_MS } from "../utils.js";

export const DEFAULT_WEEKLY_REPORT_PROMPT = `你是一位育儿教育专家。请根据以下孩子本周的表现数据，生成一份周报评语。
要求：1. 按“本周总结、成长亮点、需要关注、下周行动”四部分输出
2. 只依据提供的数据，不把提交次数称为目标完成率 3. 对比上周变化
4. 建议必须具体可执行 5. 语言温暖鼓励 6. 长度350-600字 7. 用中文输出`;

export const DEFAULT_MONTHLY_REPORT_PROMPT = `你是一位有经验的儿童成长顾问。请根据以下孩子本月的表现数据，生成一份月报评语。
要求：1. 按“本月总结、趋势变化、成长亮点、需要关注、下月行动”五部分输出
2. 与上月对比，但只依据提供的数据 3. 不把提交次数称为目标完成率
4. 从任务、积分、奖励、品德和成就多维评价 5. 建议必须具体可执行
6. 语言温暖鼓励、有洞察力 7. 长度500-800字 8. 用中文输出`;

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
    const summary = reportData.summary || {};
    const previous = reportData.previousSummary || {};
    const achievementTitles = reportData.achievements.map((a) => a.title);
    const periodLabel = periodType === "monthly" ? "本月" : "本周";
    const parts = [`孩子姓名：${child.display_name}`, `${periodLabel}${periodType === "monthly" ? "月" : "周"}报期间：${reportData?.range?.label || ""}`];
    parts.push(`任务审核：通过 ${summary.approved || 0} 项，驳回 ${summary.rejected || 0} 项，待审核 ${summary.pending || 0} 项；已审核通过率 ${summary.approvalRate === null || summary.approvalRate === undefined ? "暂无已审核记录" : `${summary.approvalRate}%`}。`);
    parts.push(`上期对比：通过 ${previous.approved || 0} 项（变化 ${(summary.approved || 0) - (previous.approved || 0) >= 0 ? "+" : ""}${(summary.approved || 0) - (previous.approved || 0)}），已审核通过率 ${previous.approvalRate === null || previous.approvalRate === undefined ? "暂无" : `${previous.approvalRate}%`}，净积分 ${previous.netPoints > 0 ? "+" : ""}${previous.netPoints || 0}。`);
    if (reportData.categoryCounts?.length)
        parts.push(`各分类完成：${reportData.categoryCounts.map(([cat, count]) => `${cat} ${count}项`).join("，")}。`);
    parts.push(`品德评价：${summary.praiseCount || 0} 次表扬，${summary.criticismCount || 0} 次批评；上期为 ${previous.praiseCount || 0} 次表扬、${previous.criticismCount || 0} 次批评。`);
    const rejectedDetails = reportData.tasks.filter((item) => item.status === "rejected").slice(0, 5)
        .map((item) => `${item.title}${item.review_note ? `（${item.review_note}）` : ""}`);
    if (rejectedDetails.length) parts.push(`需要关注的任务：${rejectedDetails.join("、")}。`);
    const requiredEvents = (reportData.requiredEvents || []).slice(0, 5)
        .map((item) => `${item.title}实际${item.actual_count}/${item.required_count}${Number(item.penalty_points) > 0 ? `，扣分${item.penalty_points}` : "，已记录未扣分"}`);
    if (requiredEvents.length) parts.push(`必做任务异常：${requiredEvents.join("；")}。`);
    if (achievementTitles.length)
        parts.push(`解锁成就：${achievementTitles.join("、")}。`);
    parts.push(`积分变化：${periodLabel}净获得 ${summary.netPoints > 0 ? "+" : ""}${summary.netPoints || 0} 分，当前余额 ${reportData.currentBalance} 分。`);
    if (reportData.pointBreakdown?.length)
        parts.push(`积分来源：${reportData.pointBreakdown.map((item) => `${item.label}${item.points >= 0 ? "+" : ""}${item.points}分`).join("，")}。`);
    if (reportData.rewards?.length)
        parts.push(`兑换奖励：${reportData.rewards.map((r) => r.title).join("、")}。`);
    const activeTasks = (reportData.assignments?.tasks || []).filter((t) => t.is_active).length;
    const activeRewards = (reportData.assignments?.rewards || []).filter((r) => r.is_active).length;
    parts.push(`当前设置有 ${activeTasks} 个活跃任务、${activeRewards} 个活跃奖励。请最后给出下一周期可执行的1至3项行动。`);
    return `${userPrompt}\n\n孩子${periodLabel}表现数据：\n${parts.join("\n")}`;
}
