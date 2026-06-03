import { Task, Category } from "../types/api";
import { formatMetric } from "../components/UI";

export const ACHIEVEMENT_CONDITIONS = [
  { value: "tasks_total", label: "累计完成任务" },
  { value: "specific_task_completed", label: "完成指定任务" },
  { value: "tasks_week", label: "一周内完成任务" },
  { value: "tasks_month", label: "一月内完成任务" },
  { value: "tasks_custom", label: "固定日期范围内完成任务" },
  { value: "category_tasks_total", label: "指定分类累计完成任务" },
  { value: "category_tasks_week", label: "指定分类本周完成任务" },
  { value: "category_tasks_month", label: "指定分类本月完成任务" },
  { value: "category_tasks_custom", label: "指定分类固定日期范围内完成任务" },
  { value: "category_streak", label: "指定分类连续打卡天数" },
  { value: "streak_days", label: "连续打卡天数" },
  { value: "same_task_streak", label: "连续完成同一任务" },
  { value: "total_earned", label: "累计获得积分" },
  { value: "redemptions", label: "累计兑换奖励" },
  { value: "praise_total", label: "累计获得表扬" },
  { value: "praise_week", label: "本周获得表扬" },
  { value: "praise_month", label: "本月获得表扬" },
  { value: "praise_custom", label: "固定日期范围内获得表扬" },
  { value: "praise_streak", label: "连续获得表扬天数" },
  { value: "no_criticism_days", label: "连续未被批评天数" },
  { value: "no_criticism_week", label: "本周未被批评" },
  { value: "no_criticism_month", label: "本月未被批评" },
  { value: "no_criticism_custom", label: "固定日期范围内未被批评" }
];

export function conditionFromAchievement(item: any) {
  const ruleType = item.rule_type || item.metric || "tasks_completed";
  const windowType = item.window_type || "all_time";
  if (ruleType === "tasks_completed" && windowType === "current_week") return "tasks_week";
  if (ruleType === "tasks_completed" && windowType === "current_month") return "tasks_month";
  if (ruleType === "tasks_completed" && windowType === "custom") return "tasks_custom";
  if (ruleType === "tasks_completed") return "tasks_total";
  if (ruleType === "specific_task_completed") return "specific_task_completed";
  if (ruleType === "category_tasks" && windowType === "current_week") return "category_tasks_week";
  if (ruleType === "category_tasks" && windowType === "current_month") return "category_tasks_month";
  if (ruleType === "category_tasks" && windowType === "custom") return "category_tasks_custom";
  if (ruleType === "category_tasks") return "category_tasks_total";
  if (ruleType === "praise_count" && windowType === "current_week") return "praise_week";
  if (ruleType === "praise_count" && windowType === "current_month") return "praise_month";
  if (ruleType === "praise_count" && windowType === "custom") return "praise_custom";
  if (ruleType === "praise_count") return "praise_total";
  if (ruleType === "no_criticism_window" && windowType === "current_week") return "no_criticism_week";
  if (ruleType === "no_criticism_window" && windowType === "current_month") return "no_criticism_month";
  if (ruleType === "no_criticism_window" && windowType === "custom") return "no_criticism_custom";
  return ruleType;
}

export function achievementRuleFromCondition(condition: string) {
  if (condition === "tasks_total") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "tasks_week") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "current_week" };
  if (condition === "tasks_month") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "current_month" };
  if (condition === "tasks_custom") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "custom" };
  if (condition === "specific_task_completed") return { ruleType: "specific_task_completed", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "same_task_streak") return { ruleType: "same_task_streak", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "category_tasks_total") return { ruleType: "category_tasks", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "category_tasks_week") return { ruleType: "category_tasks", metric: "tasks_completed", windowType: "current_week" };
  if (condition === "category_tasks_month") return { ruleType: "category_tasks", metric: "tasks_completed", windowType: "current_month" };
  if (condition === "category_tasks_custom") return { ruleType: "category_tasks", metric: "tasks_completed", windowType: "custom" };
  if (condition === "category_streak") return { ruleType: "category_streak", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "praise_total") return { ruleType: "praise_count", metric: "total_earned", windowType: "all_time" };
  if (condition === "praise_week") return { ruleType: "praise_count", metric: "total_earned", windowType: "current_week" };
  if (condition === "praise_month") return { ruleType: "praise_count", metric: "total_earned", windowType: "current_month" };
  if (condition === "praise_custom") return { ruleType: "praise_count", metric: "total_earned", windowType: "custom" };
  if (condition === "praise_streak") return { ruleType: "praise_streak", metric: "total_earned", windowType: "all_time" };
  if (condition === "no_criticism_days") return { ruleType: "no_criticism_days", metric: "total_earned", windowType: "all_time" };
  if (condition === "no_criticism_week") return { ruleType: "no_criticism_window", metric: "total_earned", windowType: "current_week" };
  if (condition === "no_criticism_month") return { ruleType: "no_criticism_window", metric: "total_earned", windowType: "current_month" };
  if (condition === "no_criticism_custom") return { ruleType: "no_criticism_window", metric: "total_earned", windowType: "custom" };
  return { ruleType: condition, metric: condition, windowType: "all_time" };
}

export function achievementPayload(data: any) {
  const rule = achievementRuleFromCondition(data.condition);
  return {
    title: data.title,
    description: data.description || "",
    threshold: rule.ruleType === "no_criticism_window" ? 1 : Number(data.threshold || 0),
    iconType: "emoji",
    iconValue: data.iconValue,
    ...rule,
    windowStart: rule.windowType === "custom" ? data.windowStart : null,
    windowEnd: rule.windowType === "custom" ? data.windowEnd : null,
    targetTaskId: rule.ruleType === "same_task_streak" || rule.ruleType === "specific_task_completed" ? data.targetTaskId : null,
    targetCategoryId: rule.ruleType === "category_tasks" || rule.ruleType === "category_streak" ? data.targetCategoryId : null
  };
}

export function formatAchievementRule(item: any, tasks: Task[] = [], categories: Category[] = []) {
  const condition = conditionFromAchievement(item);
  const label = ACHIEVEMENT_CONDITIONS.find((entry) => entry.value === condition)?.label || formatMetric(item.metric);
  const category = categories.find((entry) => entry.id === item.target_category_id);
  if (condition === "tasks_custom" || condition === "category_tasks_custom" || condition === "praise_custom" || condition === "no_criticism_custom") {
    const start = item.window_start || "开始日期";
    const end = item.window_end || "结束日期";
    if (condition === "category_tasks_custom") return `${start} 至 ${end} ${category?.name || "指定分类"}完成任务 ≥ ${item.threshold}次`;
    if (condition === "praise_custom") return `${start} 至 ${end} 获得表扬 ≥ ${item.threshold}次`;
    if (condition === "no_criticism_custom") return `${start} 至 ${end} 未被批评`;
    return `${start} 至 ${end} 完成任务 ≥ ${item.threshold}`;
  }
  if (condition === "same_task_streak") {
    const task = tasks.find((entry) => entry.id === item.target_task_id);
    return `${task?.title || "指定任务"}连续完成 ≥ ${item.threshold} 天`;
  }
  if (condition === "specific_task_completed") {
    const task = tasks.find((entry) => entry.id === item.target_task_id);
    return `${task?.title || "指定任务"}完成 ≥ ${item.threshold}次`;
  }
  if (condition === "category_streak") return `${category?.name || "指定分类"}连续打卡 ≥ ${item.threshold}天`;
  if (condition.startsWith("category_tasks_")) return `${category?.name || "指定分类"}${label.replace("指定分类", "")} ≥ ${item.threshold}次`;
  if (condition === "no_criticism_week" || condition === "no_criticism_month") return label;
  const unit = condition === "total_earned" || condition === "balance" ? "分" : condition === "streak_days" || condition === "praise_streak" || condition === "no_criticism_days" ? "天" : "次";
  return `${label} ≥ ${item.threshold}${unit}`;
}

export function timezoneOptions() {
  const values = [-720, -600, -480, -300, -240, 0, 330, 480, 540, 600, 720];
  return values.map((value) => {
    const sign = value >= 0 ? "+" : "-";
    const abs = Math.abs(value);
    return { value, label: `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}` };
  });
}
