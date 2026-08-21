import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Award, BadgeCheck, Check, ClipboardCheck, Download, Edit3, Gift, KeyRound,
  MessageSquare, Plus, Printer, RotateCcw, Sparkles, Star, Trash2, Upload, Users, AlertTriangle
} from "lucide-react";
import { Me, Child, Category, Task, TaskSet, Reward, FeedbackTemplate, LedgerRow, WarehouseItem, FeedbackEvent, LedgerResponse, REFRESH_INTERVAL_MS, DEFAULT_WEEKDAYS, ParentAiServiceConfig, CartoonReportResponse, ChecklistImageResponse, ScheduleImageResponse, ParentDelegate, RemedyCriticismItem, ConfigGroupSummary } from "./types/api";
import { api } from "./api/client";
import { Field, Empty, FeedbackToast, Tabs, Toggle, EditDialog, icon, WeekdayPicker, formatPeriod, formatTime, weekdayLabel, rewardDisplayTitle, PrerequisiteEditor, normalizeWeekdaysLocal } from "./components/UI";
import { EmojiSelect } from "./components/EmojiSelect";
import { LedgerModal } from "./components/LedgerModal";
import { Shell } from "./components/Shell";
import { ACHIEVEMENT_CONDITIONS, conditionFromAchievement, achievementPayload, formatAchievementRule } from "./lib/appHelpers";

type ParentAiServiceStoredConfig = Omit<ParentAiServiceConfig, "apiKey"> & { updatedAt?: string };
const EMPTY_AI_DRAFT: ParentAiServiceConfig = { baseUrl: "", model: "", prompt: "", reportPrompt: "", monthlyPrompt: "", hasKey: false, imageBaseUrl: "", imageModel: "gpt-image-2", imagePrompt: "", checklistImagePrompt: "", scheduleImagePrompt: "", imageSize: "1248x1760", imageQuality: "low", imageFormat: "jpeg", imageN: 1, hasImageKey: false };
type CompletionStandard = { label: string; points: number };
function parseCompletionStandards(item: any): CompletionStandard[] {
  if (Array.isArray(item?.completionStandards)) return item.completionStandards;
  try { return JSON.parse(item?.completion_standards_json || "[]"); } catch { return []; }
}
function cleanCompletionStandards(rows: CompletionStandard[]) {
  return rows.map((row) => ({ label: String(row.label || "").trim(), points: Math.max(0, Number(row.points || 0)) })).filter((row) => row.label);
}
type SubmissionDeadline = { weekday?: number; day?: number; time?: string; at?: string };
function parseSubmissionDeadline(item: any): SubmissionDeadline | null {
  if (item?.submissionDeadline && typeof item.submissionDeadline === "object") return item.submissionDeadline;
  try { return JSON.parse(item?.submission_deadline_json || "null"); } catch { return null; }
}
function defaultSubmissionDeadline(period: string): SubmissionDeadline {
  if (period === "daily") return { time: "23:59" };
  if (period === "weekly") return { weekday: 7, time: "23:59" };
  if (period === "monthly") return { day: 31, time: "23:59" };
  return { at: "" };
}
function submissionDeadlineText(period: string, value: SubmissionDeadline | null) {
  if (!value) return "";
  if (period === "daily") return value.time ? `提交截止：每日 ${value.time}` : "";
  if (period === "weekly") return `提交截止：周${["日", "一", "二", "三", "四", "五", "六"][Number(value.weekday || 7) % 7]} ${value.time || ""}`;
  if (period === "monthly") return `提交截止：每月${value.day}日 ${value.time || ""}`;
  return value.at ? `提交截止：${value.at.replace("T", " ")}` : "";
}
function SubmissionDeadlineFields({ period, value, onChange }: { period: string; value: SubmissionDeadline; onChange: (value: SubmissionDeadline) => void }) {
  if (period === "daily") return <Field label="截止时刻"><input required type="time" value={value.time || ""} onChange={(e) => onChange({ time: e.target.value })} /></Field>;
  if (period === "weekly") return <div className="grid two compact-fields">
    <Field label="截止星期"><select value={value.weekday ?? 7} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>周{["一", "二", "三", "四", "五", "六", "日"][day - 1]}</option>)}</select></Field>
    <Field label="截止时刻"><input required type="time" value={value.time || ""} onChange={(e) => onChange({ ...value, time: e.target.value })} /></Field>
  </div>;
  if (period === "monthly") return <div className="grid two compact-fields">
    <Field label="截止日期"><input required type="number" min="1" max="31" value={value.day ?? 31} onChange={(e) => onChange({ ...value, day: Number(e.target.value) })} /></Field>
    <Field label="截止时刻"><input required type="time" value={value.time || ""} onChange={(e) => onChange({ ...value, time: e.target.value })} /></Field>
  </div>;
  return <Field label="截止日期和时间"><input required type="datetime-local" value={value.at || ""} onChange={(e) => onChange({ at: e.target.value })} /></Field>;
}


export function ParentApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskSets, setTaskSets] = useState<TaskSet[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [feedbackTemplates, setFeedbackTemplates] = useState<FeedbackTemplate[]>([]);
  const [configGroups, setConfigGroups] = useState<ConfigGroupSummary[]>([]);
  const [delegates, setDelegates] = useState<ParentDelegate[]>([]);
  const [dashboard, setDashboard] = useState<any>({ children: [], pendingSubmissions: [], pendingRedemptions: [] });
  const [activeTab, setActiveTab] = useState<"pending" | "children" | "settings">("pending");
  const [ledgerChild, setLedgerChild] = useState<{ id: string; display_name: string } | null>(null);
  const [refundChild, setRefundChild] = useState<Child | null>(null);
  const [refundRows, setRefundRows] = useState<WarehouseItem[]>([]);
  const [feedbackChild, setFeedbackChild] = useState<Child | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<FeedbackEvent[]>([]);
  const [reportChild, setReportChild] = useState<Child | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [savedAiConfig, setSavedAiConfig] = useState<ParentAiServiceStoredConfig>({ ...EMPTY_AI_DRAFT });
  const [draftAiConfig, setDraftAiConfig] = useState<ParentAiServiceConfig>({ ...EMPTY_AI_DRAFT });
  const [draftAiApiKey, setDraftAiApiKey] = useState("");
  const [draftImageApiKey, setDraftImageApiKey] = useState("");
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiFetching, setAiFetching] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; error?: string; models?: string[] } | null>(null);
  const [selectedAiTestChildId, setSelectedAiTestChildId] = useState("");
  const [aiPreviewing, setAiPreviewing] = useState<"" | "greeting" | "weeklyReport" | "monthlyReport">("");
  const [aiPreviewResult, setAiPreviewResult] = useState<{ title: string; text: string; type: string; childId: string } | null>(null);
  const [aiPreviewCaching, setAiPreviewCaching] = useState(false);
  const [cartoonReportGenerating, setCartoonReportGenerating] = useState<"" | "weekly" | "monthly">("");
  const [cartoonReportResult, setCartoonReportResult] = useState<(CartoonReportResponse & { title: string }) | null>(null);
  const [checklistImageGenerating, setChecklistImageGenerating] = useState(false);
  const [checklistImageResult, setChecklistImageResult] = useState<(ChecklistImageResponse & { title: string }) | null>(null);
  const [scheduleImageGenerating, setScheduleImageGenerating] = useState(false);
  const [scheduleImageResult, setScheduleImageResult] = useState<(ScheduleImageResponse & { title: string }) | null>(null);
  const [aiConfigLoaded, setAiConfigLoaded] = useState(false);
  const [profileForm, setProfileForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "", operatorLabel: me.role === "child" ? "" : me.operatorLabel || "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const resetTapCount = useRef(0);
  const resetTapTimer = useRef<number | null>(null);
  const loadLockRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const aiDraftInitializedRef = useRef(false);
  const aiDraftDirtyRef = useRef(false);
  const cartoonAbortRef = useRef<AbortController | null>(null);
  const checklistImageAbortRef = useRef<AbortController | null>(null);
  const scheduleImageAbortRef = useRef<AbortController | null>(null);

  function syncAiDraft(nextConfig: ParentAiServiceStoredConfig) {
    setDraftAiConfig({
      baseUrl: nextConfig.baseUrl,
      model: nextConfig.model,
      prompt: nextConfig.prompt,
      reportPrompt: nextConfig.reportPrompt || "",
      monthlyPrompt: nextConfig.monthlyPrompt || "",
      hasKey: nextConfig.hasKey,
      imageBaseUrl: nextConfig.imageBaseUrl || "",
      imageModel: nextConfig.imageModel || "gpt-image-2",
      imagePrompt: nextConfig.imagePrompt || "",
      checklistImagePrompt: nextConfig.checklistImagePrompt || "",
      scheduleImagePrompt: nextConfig.scheduleImagePrompt || "",
      imageSize: nextConfig.imageSize || "1248x1760",
      imageQuality: nextConfig.imageQuality || "low",
      imageFormat: nextConfig.imageFormat || "jpeg",
      imageN: nextConfig.imageN || 1,
      hasImageKey: nextConfig.hasImageKey || false
    });
    setDraftAiApiKey("");
    setDraftImageApiKey("");
    aiDraftInitializedRef.current = true;
    aiDraftDirtyRef.current = false;
  }

  function storeSavedAiConfig(nextConfig: ParentAiServiceStoredConfig) {
    setSavedAiConfig(nextConfig);
    if (nextConfig.model) {
      setAiModels((current) => (current.includes(nextConfig.model) ? current : [nextConfig.model, ...current]));
    }
  }

  function markAiDraftDirty() {
    aiDraftDirtyRef.current = true;
  }

  function updateAiDraft(next: Partial<ParentAiServiceConfig>) {
    markAiDraftDirty();
    setDraftAiConfig((current) => ({ ...current, ...next }));
  }

  function updateAiApiKey(value: string) {
    markAiDraftDirty();
    setDraftAiApiKey(value);
  }

  function updateImageApiKey(value: string) {
    markAiDraftDirty();
    setDraftImageApiKey(value);
  }

  async function previewAiContent(type: "greeting" | "weeklyReport" | "monthlyReport", title: string, childId: string) {
    if (!childId) {
      setError("请先选择一个已启用 AI 的孩子");
      return;
    }
    setAiPreviewing(type);
    setError("");
    try {
      const result = await api<{ text: string }>("/parent/ai-service/preview", {
        method: "POST",
        body: JSON.stringify({ childId, type })
      });
      setAiPreviewResult({ title, text: result.text || "本次没有返回内容", type, childId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 预览失败");
    } finally {
      setAiPreviewing("");
    }
  }

  async function cachePreviewResult(type: string, childId: string, text: string) {
    setAiPreviewCaching(true);
    setError("");
    try {
      await api("/parent/ai-service/preview/cache", {
        method: "POST",
        body: JSON.stringify({ childId, type, text })
      });
      setAiPreviewResult(null);
      setMessage("已成功写入缓存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "写入缓存失败");
    } finally {
      setAiPreviewCaching(false);
    }
  }

  async function load() {
    if (loadLockRef.current) return;
    loadLockRef.current = true;
    let hasError = false;
    try {
      const [childRows, categoryRows, taskRows, taskSetRows, rewardRows, achievementRows, feedbackRows, groupRows, delegateRows, dash, aiRows] = await Promise.all([
        api<Child[]>("/children").catch(() => { hasError = true; return [] as Child[]; }),
        api<Category[]>("/task-categories").catch(() => { hasError = true; return [] as Category[]; }),
        api<Task[]>("/tasks").catch(() => { hasError = true; return [] as Task[]; }),
        api<TaskSet[]>("/task-sets").catch(() => { hasError = true; return [] as TaskSet[]; }),
        api<Reward[]>("/rewards").catch(() => { hasError = true; return [] as Reward[]; }),
        api<any[]>("/achievements").catch(() => { hasError = true; return []; }),
        api<FeedbackTemplate[]>("/feedback-templates").catch(() => { hasError = true; return [] as FeedbackTemplate[]; }),
        api<ConfigGroupSummary[]>("/config-groups").catch(() => { hasError = true; return [] as ConfigGroupSummary[]; }),
        me.role === "parent" ? api<ParentDelegate[]>("/parent/delegates").catch(() => []) : Promise.resolve([] as ParentDelegate[]),
        api<any>("/dashboard/parent").catch(() => { hasError = true; return { pendingSubmissions: [], pendingRedemptions: [], children: [] }; }),
        api<ParentAiServiceStoredConfig>("/parent/ai-service").catch(() => ({ ...EMPTY_AI_DRAFT, updatedAt: "" }))
      ]);
      setChildren(childRows);
      setCategories(categoryRows);
      setTasks(taskRows);
      setTaskSets(taskSetRows);
      setRewards(rewardRows);
      setAchievements(achievementRows);
      setFeedbackTemplates(feedbackRows);
      setConfigGroups(groupRows);
      setDelegates(delegateRows);
      setDashboard(dash);
      storeSavedAiConfig(aiRows as ParentAiServiceStoredConfig);
      if (hasError) setError("部分数据加载失败，可点击重试");
    } catch (err) {
      setError("加载数据失败，可点击重试");
    } finally {
      setAiConfigLoaded(true);
      loadLockRef.current = false;
    }
  }

  async function loadDashboard() {
    if (loadLockRef.current) return;
    try {
      setDashboard(await api<any>("/dashboard/parent"));
    } catch {
      setError("待办数据加载失败，可点击重试");
    }
  }
  useEffect(() => {
    void load();
    pollingRef.current = window.setInterval(() => void loadDashboard(), REFRESH_INTERVAL_MS);
    function onVisibility() {
      if (document.hidden) {
        if (pollingRef.current !== null) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      } else if (pollingRef.current === null) {
        void loadDashboard();
        pollingRef.current = window.setInterval(() => void loadDashboard(), REFRESH_INTERVAL_MS);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (pollingRef.current !== null) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (activeTab !== "settings" || !aiConfigLoaded || aiDraftInitializedRef.current || aiDraftDirtyRef.current) return;
    syncAiDraft(savedAiConfig);
  }, [activeTab, aiConfigLoaded, savedAiConfig.baseUrl, savedAiConfig.model, savedAiConfig.prompt, savedAiConfig.hasKey, savedAiConfig.imageBaseUrl, savedAiConfig.imageModel, savedAiConfig.imagePrompt, savedAiConfig.checklistImagePrompt, savedAiConfig.hasImageKey]);
  useEffect(() => {
    if (activeTab !== "settings") return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".settings-surface > .setting-group").forEach((section, index) => {
        if (section.classList.contains("config-groups-panel")) { section.classList.add("is-open"); return; }
        const title = section.querySelector<HTMLElement>(":scope > .panel-title");
        if (!title || title.querySelector(".settings-collapse-toggle")) return;
        section.classList.add("is-collapsed");
        title.classList.add("collapsible-title");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon settings-collapse-toggle";
        button.setAttribute("aria-label", "展开设置区域");
        button.setAttribute("title", "展开设置区域");
        button.textContent = "▼";
        button.addEventListener("click", () => {
          const collapsed = section.classList.toggle("is-collapsed");
          section.classList.toggle("is-open", !collapsed);
          button.textContent = collapsed ? "▼" : "▲";
          button.setAttribute("aria-label", collapsed ? "展开设置区域" : "收起设置区域");
          button.setAttribute("title", collapsed ? "展开设置区域" : "收起设置区域");
        });
        title.appendChild(button);
        title.dataset.sectionIndex = String(index);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, tasks.length, rewards.length, achievements.length, feedbackTemplates.length, children.length]);
  useEffect(() => {
    if (ledgerChild) void loadLedger(ledgerChild);
  }, [dashboard, ledgerChild?.id]);
  useEffect(() => () => {
    if (resetTapTimer.current) window.clearTimeout(resetTapTimer.current);
  }, []);

  async function loadLedger(child: { id: string; display_name: string }) {
    setLedgerChild(child);
    const data = await api<LedgerResponse>(`/points/ledger?childId=${encodeURIComponent(child.id)}`).catch(() => ({ items: [], timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00" }));
    setLedger(data.items);
  }

  async function run(action: () => Promise<void>, note: string) {
    setError("");
    try {
      await action();
      setMessage(note);
      await load();
      window.dispatchEvent(new CustomEvent("app:refresh-notifications"));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return false;
    }
  }

  async function create(path: string, data: Record<string, unknown>, note: string) {
    return run(() => api(path, { method: "POST", body: JSON.stringify(data) }), note);
  }

  async function update(path: string, data: Record<string, unknown>, note: string) {
    return run(() => api(path, { method: "PATCH", body: JSON.stringify(data) }), note);
  }

  async function remove(path: string, note: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    await run(() => api(path, { method: "DELETE" }), note);
  }

  async function createConfigGroup(name: string) {
    await run(() => api("/config-groups", { method: "POST", body: JSON.stringify({ name }) }), "配置组已保存");
  }

  async function renameConfigGroup(group: ConfigGroupSummary, name: string) {
    await run(() => api(`/config-groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ name }) }), "配置组已重命名");
  }

  async function refreshConfigGroup(group: ConfigGroupSummary) {
    if (!window.confirm(`确认用当前设置覆盖配置组「${group.name}」的内容？`)) return;
    await run(() => api(`/config-groups/${group.id}/refresh`, { method: "POST", body: JSON.stringify({}) }), "配置组内容已更新");
  }

  async function activateConfigGroup(group: ConfigGroupSummary) {
    if (!window.confirm(`确认激活配置组「${group.name}」？当前任务、奖励、成就称号和条款会被该配置组覆盖，历史记录会保留。`)) return;
    await run(() => api(`/config-groups/${group.id}/activate`, { method: "POST", body: JSON.stringify({}) }), "配置组已激活");
  }

  async function deleteConfigGroup(group: ConfigGroupSummary) {
    if (!window.confirm(`确认删除配置组「${group.name}」？配置组内保存的内容会一并删除，当前已应用的设置不受影响。`)) return;
    await run(() => api(`/config-groups/${group.id}`, { method: "DELETE" }), "配置组已删除");
  }

  async function clearCurrentConfig() {
    if (!window.confirm("确认清空当前任务配置、奖励配置、成就称号和批评与奖励条款？历史记录会保留，配置组快照不受影响。")) return;
    await run(() => api("/config/clear-current", { method: "POST", body: JSON.stringify({}) }), "当前配置已清空");
  }

  async function review(id: string, approved: boolean, completionLabel = "") {
    if (!approved) {
      const note = window.prompt("请输入驳回原因，孩子会看到这条说明", "");
      if (note === null) return;
      await run(
        () => api(`/task-submissions/${id}/review`, { method: "PATCH", body: JSON.stringify({ approved, note }) }),
        "任务已驳回"
      );
      return;
    }
    await run(
      () => api(`/task-submissions/${id}/review`, { method: "PATCH", body: JSON.stringify({ approved, note: "", completionLabel }) }),
      "任务已通过，积分将按适用规则结算"
    );
  }

  async function finishRedemption(id: string, action: "redeem" | "cancel") {
    await run(
      () => api(`/reward-redemptions/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) }),
      action === "redeem" ? "奖励已核销" : "兑换已取消并退回积分"
    );
  }

  const [editChild, setEditChild] = useState<Child | null>(null);

  async function saveChild(child: Child, data: any) {
    if (await run(() => api(`/children/${child.id}`, { method: "PATCH", body: JSON.stringify(data) }), "孩子账号已更新"))
      setEditChild(null);
  }

  async function toggleChild(child: Child) {
    const status = child.status === "active" ? "disabled" : "active";
    await run(() => api(`/children/${child.id}`, { method: "PATCH", body: JSON.stringify({ status }) }), status === "active" ? "孩子账号已启用" : "孩子账号已停用");
  }

  async function deleteChild(child: Child) {
    if (!window.confirm(`确认归档 ${child.display_name} 的账号？历史记录会保留。`)) return;
    await run(() => api(`/children/${child.id}`, { method: "DELETE" }), "孩子账号已归档");
  }

  async function resetProgress() {
    if (!import.meta.env.DEV) return;
    if (!window.confirm("确认清空当前家长全部孩子的积分、任务、奖励与成就进度？账号和配置会保留。")) return;
    await run(() => api("/testing/reset-parent-progress", { method: "POST", body: JSON.stringify({}) }), "测试进度已重置");
  }

  function tapHiddenReset() {
    if (!import.meta.env.DEV) return;
    if (resetTapTimer.current) window.clearTimeout(resetTapTimer.current);
    resetTapCount.current += 1;
    if (resetTapCount.current >= 5) {
      resetTapCount.current = 0;
      void resetProgress();
      return;
    }
    resetTapTimer.current = window.setTimeout(() => {
      resetTapCount.current = 0;
      resetTapTimer.current = null;
    }, 2000);
  }

  async function updateProfile(event: React.FormEvent) {
    event.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      setMessage("");
      setError("两次输入的新密码不一致");
      return;
    }
    await run(async () => {
      await api("/parent/profile", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword,
          operatorLabel: profileForm.operatorLabel
        })
      });
      setProfileForm((current) => ({ ...current, currentPassword: "", newPassword: "", confirmPassword: "" }));
    }, profileForm.newPassword ? "密码和称谓已更新" : "称谓已更新");
  }

  async function applyFeedback(data: { childId: string; templateId: string }) {
    await run(
      () => api(`/children/${data.childId}/feedback-events`, { method: "POST", body: JSON.stringify({ templateId: data.templateId }) }),
      "表扬与批评已记录"
    );
  }

  async function exemptRequiredPenalty(data: { childId: string; taskId: string }) {
    await run(
      () => api(`/tasks/${data.taskId}/required-penalty-exemptions`, { method: "POST", body: JSON.stringify({ childId: data.childId }) }),
      "本周期必做扣分已豁免"
    );
  }

  async function revokeRequiredPenaltyExemption(data: { childId: string; taskId: string }) {
    await run(
      () => api(`/tasks/${data.taskId}/required-penalty-exemptions`, { method: "DELETE", body: JSON.stringify({ childId: data.childId }) }),
      "本周期必做扣分豁免已撤销"
    );
  }

  async function exemptSubmissionDeadline(data: { childId: string; taskId: string }) {
    await run(
      () => api(`/tasks/${data.taskId}/submission-deadline-exemptions`, { method: "POST", body: JSON.stringify({ childId: data.childId }) }),
      "本周期提交截止时间已解除"
    );
  }

  async function revokeSubmissionDeadlineExemption(data: { childId: string; taskId: string }) {
    await run(
      () => api(`/tasks/${data.taskId}/submission-deadline-exemptions`, { method: "DELETE", body: JSON.stringify({ childId: data.childId }) }),
      "本周期提交截止时间解除已撤销"
    );
  }

  function exportChildPrint(child: Child) {
    window.open(`/api/children/${encodeURIComponent(child.id)}/export-print`, "_blank", "noopener,noreferrer");
  }

  function exportChildReport(child: Child, period: "weekly" | "monthly") {
    window.open(`/api/children/${encodeURIComponent(child.id)}/report?period=${period}`, "_blank", "noopener,noreferrer");
  }
  function exportChildSchedulePrint(child: Child) {
    window.open(`/api/children/${encodeURIComponent(child.id)}/schedule-print`, "_blank", "noopener,noreferrer");
  }

  async function pollCartoonReport(job: CartoonReportResponse, title: string, signal: AbortSignal): Promise<{ job: CartoonReportResponse; aborted: boolean }> {
    if (!job.id || job.status === "completed" || job.status === "failed") {
      if (!signal.aborted) setCartoonReportResult({ ...job, title });
      return { job, aborted: signal.aborted };
    }
    let last: CartoonReportResponse = job;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (signal.aborted) return { job: last, aborted: true };
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal.aborted) return { job: last, aborted: true };
      const next = await api<CartoonReportResponse>(`/parent/ai-service/cartoon-report/${job.id}`);
      last = next;
      if (signal.aborted) return { job: next, aborted: true };
      setCartoonReportResult({ ...next, title });
      if (next.status === "completed" || next.status === "failed") return { job: next, aborted: false };
    }
    return { job: last, aborted: signal.aborted };
  }

  async function generateCartoonReport(child: Child, period: "weekly" | "monthly", retry = false, force = false) {
    cartoonAbortRef.current?.abort();
    const controller = new AbortController();
    cartoonAbortRef.current = controller;
    setCartoonReportGenerating(period);
    setError("");
    try {
      const result = await api<CartoonReportResponse>("/parent/ai-service/cartoon-report", {
        method: "POST",
        body: JSON.stringify({ childId: child.id, period, retry, force })
      });
      const title = `${child.display_name} ${period === "monthly" ? "上月月报" : "上周周报"}卡通报告`;
      setCartoonReportResult({ ...result, title });
      const final = await pollCartoonReport(result, title, controller.signal);
      if (final.aborted) {
        if (final.job.status === "completed" && final.job.imageUrl) {
          setMessage("卡通报告已在后台生成完成，可重新进入“报表”查看");
        } else if (final.job.status === "failed") {
          setError(`卡通报告生成失败：${final.job.lastError || "未知错误"}`);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "卡通报告生成失败");
    } finally {
      if (cartoonAbortRef.current === controller) {
        cartoonAbortRef.current = null;
        setCartoonReportGenerating("");
      }
    }
  }

  async function pollChecklistImage(job: ChecklistImageResponse, title: string, signal: AbortSignal): Promise<{ job: ChecklistImageResponse; aborted: boolean }> {
    if (!job.id || job.status === "completed" || job.status === "failed") {
      if (!signal.aborted) setChecklistImageResult({ ...job, title });
      return { job, aborted: signal.aborted };
    }
    let last: ChecklistImageResponse = job;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (signal.aborted) return { job: last, aborted: true };
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal.aborted) return { job: last, aborted: true };
      const next = await api<ChecklistImageResponse>(`/children/${encodeURIComponent(String(job.childId || ""))}/print-checklist-image/${job.id}`);
      last = next;
      if (signal.aborted) return { job: next, aborted: true };
      setChecklistImageResult({ ...next, title });
      if (next.status === "completed" || next.status === "failed") return { job: next, aborted: false };
    }
    return { job: last, aborted: signal.aborted };
  }

  async function generateChecklistImage(child: Child, retry = false, force = false) {
    checklistImageAbortRef.current?.abort();
    const controller = new AbortController();
    checklistImageAbortRef.current = controller;
    setChecklistImageGenerating(true);
    setError("");
    const title = `${child.display_name} 打印清单绘图`;
    try {
      const result = await api<ChecklistImageResponse>(`/children/${encodeURIComponent(child.id)}/print-checklist-image`, {
        method: "POST",
        body: JSON.stringify({ retry, force })
      });
      setChecklistImageResult({ ...result, title });
      const final = await pollChecklistImage(result, title, controller.signal);
      if (final.aborted) return;
      if (final.job.status === "failed") setError(`打印清单图片生成失败：${final.job.lastError || "未知错误"}`);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "打印清单图片生成失败");
    } finally {
      if (checklistImageAbortRef.current === controller) {
        checklistImageAbortRef.current = null;
        setChecklistImageGenerating(false);
      }
    }
  }

  async function pollScheduleImage(job: ScheduleImageResponse, title: string, signal: AbortSignal): Promise<{ job: ScheduleImageResponse; aborted: boolean }> {
    if (!job.id || job.status === "completed" || job.status === "failed") {
      if (!signal.aborted) setScheduleImageResult({ ...job, title });
      return { job, aborted: signal.aborted };
    }
    let last: ScheduleImageResponse = job;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (signal.aborted) return { job: last, aborted: true };
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal.aborted) return { job: last, aborted: true };
      const next = await api<ScheduleImageResponse>(`/children/${encodeURIComponent(String(job.childId || ""))}/schedule-image/${job.id}`);
      last = next;
      if (signal.aborted) return { job: next, aborted: true };
      setScheduleImageResult({ ...next, title });
      if (next.status === "completed" || next.status === "failed") return { job: next, aborted: false };
    }
    return { job: last, aborted: signal.aborted };
  }

  async function generateScheduleImage(child: Child, retry = false, force = false) {
    scheduleImageAbortRef.current?.abort();
    const controller = new AbortController();
    scheduleImageAbortRef.current = controller;
    setScheduleImageGenerating(true);
    setError("");
    const title = `${child.display_name} 日程表绘图`;
    try {
      const result = await api<ScheduleImageResponse>(`/children/${encodeURIComponent(child.id)}/schedule-image`, {
        method: "POST",
        body: JSON.stringify({ retry, force })
      });
      setScheduleImageResult({ ...result, title });
      const final = await pollScheduleImage(result, title, controller.signal);
      if (final.aborted) return;
      if (final.job.status === "failed") setError(`日程表图片生成失败：${final.job.lastError || "未知错误"}`);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "日程表图片生成失败");
    } finally {
      if (scheduleImageAbortRef.current === controller) {
        scheduleImageAbortRef.current = null;
        setScheduleImageGenerating(false);
      }
    }
  }

  async function refundChildReward(child: Child) {
    const rows = await api<WarehouseItem[]>(`/children/${encodeURIComponent(child.id)}/warehouse`).catch(() => []);
    setRefundRows(rows);
    setRefundChild(child);
  }

  async function refundSelectedRewards(ids: string[]) {
    if (!ids.length) return;
    await run(
      () => Promise.all(ids.map((id) => api(`/reward-redemptions/${id}/refund`, { method: "PATCH", body: JSON.stringify({}) }))).then(() => undefined),
      ids.length > 1 ? "奖励积分已批量退还" : "奖励积分已退还"
    );
    setRefundChild(null);
    setRefundRows([]);
  }

  async function openFeedbackRecall(child: Child) {
    const rows = await api<FeedbackEvent[]>(`/children/${encodeURIComponent(child.id)}/feedback-events`).catch(() => []);
    setFeedbackRows(rows);
    setFeedbackChild(child);
  }

  async function recallSelectedFeedback(ids: string[]) {
    if (!ids.length) return;
    if (!feedbackChild) return;
    await run(
      () => Promise.all(ids.map((id) => api(`/feedback-events/${encodeURIComponent(id)}/recall`, { method: "PATCH", body: JSON.stringify({}) }))).then(() => undefined),
      ids.length > 1 ? "表扬/批评已批量撤回" : "表扬/批评已撤回"
    );
    setFeedbackChild(null);
    setFeedbackRows([]);
  }

  async function confirmRemedy(id: string, sourceType = "criticism") {
    await run(
      () => api(sourceType === "task_required_penalty" ? `/task-required-penalties/${encodeURIComponent(id)}/remedy` : `/feedback-events/${encodeURIComponent(id)}/remedy`, { method: "PATCH", body: JSON.stringify({}) }),
      "补救已确认，冻结积分已结算"
    );
  }

  async function createDelegate(data: Record<string, unknown>) {
    await run(() => api("/parent/delegates", { method: "POST", body: JSON.stringify(data) }), "协同管理账号已创建");
  }

  async function updateDelegate(delegate: ParentDelegate, data: Record<string, unknown>) {
    await run(() => api(`/parent/delegates/${delegate.id}`, { method: "PATCH", body: JSON.stringify(data) }), "协同管理账号已更新");
  }

  async function deleteDelegate(delegate: ParentDelegate) {
    if (!window.confirm(`确认停用协同管理账号“${delegate.display_name}”？`)) return;
    await run(() => api(`/parent/delegates/${delegate.id}`, { method: "DELETE" }), "协同管理账号已停用");
  }

  const aiDraftApiKeyValue = draftAiApiKey.trim();
  const imageDraftApiKeyValue = draftImageApiKey.trim();
  const aiFetchApiKey = aiDraftApiKeyValue;
  const aiTestChildren = children.filter((child) => child.ai_enabled === 1 && child.status === "active");
  const aiTestChildId = selectedAiTestChildId || aiTestChildren[0]?.id || "";

  return (
    <Shell me={me} refresh={refresh} onQuickAction={() => void load()}>
      <section className="hero-band parent">
        <div>
          <p className="hidden-reset-trigger" onClick={tapHiddenReset}>家长面板</p>
          <h1>今天需要处理的事情</h1>
        </div>
        <div className="hero-actions">
          <div className="metric">
            <ClipboardCheck />
            <strong>{dashboard.pendingSubmissions?.length || 0}</strong>
            <span>待审核</span>
          </div>
          <div className="metric">
            <Gift />
            <strong>{dashboard.pendingRedemptions?.length || 0}</strong>
            <span>待核销</span>
          </div>
        </div>
      </section>
      <FeedbackToast message={message} error={error} onDismiss={() => { setMessage(""); setError(""); }} />
      {error && <div className="actions" style={{ justifyContent: "center", marginBottom: "0.5rem" }}><button className="secondary" onClick={() => void load()}>重试</button></div>}

      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as typeof activeTab)}
        options={[
          { value: "pending", label: "待处理事务" },
          { value: "children", label: "儿童管理" },
          { value: "settings", label: "设置" }
        ]}
      />

      {activeTab === "pending" && (
        <>
          <div className="dashboard-strip">
            {dashboard.children?.map((child: Child) => (
              <button className="child-tile clickable" key={child.id} onClick={() => void loadLedger(child)}>
                <span>{child.display_name}</span>
                <strong>{child.balance || 0}</strong>
                <small>积分</small>
                {(child.frozenPoints || 0) > 0 && <small className="frozen-tag">{child.frozenPoints}积分冻结中</small>}
              </button>
            ))}
          </div>
          <div className="grid two">
            <ReviewPanel title="任务审核" items={dashboard.pendingSubmissions || []} empty="没有待审核任务" approve={(id, completionLabel) => review(id, true, completionLabel)} reject={(id) => review(id, false)} />
            <RedemptionPanel items={dashboard.pendingRedemptions || []} onFinish={finishRedemption} />
          </div>
          <div className="grid two">
            <PraiseCriticismPanel children={children} templates={feedbackTemplates.filter((item) => item.is_active !== 0)} onSubmit={applyFeedback} remedyItems={[...(dashboard.remedyCriticisms || []), ...(dashboard.requiredPenaltyRemedies || [])]} onRemedy={(id, sourceType) => void confirmRemedy(id, sourceType)} />
            <RequiredPenaltyExemptionPanel children={children} tasks={tasks} exemptions={dashboard.requiredPenaltyExemptions || []} onSubmit={exemptRequiredPenalty} onRevoke={revokeRequiredPenaltyExemption} />
            <SubmissionDeadlineExemptionPanel children={children} tasks={tasks} exemptions={dashboard.submissionDeadlineExemptions || []} onSubmit={exemptSubmissionDeadline} onRevoke={revokeSubmissionDeadlineExemption} />
          </div>
        </>
      )}

      {activeTab === "children" && (
        <>
          <div className="grid two">
            <CreateChild onCreate={(data) => create("/children", data, "孩子账号已创建")} />
            <ChildManager children={children} onEdit={(child) => setEditChild(child)} onToggle={toggleChild} onDelete={deleteChild} onReport={(child) => setReportChild(child)} onRefund={(child) => void refundChildReward(child)} onFeedbackRecall={(child) => void openFeedbackRecall(child)} />
          </div>
        </>
      )}

      {activeTab === "settings" && (
        <div className="settings-surface">
          <ConfigGroupsPanel
            groups={configGroups}
            onCreate={(name) => void createConfigGroup(name)}
            onRename={(group, name) => void renameConfigGroup(group, name)}
            onRefresh={(group) => void refreshConfigGroup(group)}
            onActivate={(group) => void activateConfigGroup(group)}
            onDelete={(group) => void deleteConfigGroup(group)}
            onClearCurrent={() => void clearCurrentConfig()}
          />
          <section className="panel setting-group">
            <div className="panel-title"><Star /><h2>任务配置</h2></div>
            <div className="grid two">
              <CreateTask children={children} categories={categories} onCreate={(data) => create("/tasks", data, "任务已创建")} />
              <CategoryOverview
                items={categories}
                onCreate={(data) => create("/task-categories", data, "任务分类已创建")}
                onUpdate={(item, data) => update(`/task-categories/${item.id}`, data, "任务分类已更新")}
                onDelete={(item) => remove(`/task-categories/${item.id}`, "任务分类已删除，分类下任务已一并删除", `确认删除任务分类「${item.name}」？该分类下所有任务会一并删除，历史记录会保留。`)}
              />
            </div>
            <TaskSetsPanel
              taskSets={taskSets}
              tasks={tasks}
              children={children}
              onCreate={(data) => create("/task-sets", data, "任务集已创建")}
              onUpdate={(item, data) => update(`/task-sets/${item.id}`, data, "任务集已更新")}
              onDelete={(item) => remove(`/task-sets/${item.id}`, "任务集已解散", `确认解散任务集「${item.title}」？之后子任务将恢复独立计分。`)}
            />
            <Overview title="现有任务" items={tasks} kind="task" children={children} categories={categories} onUpdate={(item, data) => update(`/tasks/${item.id}`, data, "任务已更新")} onDelete={(item) => remove(`/tasks/${item.id}`, "任务已删除", `确认删除任务「${item.title}」？历史记录会保留。`)} />
          </section>
          <section className="panel setting-group">
            <div className="panel-title"><Gift /><h2>奖励配置</h2></div>
              <CreateReward children={children} tasks={tasks} achievements={achievements} onCreate={(data) => create("/rewards", data, "奖励已创建")} />
            <Overview title="现有奖励" items={rewards} kind="reward" children={children} tasks={tasks} achievements={achievements} onUpdate={(item, data) => update(`/rewards/${item.id}`, data, "奖励已更新")} onDelete={(item) => remove(`/rewards/${item.id}`, "奖励已删除", `确认删除奖励「${item.title}」？历史兑换记录会保留。`)} />
          </section>
          <section className="panel setting-group">
            <div className="panel-title"><Award /><h2>成就称号</h2></div>
            <CreateAchievement tasks={tasks} categories={categories} onCreate={(data) => create("/achievements", data, "成就称号已创建")} />
            <Overview title="成就称号" items={achievements} kind="achievement" tasks={tasks} categories={categories} onUpdate={(item, data) => update(`/achievements/${item.id}`, data, "成就称号已更新")} onDelete={(item) => remove(`/achievements/${item.id}`, "成就称号已删除", `确认删除成就称号「${item.title}」？已解锁历史会保留。`)} />
          </section>
          <section className="panel setting-group">
            <div className="panel-title"><MessageSquare /><h2>表扬与批评条款</h2></div>
            <CreateFeedbackTemplate onCreate={(data) => create("/feedback-templates", data, "条款已创建")} />
            <FeedbackOverview items={feedbackTemplates} onUpdate={(item, data) => update(`/feedback-templates/${item.id}`, data, "条款已更新")} onDelete={(item) => remove(`/feedback-templates/${item.id}`, "条款已删除", `确认删除${item.kind === "praise" ? "表扬" : "批评"}条款「${item.title}」？历史积分记录会保留。`)} />
          </section>
          <ConfigPortPanel onImported={load} />
          {me.role === "parent" && (
            <DelegateManager
              delegates={delegates}
              onCreate={(data) => void createDelegate(data)}
              onUpdate={(delegate, data) => void updateDelegate(delegate, data)}
              onDelete={(delegate) => void deleteDelegate(delegate)}
            />
          )}
          <section className="panel setting-group">
            <div className="panel-title"><KeyRound /><h2>修改密码</h2></div>
            <form className="stack compact" onSubmit={updateProfile}>
              <Field label="操作者称谓">
                <input value={profileForm.operatorLabel} onChange={(e) => setProfileForm({ ...profileForm, operatorLabel: e.target.value })} placeholder={me.displayName} />
              </Field>
              <Field label="当前密码">
                <input value={profileForm.currentPassword} onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })} type="password" autoComplete="current-password" />
              </Field>
              <Field label="新密码">
                <input value={profileForm.newPassword} onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })} type="password" autoComplete="new-password" />
              </Field>
              <Field label="确认新密码">
                <input value={profileForm.confirmPassword} onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} type="password" autoComplete="new-password" />
              </Field>
              <button className="primary"><KeyRound size={18} />保存账号设置</button>
            </form>
          </section>
          <section className="panel setting-group">
            <div className="panel-title">
              <Sparkles />
              <h2>AI 服务</h2>
            </div>
            <form className="stack compact" onSubmit={async (event) => {
              event.preventDefault();
              const nextApiKey = aiDraftApiKeyValue;
              const nextImageApiKey = imageDraftApiKeyValue;
              await run(async () => {
                const response = await api<Partial<ParentAiServiceStoredConfig>>("/parent/ai-service", {
                  method: "PATCH",
                  body: JSON.stringify({
                    baseUrl: draftAiConfig.baseUrl,
                    apiKey: nextApiKey || undefined,
                    model: draftAiConfig.model,
                    prompt: draftAiConfig.prompt,
                    reportPrompt: draftAiConfig.reportPrompt,
                    monthlyPrompt: draftAiConfig.monthlyPrompt,
                    imageBaseUrl: draftAiConfig.imageBaseUrl,
                    imageApiKey: nextImageApiKey || undefined,
                    imageModel: draftAiConfig.imageModel,
                    imagePrompt: draftAiConfig.imagePrompt,
                    checklistImagePrompt: draftAiConfig.checklistImagePrompt,
                    scheduleImagePrompt: draftAiConfig.scheduleImagePrompt,
                    imageSize: draftAiConfig.imageSize,
                    imageQuality: draftAiConfig.imageQuality,
                    imageFormat: draftAiConfig.imageFormat,
                    imageN: draftAiConfig.imageN
                  })
                });
                const nextSaved: ParentAiServiceStoredConfig = {
                  ...savedAiConfig,
                  ...response,
                  baseUrl: response.baseUrl ?? draftAiConfig.baseUrl,
                  model: response.model ?? draftAiConfig.model,
                  prompt: response.prompt ?? draftAiConfig.prompt,
                  hasKey: (response.hasKey ?? savedAiConfig.hasKey) || !!nextApiKey,
                  imageBaseUrl: response.imageBaseUrl ?? draftAiConfig.imageBaseUrl,
                  imageModel: response.imageModel ?? draftAiConfig.imageModel,
                  imagePrompt: response.imagePrompt ?? draftAiConfig.imagePrompt,
                  checklistImagePrompt: response.checklistImagePrompt ?? draftAiConfig.checklistImagePrompt,
                  scheduleImagePrompt: response.scheduleImagePrompt ?? draftAiConfig.scheduleImagePrompt,
                  imageSize: response.imageSize ?? draftAiConfig.imageSize,
                  imageQuality: response.imageQuality ?? draftAiConfig.imageQuality,
                  imageFormat: response.imageFormat ?? draftAiConfig.imageFormat,
                  imageN: response.imageN ?? draftAiConfig.imageN,
                  hasImageKey: (response.hasImageKey ?? savedAiConfig.hasImageKey) || !!nextImageApiKey,
                  updatedAt: response.updatedAt ?? savedAiConfig.updatedAt
                };
                storeSavedAiConfig(nextSaved);
                syncAiDraft(nextSaved);
              }, "AI 服务配置已保存");
            }}>
              <div className="setting-section">
                <h3>寄语与评语生成</h3>
                <Field label="Base URL">
                  <input value={draftAiConfig.baseUrl} onChange={(e) => updateAiDraft({ baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
                </Field>
                <Field label="API Key">
                  <input value={draftAiApiKey} onChange={(e) => updateAiApiKey(e.target.value)} type="password" placeholder={savedAiConfig.hasKey ? "已设置，留空则保留" : "请输入 API Key"} autoComplete="new-password" />
                </Field>
                <div className="inline-fields">
                  <button type="button" className="secondary" disabled={aiTesting || !draftAiConfig.baseUrl} onClick={async () => {
                    setAiTesting(true);
                    setAiTestResult(null);
                    try {
                      const testBody: { baseUrl: string; apiKey?: string; model?: string } = { baseUrl: draftAiConfig.baseUrl };
                      if (aiFetchApiKey) testBody.apiKey = aiFetchApiKey;
                      if (draftAiConfig.model) testBody.model = draftAiConfig.model;
                      const result = await api<{ ok: boolean; error?: string; models?: string[] }>("/parent/ai-service/test", { method: "POST", body: JSON.stringify(testBody) });
                      setAiTestResult(result);
                      if (result.models?.length) setAiModels(result.models);
                    } catch (err) {
                      setAiTestResult({ ok: false, error: err instanceof Error ? err.message : "测试失败" });
                    } finally { setAiTesting(false); }
                  }}>{aiTesting ? "测试中..." : "测试连接"}</button>
                  {aiTestResult && (
                    <span className={aiTestResult.ok ? "success-text" : "error-text"} style={{ fontSize: "0.9em" }}>
                      {aiTestResult.ok ? "✓ 连接成功" + (aiTestResult.models?.length ? `（${aiTestResult.models.length} 个模型）` : "") : "✗ " + (aiTestResult.error || "失败")}
                    </span>
                  )}
                </div>
                <Field label="模型">
                  <div className="inline-fields">
                    <input
                      list="ai-model-options"
                      value={draftAiConfig.model}
                      onChange={(e) => updateAiDraft({ model: e.target.value })}
                      placeholder="输入或选择模型"
                      style={{ flex: 1 }}
                    />
                    <datalist id="ai-model-options">
                      {aiModels.map((model) => <option key={model} value={model} />)}
                    </datalist>
                    <button type="button" className="secondary" disabled={aiFetching || !draftAiConfig.baseUrl} onClick={async () => { setAiFetching(true); try { const modelsBody: { baseUrl: string; apiKey?: string } = { baseUrl: draftAiConfig.baseUrl }; if (aiFetchApiKey) modelsBody.apiKey = aiFetchApiKey; const data = await api<{ models: string[] }>("/parent/ai-service/models", { method: "POST", body: JSON.stringify(modelsBody) }); setAiModels(data.models); if (data.models.length && !draftAiConfig.model) updateAiDraft({ model: data.models[0] }); } catch (err) { setError(err instanceof Error ? err.message : "拉取失败"); } finally { setAiFetching(false); } }}>{aiFetching ? "获取中..." : "拉取模型"}</button>
                  </div>
                </Field>
                <Field label="寄语提示词">
                  <textarea value={draftAiConfig.prompt} onChange={(e) => updateAiDraft({ prompt: e.target.value })} rows={4} />
                </Field>
                <Field label="周报评语提示词">
                  <textarea value={draftAiConfig.reportPrompt || ""} onChange={(e) => updateAiDraft({ reportPrompt: e.target.value })} rows={3} placeholder="留空使用默认提示词" />
                </Field>
                <Field label="月报评语提示词">
                  <textarea value={draftAiConfig.monthlyPrompt || ""} onChange={(e) => updateAiDraft({ monthlyPrompt: e.target.value })} rows={3} placeholder="留空使用默认提示词" />
                </Field>
              </div>
              <hr className="ai-section-divider" />
              <div className="setting-section">
                <h3>绘图配置</h3>
                <Field label="绘图 Base URL">
                  <input value={draftAiConfig.imageBaseUrl || ""} onChange={(e) => updateAiDraft({ imageBaseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                </Field>
                <Field label="绘图 API Key">
                  <input value={draftImageApiKey} onChange={(e) => updateImageApiKey(e.target.value)} type="password" placeholder={savedAiConfig.hasImageKey ? "已设置，留空则保留" : "请输入绘图 API Key"} autoComplete="new-password" />
                </Field>
                <Field label="绘图模型">
                  <input value={draftAiConfig.imageModel || "gpt-image-2"} onChange={(e) => updateAiDraft({ imageModel: e.target.value })} placeholder="gpt-image-2" />
                </Field>
                <Field label="绘图提示词">
                  <textarea value={draftAiConfig.imagePrompt || ""} onChange={(e) => updateAiDraft({ imagePrompt: e.target.value })} rows={4} placeholder="绘制一张儿童绘本风格的成长报告卡片，画面温暖明亮，突出孩子的努力和成就。" />
                </Field>
                <Field label="打印清单绘图提示词">
                  <textarea value={draftAiConfig.checklistImagePrompt || ""} onChange={(e) => updateAiDraft({ checklistImagePrompt: e.target.value })} rows={4} placeholder="为孩子的打印清单绘制一张清晰、温暖、适合贴在墙上的任务奖励海报。" />
                </Field>
                <Field label="日程表绘图提示词">
                  <textarea value={draftAiConfig.scheduleImagePrompt || ""} onChange={(e) => updateAiDraft({ scheduleImagePrompt: e.target.value })} rows={4} placeholder="为孩子的每日日程表绘制一张清晰、温暖的插画，展示各时段安排。" />
                </Field>
                <div className="grid two compact-fields">
                  <Field label="尺寸">
                    <select value={draftAiConfig.imageSize || "1248x1760"} onChange={(e) => updateAiDraft({ imageSize: e.target.value })}>
                      <option value="1248x1760">1248x1760</option>
                      <option value="1024x1024">1024x1024</option>
                      <option value="1536x1024">1536x1024</option>
                      <option value="1024x1536">1024x1536</option>
                      <option value="2048x2048">2048x2048</option>
                      <option value="2048x1152">2048x1152</option>
                      <option value="3840x2160">3840x2160</option>
                      <option value="2160x3840">2160x3840</option>
                      <option value="2416x3408">2416x3408</option>
                      <option value="auto">auto</option>
                    </select>
                  </Field>
                  <Field label="画质">
                    <select value={draftAiConfig.imageQuality || "low"} onChange={(e) => updateAiDraft({ imageQuality: e.target.value })}>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="auto">auto</option>
                    </select>
                  </Field>
                </div>
                <div className="grid two compact-fields">
                  <Field label="格式">
                    <select value={draftAiConfig.imageFormat || "jpeg"} onChange={(e) => updateAiDraft({ imageFormat: e.target.value })}>
                      <option value="jpeg">jpeg</option>
                      <option value="png">png</option>
                      <option value="webp">webp</option>
                    </select>
                  </Field>
                  <Field label="数量">
                    <input type="number" min="1" max="10" value={draftAiConfig.imageN || 1} onChange={(e) => updateAiDraft({ imageN: Number(e.target.value) })} />
                  </Field>
                </div>
              </div>
              <button className="primary"><Sparkles size={18} />保存 AI 配置</button>
              <div className="inline-fields">
                <button type="button" className="secondary" onClick={() => { syncAiDraft(savedAiConfig); setMessage("AI 配置已恢复为已保存内容"); }}>
                  重载 AI 配置
                </button>
              </div>
            </form>
            <div className="panel" style={{ marginTop: "0.75rem" }}>
              <h3>测试区域</h3>
              <div className="stack compact">
                <Field label="测试孩子">
                  <select value={aiTestChildId} onChange={(event) => setSelectedAiTestChildId(event.target.value)} disabled={!aiTestChildren.length}>
                    {!aiTestChildren.length && <option value="">请先为孩子启用 AI</option>}
                    {aiTestChildren.map((child) => <option key={child.id} value={child.id}>{child.display_name}</option>)}
                  </select>
                </Field>
                <div className="inline-fields">
                  <button type="button" className="secondary" disabled={!aiTestChildId || !!aiPreviewing} onClick={() => void previewAiContent("greeting", "AI 寄语预览", aiTestChildId)}>
                    {aiPreviewing === "greeting" ? "获取中..." : "测试 AI 寄语"}
                  </button>
                  <button type="button" className="secondary" disabled={!aiTestChildId || !!aiPreviewing} onClick={() => void previewAiContent("weeklyReport", "周报评语预览", aiTestChildId)}>
                    {aiPreviewing === "weeklyReport" ? "获取中..." : "测试周报评语"}
                  </button>
                  <button type="button" className="secondary" disabled={!aiTestChildId || !!aiPreviewing} onClick={() => void previewAiContent("monthlyReport", "月报评语预览", aiTestChildId)}>
                    {aiPreviewing === "monthlyReport" ? "获取中..." : "测试月报评语"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
      {ledgerChild && <LedgerModal title={`${ledgerChild.display_name} 的积分清单`} rows={ledger} onClose={() => setLedgerChild(null)} />}
      {refundChild && (
        <RefundRewardDialog
          child={refundChild}
          rows={refundRows}
          onClose={() => { setRefundChild(null); setRefundRows([]); }}
          onRefund={(ids) => void refundSelectedRewards(ids)}
        />
      )}
      {feedbackChild && (
        <FeedbackRecallDialog
          child={feedbackChild}
          rows={feedbackRows}
          onClose={() => { setFeedbackChild(null); setFeedbackRows([]); }}
          onRecall={(ids) => void recallSelectedFeedback(ids)}
        />
      )}
      {reportChild && (
        <ReportDialog
          child={reportChild}
          onClose={() => setReportChild(null)}
          onPrint={exportChildPrint}
          onReport={exportChildReport}
          onCartoonReport={(child, period) => void generateCartoonReport(child, period)}
          onChecklistImage={(child) => void generateChecklistImage(child)}
          onSchedulePrint={exportChildSchedulePrint}
          onScheduleImage={(child) => void generateScheduleImage(child)}
          generating={cartoonReportGenerating}
          checklistGenerating={checklistImageGenerating}
          scheduleGenerating={scheduleImageGenerating}
        />
      )}
      {cartoonReportResult && (
        <CartoonReportDialog
          result={cartoonReportResult}
          onRetry={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child && result.period) void generateCartoonReport(child, result.period, true, result.status === "completed");
          }}
          onRegenerate={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child && result.period) void generateCartoonReport(child, result.period, false, true);
          }}
          onClose={() => {
            cartoonAbortRef.current?.abort();
            setCartoonReportResult(null);
          }}
        />
      )}
      {aiPreviewResult && (
        <AiPreviewDialog
          title={aiPreviewResult.title}
          text={aiPreviewResult.text}
          type={aiPreviewResult.type}
          childId={aiPreviewResult.childId}
          caching={aiPreviewCaching}
          onCache={(type, childId, text) => void cachePreviewResult(type, childId, text)}
          onClose={() => setAiPreviewResult(null)}
        />
      )}
      {checklistImageResult && (
        <CartoonReportDialog
          result={checklistImageResult}
          onRetry={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child) void generateChecklistImage(child, true, result.status === "completed");
          }}
          onRegenerate={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child) void generateChecklistImage(child, false, true);
          }}
          onClose={() => {
            checklistImageAbortRef.current?.abort();
            setChecklistImageResult(null);
          }}
        />
      )}
      {scheduleImageResult && (
        <CartoonReportDialog
          result={scheduleImageResult}
          onRetry={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child) void generateScheduleImage(child, true, result.status === "completed");
          }}
          onRegenerate={(result) => {
            const child = children.find((item) => item.id === result.childId);
            if (child) void generateScheduleImage(child, false, true);
          }}
          onClose={() => {
            scheduleImageAbortRef.current?.abort();
            setScheduleImageResult(null);
          }}
        />
      )}
      {editChild && (
        <EditDialog title="编辑孩子账号" icon={<Users />} onClose={() => setEditChild(null)}>
          <ChildEditForm child={editChild} onCancel={() => setEditChild(null)} onSave={(data) => void saveChild(editChild, data)} />
        </EditDialog>
      )}
    </Shell>
  );
}

export function ReviewPanel({ title, items, empty, approve, reject }: { title: string; items: any[]; empty: string; approve: (id: string, completionLabel?: string) => void; reject: (id: string) => void }) {
  const groups = [...new Map(items.map((item) => [item.child_id, { id: item.child_id, name: item.child_name }])).values()];
  const [activeChildId, setActiveChildId] = useState("");
  const [completionLabels, setCompletionLabels] = useState<Record<string, string>>({});
  const selected = activeChildId && groups.some((child) => child.id === activeChildId) ? activeChildId : groups[0]?.id || "";
  const visible = selected ? items.filter((item) => item.child_id === selected) : items;
  return (
    <section className="panel">
      <div className="panel-title">
        <ClipboardCheck />
        <h2>{title}</h2>
      </div>
      {groups.length > 1 && <Tabs value={selected} onChange={setActiveChildId} options={groups.map((child) => ({ value: child.id, label: child.name }))} />}
      <div className="list scroll-list">
        {visible.length ? (
          visible.map((item: any) => {
            const standards = parseCompletionStandards(item);
            const needsCompletion = item.grading_mode === "completion" && standards.length > 0;
            const completionLabel = completionLabels[item.id] || standards[0]?.label || "";
            return (
              <article className="row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.child_name} · {item.period_key}{item.task_set_title ? ` · 任务集：${item.task_set_title}${item.taskSetProgress ? `（下一轮 ${item.taskSetProgress.approved}/${item.taskSetProgress.total} 已通过）` : ""}` : ""}{needsCompletion ? " · 完成程度给分" : ` · ${item.points || 0}分`}</span>
                  {item.task_set_title && <small>通过本项不会单独加分，凑齐全部子任务后统一结算。</small>}
                  {needsCompletion && (
                    <select value={completionLabel} onChange={(e) => setCompletionLabels({ ...completionLabels, [item.id]: e.target.value })}>
                      {standards.map((standard) => <option key={standard.label} value={standard.label}>{standard.label} · {standard.points}分</option>)}
                    </select>
                  )}
                </div>
                <div className="actions">
                  <button className="icon good" title="通过" onClick={() => approve(item.id, needsCompletion ? completionLabel : undefined)}>
                    <Check size={18} />
                  </button>
                  <button className="icon danger" title="驳回" onClick={() => reject(item.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <Empty text={empty} />
        )}
      </div>
    </section>
  );
}
export function RedemptionPanel({ items, onFinish }: { items: any[]; onFinish: (id: string, action: "redeem" | "cancel") => void }) {
  const groups = [...new Map(items.map((item) => [item.child_id, { id: item.child_id, name: item.child_name }])).values()];
  const [activeChildId, setActiveChildId] = useState("");
  const selected = activeChildId && groups.some((child) => child.id === activeChildId) ? activeChildId : groups[0]?.id || "";
  const visible = selected ? items.filter((item) => item.child_id === selected) : items;
  return (
    <section className="panel">
      <div className="panel-title">
        <Gift />
        <h2>奖励核销</h2>
      </div>
      {groups.length > 1 && <Tabs value={selected} onChange={setActiveChildId} options={groups.map((child) => ({ value: child.id, label: child.name }))} />}
      <div className="list scroll-list">
        {visible.length ? (
          visible.map((item: any) => (
            <article className="row" key={item.id}>
              <div>
                <strong>{rewardDisplayTitle(item)}</strong>
                <span>{item.child_name} · {item.period_key}</span>
              </div>
              <div className="actions">
                <button className="icon good" title="核销" onClick={() => onFinish(item.id, "redeem")}>
                  <BadgeCheck size={18} />
                </button>
                <button className="icon danger" title="取消" onClick={() => onFinish(item.id, "cancel")}>
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))
        ) : (
          <Empty text="没有待核销奖励" />
        )}
      </div>
    </section>
  );
}

export function PraiseCriticismPanel({ children, templates, onSubmit, remedyItems, onRemedy }: { children: Child[]; templates: FeedbackTemplate[]; onSubmit: (data: { childId: string; templateId: string }) => void; remedyItems?: RemedyCriticismItem[]; onRemedy?: (id: string, sourceType?: string) => void }) {
  const [data, setData] = useState({ childId: "", templateId: "" });
  const [kind, setKind] = useState<"praise" | "criticism">("praise");
  const childId = data.childId || children[0]?.id || "";
  const visibleTemplates = templates.filter((item) => item.kind === kind);
  const templateId = visibleTemplates.some((item) => item.id === data.templateId) ? data.templateId : "";
  if (!children.length || !templates.length) {
    return (
      <section className="panel">
        <div className="panel-title"><MessageSquare /><h2>表扬与批评</h2></div>
        <Empty text={!children.length ? "先创建孩子账号后再操作" : "先在设置中创建表扬与批评条款"} />
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-title"><MessageSquare /><h2>表扬与批评</h2></div>
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); if (templateId && visibleTemplates.some((item) => item.id === templateId)) onSubmit({ childId, templateId }); }}>
        <Field label="孩子">
          <select value={childId} onChange={(e) => setData({ ...data, childId: e.target.value })}>
            {children.map((child) => <option key={child.id} value={child.id}>{child.display_name}</option>)}
          </select>
        </Field>
        <div className="field">
          <span>类型</span>
          <Tabs
            value={kind}
            onChange={(value) => {
              const nextKind = value as "praise" | "criticism";
              setKind(nextKind);
              setData({ ...data, templateId: "" });
            }}
            options={[
              { value: "praise", label: "表扬" },
              { value: "criticism", label: "批评" }
            ]}
          />
        </div>
        <Field label="条款">
          <select value={templateId} onChange={(e) => setData({ ...data, templateId: e.target.value })} disabled={!visibleTemplates.length}>
            <option value="">请选择{kind === "praise" ? "表扬" : "批评"}条款</option>
            {visibleTemplates.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.kind === "praise" ? "+" : "-"}{item.points}</option>)}
          </select>
        </Field>
        {!visibleTemplates.length && <Empty text={`暂无可用${kind === "praise" ? "表扬" : "批评"}条款`} />}
        <button className="primary" disabled={!templateId}><Plus size={18} />记录</button>
      </form>
      {remedyItems && remedyItems.length > 0 && onRemedy && (
        <div className="remedy-list">
          <h3><AlertTriangle size={16} />待确认补救</h3>
          {remedyItems.map((item) => (
            <article className="row remedy-item" key={item.id}>
              <div>
                <strong>{item.childName} · {item.sourceType === "task_required_penalty" ? "必做扣分 · " : ""}{item.title}</strong>
                <span>{item.remedyCondition || "请按家长要求完成补救"} · 预扣冻结 {item.frozenAmount} 积分 · 可挽回 {item.remedyPoints} 积分</span>
                <small>截止：{item.localRemedyDeadlineAt}</small>
              </div>
              <button type="button" className="secondary" onClick={() => onRemedy(item.id, item.sourceType)}>
                <Check size={16} />确认补救
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function RequiredPenaltyExemptionPanel({ children, tasks, exemptions = [], onSubmit, onRevoke }: { children: Child[]; tasks: Task[]; exemptions?: { childId: string; taskId: string }[]; onSubmit: (data: { childId: string; taskId: string }) => void; onRevoke: (data: { childId: string; taskId: string }) => void }) {
  const [data, setData] = useState({ childId: "", taskId: "" });
  const childId = data.childId || children[0]?.id || "";
  const requiredTasks = tasks.filter((task) => Number(task.is_required || 0) === 1 && task.is_active !== 0 && (task.assignees || []).includes(childId));
  const taskId = requiredTasks.some((task) => task.id === data.taskId) ? data.taskId : "";
  const exemptedTaskIds = new Set(exemptions.filter((item) => item.childId === childId).map((item) => item.taskId));
  const selectedExempted = taskId ? exemptedTaskIds.has(taskId) : false;
  return (
    <section className="panel">
      <div className="panel-title"><BadgeCheck /><h2>必做扣分豁免</h2></div>
      {!children.length ? <Empty text="先创建孩子账号后再操作" /> : (
        <form className="stack compact" onSubmit={(event) => { event.preventDefault(); if (childId && taskId && !selectedExempted) onSubmit({ childId, taskId }); }}>
          <Field label="孩子">
            <select value={childId} onChange={(e) => setData({ childId: e.target.value, taskId: "" })}>
              {children.map((child) => <option key={child.id} value={child.id}>{child.display_name}</option>)}
            </select>
          </Field>
          <Field label="必做任务">
            <select value={taskId} onChange={(e) => setData({ ...data, taskId: e.target.value })} disabled={!requiredTasks.length}>
              <option value="">请选择本周期豁免任务</option>
              {requiredTasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {formatPeriod(task.period || "daily")}{exemptedTaskIds.has(task.id) ? " · 已豁免" : ""}</option>)}
            </select>
          </Field>
          {!requiredTasks.length && <Empty text="该孩子暂无可豁免的必做任务" />}
          {selectedExempted && <span className="exempted-tag">已豁免</span>}
          {selectedExempted ? <button type="button" className="secondary" disabled={!taskId} onClick={() => onRevoke({ childId, taskId })}><RotateCcw size={18} />撤销豁免</button> : <button className="secondary" disabled={!taskId}><BadgeCheck size={18} />豁免本周期</button>}
        </form>
      )}
    </section>
  );
}

export function SubmissionDeadlineExemptionPanel({ children, tasks, exemptions = [], onSubmit, onRevoke }: { children: Child[]; tasks: Task[]; exemptions?: { childId: string; taskId: string }[]; onSubmit: (data: { childId: string; taskId: string }) => void; onRevoke: (data: { childId: string; taskId: string }) => void }) {
  const [data, setData] = useState({ childId: "", taskId: "" });
  const childId = data.childId || children[0]?.id || "";
  const deadlineTasks = tasks.filter((task) => task.is_active !== 0 && (task.assignees || []).includes(childId) && !!parseSubmissionDeadline(task));
  const taskId = deadlineTasks.some((task) => task.id === data.taskId) ? data.taskId : "";
  const exemptedTaskIds = new Set(exemptions.filter((item) => item.childId === childId).map((item) => item.taskId));
  const selectedExempted = taskId ? exemptedTaskIds.has(taskId) : false;
  return (
    <section className="panel">
      <div className="panel-title"><BadgeCheck /><h2>提交截止解除</h2></div>
      {!children.length ? <Empty text="先创建孩子账号后再操作" /> : (
        <form className="stack compact" onSubmit={(event) => { event.preventDefault(); if (childId && taskId && !selectedExempted) onSubmit({ childId, taskId }); }}>
          <Field label="孩子">
            <select value={childId} onChange={(e) => setData({ childId: e.target.value, taskId: "" })}>
              {children.map((child) => <option key={child.id} value={child.id}>{child.display_name}</option>)}
            </select>
          </Field>
          <Field label="有截止时间的任务">
            <select value={taskId} onChange={(e) => setData({ ...data, taskId: e.target.value })} disabled={!deadlineTasks.length}>
              <option value="">请选择本周期解除任务</option>
              {deadlineTasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {submissionDeadlineText(task.period || "daily", parseSubmissionDeadline(task))}{exemptedTaskIds.has(task.id) ? " · 已解除" : ""}</option>)}
            </select>
          </Field>
          {!deadlineTasks.length && <Empty text="该孩子暂无设置提交截止时间的任务" />}
          {selectedExempted && <span className="exempted-tag">截止已解除</span>}
          {selectedExempted ? <button type="button" className="secondary" disabled={!taskId} onClick={() => onRevoke({ childId, taskId })}><RotateCcw size={18} />撤销解除</button> : <button className="secondary" disabled={!taskId}><BadgeCheck size={18} />解除本周期截止</button>}
        </form>
      )}
    </section>
  );
}
export function RefundRewardDialog({ child, rows, onRefund, onClose }: { child: Child; rows: WarehouseItem[]; onRefund: (ids: string[]) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const total = rows.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + Number(item.cost_points || 0), 0);
  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal scrolling-list-modal">
        <div className="panel-title compact-title">
          <RotateCcw />
          <h2>退还奖励</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <p className="muted-text">{child.display_name} 已核销的奖励可在这里退还积分。待核销奖励请在奖励核销区域使用取消按钮。</p>
        <div className="list scroll-list refund-list">
          {rows.length ? rows.map((item) => (
            <label className="row selectable-row" key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
              <div>
                <strong>{rewardDisplayTitle(item)}</strong>
                <span>{item.redeemed_at ? `${formatTime(item.redeemed_at)} 已核销` : "已核销"} · {item.cost_points}积分</span>
              </div>
            </label>
          )) : <Empty text="该孩子没有已核销且可退还的奖励" />}
        </div>
        <div className="actions">
          <button className="primary" disabled={!selected.length} onClick={() => onRefund(selected)}>
            <RotateCcw size={18} />退还{selected.length ? ` ${selected.length} 项 · ${total} 积分` : ""}
          </button>
          <button type="button" className="secondary" onClick={onClose}>取消</button>
        </div>
      </section>
    </div>
  );
}

export function FeedbackRecallDialog({ child, rows, onRecall, onClose }: { child: Child; rows: FeedbackEvent[]; onRecall: (ids: string[]) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const total = rows.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0);
  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal scrolling-list-modal">
        <div className="panel-title compact-title">
          <RotateCcw />
          <h2>撤回反馈</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <p className="muted-text">{child.display_name} 近 7 天的表扬与批评可在这里撤回。撤回后积分会自动冲正，记录保留 7 天。</p>
        <div className="list scroll-list refund-list">
          {rows.length ? rows.map((item) => (
            <label className="row selectable-row" key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
              <div>
                <strong>{item.sourceLabel || ((item.source_type === "praise" ? "表扬" : "批评") + " · " + (item.template_title || item.note || "反馈"))}</strong>
                <span>{item.localCreatedAt || formatTime(item.created_at)} · {item.freeze_status === "frozen" ? `预扣冻结${item.frozen_amount || 0}` : `${item.amount >= 0 ? "+" : ""}${item.amount}`} 积分{item.remedy_condition ? ` · 补救：${item.remedy_condition}` : ""}</span>
              </div>
            </label>
          )) : <Empty text="近 7 天没有可撤回的表扬或批评" />}
        </div>
        <div className="actions">
          <button className="primary" disabled={!selected.length} onClick={() => onRecall(selected)}>
            <RotateCcw size={18} />撤回{selected.length ? " " + selected.length + " 项 · " + total + " 积分" : ""}
          </button>
          <button type="button" className="secondary" onClick={onClose}>取消</button>
        </div>
      </section>
    </div>
  );
}

export function ReportDialog({ child, onPrint, onReport, onCartoonReport, onChecklistImage, onSchedulePrint, onScheduleImage, generating, checklistGenerating, scheduleGenerating, onClose }: { child: Child; onPrint: (child: Child) => void; onReport: (child: Child, period: "weekly" | "monthly") => void; onCartoonReport: (child: Child, period: "weekly" | "monthly") => void; onChecklistImage: (child: Child) => void; onSchedulePrint: (child: Child) => void; onScheduleImage: (child: Child) => void; generating: "" | "weekly" | "monthly"; checklistGenerating: boolean; scheduleGenerating: boolean; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal">
        <div className="panel-title compact-title">
          <Printer />
          <h2>报表</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <p className="muted-text">{child.display_name} 的打印清单、周报和月报都从这里进入。</p>
        <div className="report-actions">
          <button className="primary" onClick={() => { onPrint(child); onClose(); }}>
            <Printer size={18} />打印清单
          </button>
          <button className="secondary" disabled={checklistGenerating} onClick={() => onChecklistImage(child)}>
            <Sparkles size={18} />{checklistGenerating ? "绘制中..." : "绘制打印清单"}
          </button>
          <div className="report-action-row">
            <button className="secondary" onClick={() => { onReport(child, "weekly"); onClose(); }}>
              <Printer size={18} />上周周报
            </button>
            <button className="secondary" disabled={!!generating} onClick={() => onCartoonReport(child, "weekly")}>
              <Sparkles size={18} />{generating === "weekly" ? "绘制中..." : "绘制卡通周报"}
            </button>
          </div>
          <div className="report-action-row">
            <button className="secondary" onClick={() => { onReport(child, "monthly"); onClose(); }}>
              <Printer size={18} />上月月报
            </button>
            <button className="secondary" disabled={!!generating} onClick={() => onCartoonReport(child, "monthly")}>
              <Sparkles size={18} />{generating === "monthly" ? "绘制中..." : "绘制卡通月报"}
            </button>
          </div>
          <hr className="report-divider" />
          <div className="report-action-row">
            <button className="secondary" onClick={() => { onSchedulePrint(child); onClose(); }}>
              <Printer size={18} />打印日程表
            </button>
            <button className="secondary" disabled={scheduleGenerating} onClick={() => onScheduleImage(child)}>
              <Sparkles size={18} />{scheduleGenerating ? "绘制中..." : "绘制日程表"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CartoonReportDialog({ result, onRetry, onRegenerate, onClose }: { result: CartoonReportResponse & { title: string }; onRetry: (result: CartoonReportResponse & { title: string }) => void; onRegenerate: (result: CartoonReportResponse & { title: string }) => void; onClose: () => void }) {
  const working = result.status === "pending" || result.status === "processing" || (!result.status && !result.imageUrl);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal cartoon-report-modal">
        <div className="panel-title compact-title">
          <Sparkles />
          <h2>{result.title}</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        {working && <div className="info">卡通报告正在生成，完成后会自动显示。</div>}
        {result.status === "failed" && <div className="error">{result.lastError || "卡通报告生成失败，请稍后重试"}</div>}
        {result.imageUrl && <img className="cartoon-report-image" src={result.imageUrl} alt={result.title} />}
        <div className="actions">
          {result.imageUrl && (
            <a className="primary download-link" href={result.imageUrl} download={result.filename}>
              <Download size={18} />下载图片
            </a>
          )}
          {result.status === "failed" && <button type="button" className="primary" onClick={() => onRetry(result)}><Sparkles size={18} />重试生成</button>}
          {result.status === "completed" && <button type="button" className="primary" onClick={() => onRegenerate(result)}><Sparkles size={18} />重新生成</button>}
          <button type="button" className="secondary" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  );
}

export function AiPreviewDialog({ title, text, type, childId, caching, onCache, onClose }: { title: string; text: string; type: string; childId: string; caching: boolean; onCache: (type: string, childId: string, text: string) => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal">
        <div className="panel-title compact-title">
          <Sparkles />
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <p className="ai-preview-text">{text}</p>
        <div className="inline-fields" style={{ marginTop: "1rem" }}>
          <button type="button" className="primary" disabled={caching} onClick={() => onCache(type, childId, text)}>
            {caching ? "写入中..." : "替换当前缓存"}
          </button>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
      </section>
    </div>
  );
}

export function CreateChild({ onCreate }: { onCreate: (data: any) => void }) {
  const [data, setData] = useState({ username: "", displayName: "", password: "" });
  return (
    <FormPanel title="孩子账号" icon={<Users />} onSubmit={() => onCreate(data)}>
      <Field label="账号"><input required value={data.username} onChange={(e) => setData({ ...data, username: e.target.value })} /></Field>
      <Field label="姓名"><input required value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} /></Field>
      <Field label="密码"><input type="password" autoComplete="new-password" required value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} /></Field>
    </FormPanel>
  );
}

export function ChildManager({ children, onEdit, onToggle, onDelete, onReport, onRefund, onFeedbackRecall }: { children: Child[]; onEdit: (child: Child) => void; onToggle: (child: Child) => void; onDelete: (child: Child) => void; onReport: (child: Child) => void; onRefund: (child: Child) => void; onFeedbackRecall: (child: Child) => void }) {
  return (
    <section className="panel">
      <div className="panel-title"><Users /><h2>孩子账号管理</h2></div>
      <div className="list">
        {children.length ? children.map((child) => (
          <article className="row" key={child.id}>
            <div>
              <strong>{child.display_name}</strong>
              <span>{child.username} · {child.status === "active" ? "启用" : "停用"} · 昨日回顾：{child.daily_review_enabled === 0 ? "关闭" : `${child.daily_review_seconds ?? 30}秒`}</span>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => onEdit(child)}>修改</button>
              <button className="secondary" onClick={() => onReport(child)}><Printer size={16} />报表</button>
              <button className="secondary" onClick={() => onFeedbackRecall(child)}><RotateCcw size={16} />撤回反馈</button>
              <button className="secondary" onClick={() => onRefund(child)}><RotateCcw size={16} />退还奖励</button>
              <button className="secondary" onClick={() => onToggle(child)}>{child.status === "active" ? "停用" : "启用"}</button>
              <button className="icon danger" title="归档" onClick={() => onDelete(child)}><Trash2 size={18} /></button>
            </div>
          </article>
        )) : <Empty text="暂无孩子账号" />}
      </div>
    </section>
  );
}

export function AchievementRuleFields({ data, setData, tasks, categories }: { data: any; setData: (data: any) => void; tasks: Task[]; categories: Category[] }) {
  const needsCustomWindow = ["tasks_custom", "category_tasks_custom", "praise_custom", "no_criticism_custom"].includes(data.condition);
  const needsTask = data.condition === "same_task_streak" || data.condition === "specific_task_completed";
  const needsCategory = data.condition.startsWith("category_");
  const needsThreshold = !["no_criticism_week", "no_criticism_month", "no_criticism_custom"].includes(data.condition);
  const targetTaskId = data.targetTaskId || tasks[0]?.id || "";
  const targetCategoryId = data.targetCategoryId || categories[0]?.id || "";
  return (
    <>
      <Field label="条件">
        <select value={data.condition} onChange={(e) => setData({ ...data, condition: e.target.value })}>
          {ACHIEVEMENT_CONDITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </Field>
      {needsCustomWindow && (
        <div className="grid two compact-fields">
          <Field label="开始日期"><input type="date" required value={data.windowStart} onChange={(e) => setData({ ...data, windowStart: e.target.value })} /></Field>
          <Field label="结束日期"><input type="date" required value={data.windowEnd} onChange={(e) => setData({ ...data, windowEnd: e.target.value })} /></Field>
        </div>
      )}
      {needsTask && (
        <Field label="指定任务">
          <select required value={targetTaskId} onChange={(e) => setData({ ...data, targetTaskId: e.target.value })}>
            {!tasks.length && <option value="">暂无任务</option>}
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </Field>
      )}
      {needsCategory && (
        <Field label="任务分类">
          <select required value={targetCategoryId} onChange={(e) => setData({ ...data, targetCategoryId: e.target.value })}>
            {!categories.length && <option value="">暂无分类</option>}
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
      )}
      {needsThreshold && <Field label="阈值"><input type="number" min="0" value={data.threshold} onChange={(e) => setData({ ...data, threshold: Number(e.target.value) })} /></Field>}
    </>
  );
}

export function CreateAchievement({ tasks, categories, onCreate }: { tasks: Task[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", condition: "tasks_total", threshold: 5, windowStart: "", windowEnd: "", targetTaskId: "", targetCategoryId: "", iconValue: "🏅" });
  return (
    <FormPanel title="成就称号" icon={<Award />} onSubmit={() => onCreate(achievementPayload({ ...data, targetTaskId: data.targetTaskId || tasks[0]?.id || "", targetCategoryId: data.targetCategoryId || categories[0]?.id || "" }))}>
      <Field label="称号"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <AchievementRuleFields data={data} setData={setData} tasks={tasks} categories={categories} />
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
    </FormPanel>
  );
}

function CompletionStandardsEditor({ value, onChange }: { value: CompletionStandard[]; onChange: (value: CompletionStandard[]) => void }) {
  const rows = value.length ? value : [{ label: "完成", points: 0 }];
  function updateRow(index: number, patch: Partial<CompletionStandard>) {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  return (
    <div className="stack">
      {rows.map((row, index) => (
        <div className="grid two compact-fields" key={index}>
          <Field label="标准"><input required value={row.label} onChange={(e) => updateRow(index, { label: e.target.value })} /></Field>
          <Field label="分值"><input type="number" min="0" value={row.points} onChange={(e) => updateRow(index, { points: Number(e.target.value) })} /></Field>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => onChange([...rows, { label: "", points: 0 }])}><Plus size={16} />添加标准</button>
        {rows.length > 1 && <button type="button" className="secondary" onClick={() => onChange(rows.slice(0, -1))}>删除最后一项</button>}
      </div>
    </div>
  );
}
export function CreateTask({ children, categories, onCreate }: { children: Child[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", categoryId: "", period: "daily", limitCount: 1, points: 5, enabledWeekdays: [...DEFAULT_WEEKDAYS], iconValue: "✅", isActive: true, childIds: [] as string[], isRequired: false, requiredCount: 1, requiredPenaltyPoints: 0, requiredRemedyEnabled: false, requiredRemedyCondition: "", requiredRemedyPoints: 0, requiredRemedyDeadlineHours: 24, gradingMode: "fixed", completionStandards: [{ label: "完成", points: 5 }], submissionDeadlineEnabled: false, submissionDeadline: null as SubmissionDeadline | null });
  const categoryId = data.categoryId || categories[0]?.id || "";
  const showRequired = data.period !== "once";
  return (
    <FormPanel title="新任务" icon={<ClipboardCheck />} onSubmit={() => onCreate({ ...data, categoryId, iconType: "emoji", completionStandards: cleanCompletionStandards(data.completionStandards), submissionDeadline: data.submissionDeadlineEnabled ? data.submissionDeadline : null })}>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <Field label="分类">
        <select value={categoryId} onChange={(e) => setData({ ...data, categoryId: e.target.value })}>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="周期">
        <select value={data.period} onChange={(e) => setData({ ...data, period: e.target.value, isRequired: e.target.value === "once" ? false : data.isRequired, submissionDeadlineEnabled: false, submissionDeadline: null })}>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="once">一次性</option>
        </select>
      </Field>
      <>
        <Toggle label="设置提交截止时间" checked={data.submissionDeadlineEnabled} onChange={(submissionDeadlineEnabled) => setData({ ...data, submissionDeadlineEnabled, submissionDeadline: submissionDeadlineEnabled ? defaultSubmissionDeadline(data.period) : null })} />
        {data.submissionDeadlineEnabled && <SubmissionDeadlineFields period={data.period} value={data.submissionDeadline || defaultSubmissionDeadline(data.period)} onChange={(submissionDeadline) => setData({ ...data, submissionDeadline })} />}
      </>
      <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>
      <Field label="启用周几"><WeekdayPicker value={data.enabledWeekdays} onChange={(enabledWeekdays) => setData({ ...data, enabledWeekdays })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Toggle label="按完成程度给分" checked={data.gradingMode === "completion"} onChange={(checked) => setData({ ...data, gradingMode: checked ? "completion" : "fixed" })} />
      {data.gradingMode === "completion" && <CompletionStandardsEditor value={data.completionStandards} onChange={(completionStandards) => setData({ ...data, completionStandards })} />}
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      {showRequired && (
        <>
          <Toggle label="必做任务" checked={data.isRequired} onChange={(isRequired) => setData({ ...data, isRequired })} />
          {data.isRequired && (
            <>
              <div className="grid two compact-fields">
                <Field label="必做次数"><input type="number" min="1" value={data.requiredCount} onChange={(e) => setData({ ...data, requiredCount: Number(e.target.value) })} /></Field>
                <Field label="未达标扣分"><input type="number" min="0" value={data.requiredPenaltyPoints} onChange={(e) => setData({ ...data, requiredPenaltyPoints: Number(e.target.value) })} /></Field>
              </div>
              <Toggle label="扣分后可补救" checked={data.requiredRemedyEnabled} onChange={(requiredRemedyEnabled) => setData({ ...data, requiredRemedyEnabled })} />
              {data.requiredRemedyEnabled && <>
                <Field label="补救条件"><textarea value={data.requiredRemedyCondition} onChange={(e) => setData({ ...data, requiredRemedyCondition: e.target.value })} /></Field>
                <div className="grid two compact-fields">
                  <Field label="挽回积分"><input type="number" min="1" max={data.requiredPenaltyPoints} value={data.requiredRemedyPoints} onChange={(e) => setData({ ...data, requiredRemedyPoints: Number(e.target.value) })} /></Field>
                  <Field label="补救时限（小时）"><input type="number" min="1" value={data.requiredRemedyDeadlineHours} onChange={(e) => setData({ ...data, requiredRemedyDeadlineHours: Number(e.target.value) })} /></Field>
                </div>
              </>}
            </>
          )}
        </>
      )}
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
  );
}

function TaskSetForm({ item, tasks, children, onSave, onCancel }: { item?: TaskSet; tasks: Task[]; children: Child[]; onSave: (data: any) => void; onCancel?: () => void }) {
  const [data, setData] = useState(() => ({ title: item?.title || "", description: item?.description || "", iconValue: item?.icon_value || "🧩", isActive: item?.is_active !== 0, taskIds: item?.taskIds || [] as string[] }));
  const selectable = tasks.filter((task) => task.is_active !== 0 && (!task.taskSetId || task.taskSetId === item?.id));
  const selectedTasks = selectable.filter((task) => data.taskIds.includes(task.id));
  const eligible = children.filter((child) => selectedTasks.length && selectedTasks.every((task) => (task.assignees || []).includes(child.id)));
  const totals = selectedTasks.reduce((sum, task) => {
    const standards = parseCompletionStandards(task);
    const values = task.grading_mode === "completion" && standards.length ? standards.map((row) => Number(row.points || 0)) : [Number(task.points || 0)];
    return { min: sum.min + Math.min(...values), max: sum.max + Math.max(...values) };
  }, { min: 0, max: 0 });
  function toggleTask(taskId: string) { setData((current) => ({ ...current, taskIds: current.taskIds.includes(taskId) ? current.taskIds.filter((id) => id !== taskId) : [...current.taskIds, taskId] })); }
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="任务集标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <Field label="子任务（至少两项，顺序即结算明细顺序)"><div className="stack compact task-set-member-list">{selectable.map((task) => <label className="toggle" key={task.id}><input type="checkbox" checked={data.taskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span>{task.title} · {formatPeriod(task.period)}</span></label>)}</div></Field>
      <small>共同适用：{eligible.length ? eligible.map((child) => child.display_name).join("、") : "暂无"} · 每轮 {totals.min}{totals.max !== totals.min ? `-${totals.max}` : ""} 积分</small>
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用任务集" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <div className="actions"><button className="primary">保存任务集</button>{onCancel && <button type="button" className="secondary" onClick={onCancel}>取消</button>}</div>
    </form>
  );
}

function TaskSetsPanel({ taskSets, tasks, children, onCreate, onUpdate, onDelete }: { taskSets: TaskSet[]; tasks: Task[]; children: Child[]; onCreate: (data: any) => void; onUpdate: (item: TaskSet, data: any) => void; onDelete: (item: TaskSet) => void }) {
  const [editing, setEditing] = useState<TaskSet | null>(null);
  return (
    <section className="panel">
      <div className="panel-title"><Users /><h2>任务集</h2></div>
      <TaskSetForm tasks={tasks} children={children} onSave={onCreate} />
      <div className="list config-list scroll-list">
        {taskSets.length ? taskSets.map((set) => <article className="row config-row" key={set.id}>
          <div className="config-main">{icon(set.icon_type, set.icon_value, set.title)}<div><strong>{set.title}</strong>{set.description && <span>{set.description}</span>}<small>{set.members.map((member: any) => member.title).join(" + ")} · {set.minPoints}{set.maxPoints !== set.minPoints ? `-${set.maxPoints}` : ""}分 · {set.eligibleChildIds.length}名儿童{set.is_active === 0 ? " · 已停用" : ""}</small></div></div>
          <div className="actions"><button className="secondary" onClick={() => setEditing(set)}><Edit3 size={16} />编辑</button><button className="icon danger" title="解散" onClick={() => onDelete(set)}><Trash2 size={18} /></button></div>
        </article>) : <Empty text="可把两个或更多任务组合为一次性结算的任务集" />}
      </div>
      {editing && <EditDialog title="编辑任务集" icon={<Users />} onClose={() => setEditing(null)}><TaskSetForm item={editing} tasks={tasks} children={children} onSave={(data) => { onUpdate(editing, data); setEditing(null); }} onCancel={() => setEditing(null)} /></EditDialog>}
    </section>
  );
}

export function CreateReward({ children, tasks, achievements, onCreate }: { children: Child[]; tasks: Task[]; achievements: any[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", costPoints: 10, limitPeriod: "daily", limitCount: 1, redeemWeekdays: [...DEFAULT_WEEKDAYS], prerequisites: [] as any[], requiredAchievementId: "", iconValue: "🎁", isActive: true, childIds: [] as string[] });
  return (
    <FormPanel title="新奖励" icon={<Gift />} onSubmit={() => onCreate({ ...data, limitCount: data.limitPeriod === "once" ? 1 : data.limitCount, iconType: "emoji" })}>
      <Field label="名称"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <Field label="所需积分"><input type="number" min="0" value={data.costPoints} onChange={(e) => setData({ ...data, costPoints: Number(e.target.value) })} /></Field>
      <Field label="限制周期">
        <select value={data.limitPeriod} onChange={(e) => setData({ ...data, limitPeriod: e.target.value })}>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="once">一次性</option>
        </select>
      </Field>
      {data.limitPeriod !== "once" && <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>}
      <Field label="核销周几"><WeekdayPicker value={data.redeemWeekdays} onChange={(redeemWeekdays) => setData({ ...data, redeemWeekdays })} /></Field>
      <PrerequisiteEditor tasks={tasks} value={data.prerequisites} onChange={(prerequisites) => setData({ ...data, prerequisites })} />
      <Field label="解锁成就称号">
        <select value={data.requiredAchievementId} onChange={(e) => setData({ ...data, requiredAchievementId: e.target.value })}>
          <option value="">无条件</option>
          {achievements.map((achievement) => <option key={achievement.id} value={achievement.id}>{achievement.title}</option>)}
        </select>
      </Field>
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
  );
}

export function CreateFeedbackTemplate({ onCreate }: { onCreate: (data: any) => void }) {
  const [data, setData] = useState({ kind: "praise", title: "", points: 5, iconValue: "✨", isActive: true, isRemediable: false, remedyCondition: "", remedyPoints: 0, remedyDeadlineHours: 24 });
  return (
    <FormPanel title="新条款" icon={<MessageSquare />} onSubmit={() => onCreate({ ...data, iconType: "emoji" })}>
      <Field label="类型">
        <select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value, iconValue: e.target.value === "praise" ? "✨" : "⚠️", isRemediable: e.target.value === "criticism" ? data.isRemediable : false })}>
          <option value="praise">表扬</option>
          <option value="criticism">批评</option>
        </select>
      </Field>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>

      {data.kind === "criticism" && (
        <>
          <Toggle label="可补救" checked={data.isRemediable} onChange={(isRemediable) => setData({ ...data, isRemediable })} />
          {data.isRemediable && (
            <>
              <Field label="补救条件"><textarea value={data.remedyCondition} onChange={(e) => setData({ ...data, remedyCondition: e.target.value })} /></Field>
              <div className="grid two compact-fields">
                <Field label="挽回积分"><input type="number" min="0" max={data.points} value={data.remedyPoints} onChange={(e) => setData({ ...data, remedyPoints: Number(e.target.value) })} /></Field>
                <Field label="补救时限（小时）"><input type="number" min="1" value={data.remedyDeadlineHours} onChange={(e) => setData({ ...data, remedyDeadlineHours: Number(e.target.value) })} /></Field>
              </div>
            </>
          )}
        </>
      )}
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
    </FormPanel>
  );
}

export function FeedbackOverview({ items, onUpdate, onDelete }: { items: FeedbackTemplate[]; onUpdate: (item: FeedbackTemplate, data: any) => any; onDelete: (item: FeedbackTemplate) => void }) {
  const [editing, setEditing] = useState<FeedbackTemplate | null>(null);
  return (
    <section className="panel">
      <div className="panel-title"><MessageSquare /><h2>现有条款</h2></div>
      <div className="list config-list scroll-list">
        {items.length ? items.map((item) => (
          <article className={`row config-row ${item.kind}`} key={item.id}>
            <div className="config-main">
              {icon(item.icon_type, item.icon_value, item.title)}
              <div>
                <strong>{item.title}</strong>
                {item.description && <span>{item.description}</span>}
                <small>{item.kind === "praise" ? "表扬" : "批评"} · {item.is_active ? "启用" : "停用"} · <span className={item.kind === "praise" ? "positive" : "negative"}>{item.kind === "praise" ? "+" : "-"}{item.points} 积分</span>{item.is_remediable ? ` · 可补救：${item.remedy_points || 0} 分 / ${item.remedy_deadline_hours || 24} 小时` : ""}</small>
              </div>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setEditing(item)}><Edit3 size={16} />编辑</button>
              <button className="icon danger" title="删除" onClick={() => onDelete(item)}><Trash2 size={18} /></button>
            </div>
          </article>
        )) : <Empty text="暂无表扬与批评条款" />}
      </div>
      {editing && (
        <EditDialog title="编辑条款" icon={<MessageSquare />} onClose={() => setEditing(null)}>
          <EditFeedbackForm item={editing} onCancel={() => setEditing(null)} onSave={async (data) => { if (await onUpdate(editing, data)) setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

export function EditFeedbackForm({ item, onSave, onCancel }: { item: FeedbackTemplate; onSave: (data: any) => any; onCancel: () => void }) {
  const [data, setData] = useState({ kind: item.kind, title: item.title, points: item.points || 0, iconValue: item.icon_value || "✨", isActive: item.is_active !== 0, isRemediable: item.is_remediable === 1, remedyCondition: item.remedy_condition || "", remedyPoints: item.remedy_points || 0, remedyDeadlineHours: item.remedy_deadline_hours || 24 });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="类型"><select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value as "praise" | "criticism", isRemediable: e.target.value === "criticism" ? data.isRemediable : false })}><option value="praise">表扬</option><option value="criticism">批评</option></select></Field>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>

      {data.kind === "criticism" && (
        <>
          <Toggle label="可补救" checked={data.isRemediable} onChange={(isRemediable) => setData({ ...data, isRemediable })} />
          {data.isRemediable && (
            <>
              <Field label="补救条件"><textarea value={data.remedyCondition} onChange={(e) => setData({ ...data, remedyCondition: e.target.value })} /></Field>
              <div className="grid two compact-fields">
                <Field label="挽回积分"><input type="number" min="0" max={data.points} value={data.remedyPoints} onChange={(e) => setData({ ...data, remedyPoints: Number(e.target.value) })} /></Field>
                <Field label="补救时限（小时）"><input type="number" min="1" value={data.remedyDeadlineHours} onChange={(e) => setData({ ...data, remedyDeadlineHours: Number(e.target.value) })} /></Field>
              </div>
            </>
          )}
        </>
      )}
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

export function DelegateManager({ delegates, onCreate, onUpdate, onDelete }: { delegates: ParentDelegate[]; onCreate: (data: Record<string, unknown>) => void; onUpdate: (delegate: ParentDelegate, data: Record<string, unknown>) => void; onDelete: (delegate: ParentDelegate) => void }) {
  const [form, setForm] = useState({ username: "", displayName: "", operatorLabel: "", password: "" });
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState({ displayName: "", operatorLabel: "", password: "", status: "active" });
  function resetForm() {
    setForm({ username: "", displayName: "", operatorLabel: "", password: "" });
  }
  return (
    <section className="panel setting-group">
      <div className="panel-title"><Users /><h2>协同管理账号</h2></div>
      <form className="stack compact" onSubmit={(event) => {
        event.preventDefault();
        onCreate({
          username: form.username,
          displayName: form.displayName || form.username,
          operatorLabel: form.operatorLabel || form.displayName || form.username,
          password: form.password || "123456"
        });
        resetForm();
      }}>
        <div className="grid two compact-fields">
          <Field label="账号">
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </Field>
          <Field label="显示名">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="例如：爸爸" />
          </Field>
        </div>
        <div className="grid two compact-fields">
          <Field label="操作者称谓">
            <input value={form.operatorLabel} onChange={(e) => setForm({ ...form, operatorLabel: e.target.value })} placeholder="例如：妈妈" />
          </Field>
          <Field label="初始密码">
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" placeholder="默认 123456" autoComplete="new-password" />
          </Field>
        </div>
        <button className="primary"><Plus size={18} />新增协同账号</button>
      </form>
      <div className="list">
        {delegates.length ? delegates.map((delegate) => {
          const editing = editId === delegate.id;
          return (
            <article className="row delegate-row" key={delegate.id}>
              {editing ? (
                <form className="stack compact delegate-edit" onSubmit={(event) => {
                  event.preventDefault();
                  onUpdate(delegate, {
                    displayName: edit.displayName,
                    operatorLabel: edit.operatorLabel,
                    password: edit.password || undefined,
                    status: edit.status
                  });
                  setEditId("");
                }}>
                  <div className="grid two compact-fields">
                    <Field label="显示名">
                      <input value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />
                    </Field>
                    <Field label="称谓">
                      <input value={edit.operatorLabel} onChange={(e) => setEdit({ ...edit, operatorLabel: e.target.value })} />
                    </Field>
                  </div>
                  <div className="grid two compact-fields">
                    <Field label="状态">
                      <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </Field>
                    <Field label="重置密码">
                      <input value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} type="password" placeholder="留空不修改" autoComplete="new-password" />
                    </Field>
                  </div>
                  <div className="actions">
                    <button className="primary"><Check size={18} />保存</button>
                    <button type="button" className="secondary" onClick={() => setEditId("")}>取消</button>
                  </div>
                </form>
              ) : (
                <>
                  <div>
                    <strong>{delegate.display_name}</strong>
                    <span>{delegate.username} · {delegate.operator_label || delegate.display_name} · {delegate.status === "active" ? "启用" : "停用"}</span>
                  </div>
                  <div className="actions">
                    <button type="button" className="secondary" onClick={() => {
                      setEditId(delegate.id);
                      setEdit({ displayName: delegate.display_name, operatorLabel: delegate.operator_label || delegate.display_name, password: "", status: delegate.status });
                    }}><Edit3 size={16} />编辑</button>
                    <button type="button" className="danger" onClick={() => onDelete(delegate)}><Trash2 size={16} />停用</button>
                  </div>
                </>
              )}
            </article>
          );
        }) : <Empty text="暂无协同管理账号" />}
      </div>
    </section>
  );
}

function configGroupSummaryText(group: ConfigGroupSummary) {
  const s = group.summary;
  return `分类 ${s.categories} / 任务 ${s.tasks} / 奖励 ${s.rewards} / 成就 ${s.achievements} / 条款 ${s.feedbackTemplates}`;
}

function configGroupTime(value?: string | null) {
  if (!value) return "尚未激活";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleString();
}

export function ConfigGroupsPanel({ groups, onCreate, onRename, onRefresh, onActivate, onDelete, onClearCurrent }: { groups: ConfigGroupSummary[]; onCreate: (name: string) => void; onRename: (group: ConfigGroupSummary, name: string) => void; onRefresh: (group: ConfigGroupSummary) => void; onActivate: (group: ConfigGroupSummary) => void; onDelete: (group: ConfigGroupSummary) => void; onClearCurrent: () => void }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onCreate(nextName);
    setName("");
  }
  function startRename(group: ConfigGroupSummary) {
    setEditingId(group.id);
    setEditingName(group.name);
  }
  function submitRename(group: ConfigGroupSummary) {
    const nextName = editingName.trim();
    if (!nextName) return;
    onRename(group, nextName);
    setEditingId("");
    setEditingName("");
  }
  const full = groups.length >= 5;
  return (
    <section className="panel setting-group config-groups-panel is-open">
      <div className="panel-title"><BadgeCheck /><h2>配置组</h2><span className="pill">{groups.length}/5</span></div>
      <form className="config-group-create" onSubmit={submitCreate}>
        <Field label="配置组名称">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="例如：上学日配置" disabled={full} />
        </Field>
        <button type="submit" disabled={full || !name.trim()}><Plus size={18} />保存当前设置</button>
      </form>
      <div className="config-group-danger-row">
        <button className="secondary danger" type="button" onClick={onClearCurrent}><Trash2 size={18} />清空当前配置</button>
      </div>
      {full && <div className="info">最多保存 5 个配置组。删除不需要的配置组后可以继续保存。</div>}
      <div className="config-group-list">
        {groups.length ? groups.map((group) => (
          <article className={`config-group-card ${group.is_active ? "active" : ""}`} key={group.id}>
            <div className="config-group-main">
              {editingId === group.id ? (
                <div className="config-group-edit">
                  <input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={40} autoFocus />
                  <button className="icon" type="button" title="保存名称" aria-label="保存名称" onClick={() => submitRename(group)}><Check size={18} /></button>
                </div>
              ) : (
                <h3>{group.name}</h3>
              )}
              <small>{configGroupSummaryText(group)}</small>
              <small>{group.is_active ? `已激活：${configGroupTime(group.activated_at)}` : `更新：${configGroupTime(group.updated_at)}`}</small>
            </div>
            <div className="config-group-actions">
              {group.is_active ? <span className="status-badge">当前</span> : <button className="secondary" type="button" onClick={() => onActivate(group)}><BadgeCheck size={16} />激活</button>}
              <button className="icon" type="button" title="重命名" aria-label="重命名" onClick={() => startRename(group)}><Edit3 size={18} /></button>
              <button className="icon" type="button" title="用当前设置更新" aria-label="用当前设置更新" onClick={() => onRefresh(group)}><RotateCcw size={18} /></button>
              <button className="icon danger" type="button" title="删除" aria-label="删除" onClick={() => onDelete(group)}><Trash2 size={18} /></button>
            </div>
          </article>
        )) : <Empty text="暂无配置组" />}
      </div>
    </section>
  );
}

export function ConfigPortPanel({ onImported }: { onImported: () => Promise<void> }) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  async function exportConfig() {
    const data = await api<any>("/config/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `任务打卡配置-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importConfig(file?: File) {
    if (!file) return;
    setLoading(true);
    setError("");
    setSummary("");
    try {
      const raw = await file.text();
      const data = JSON.parse(raw);
      const stats = await api<Record<string, { created: number; skipped: number } | number>>("/config/import", { method: "POST", body: JSON.stringify(data) });
      const lines = Object.entries(stats)
        .filter(([, value]) => typeof value === "object")
        .map(([key, value]) => `${key}: 新增 ${(value as any).created}，跳过 ${(value as any).skipped}`);
      if (Number((stats as any).ignoredAssignments || 0) > 0) lines.push(`忽略不存在孩子指派 ${(stats as any).ignoredAssignments} 个`);
      setSummary(lines.join("；"));
      await onImported();
    } catch (err) {
      setError(err instanceof SyntaxError ? "配置文件格式不正确，请检查 JSON 格式" : err instanceof Error ? err.message : "导入失败");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <section className="panel setting-group">
      <div className="panel-title"><Upload /><h2>配置导入导出</h2></div>
      <div className="actions wrap">
        <button className="secondary" type="button" onClick={() => void exportConfig()}><Download size={18} />导出配置</button>
        <label className="secondary file-action">
          <Upload size={18} />
          导入配置
          <input ref={fileRef} type="file" accept="application/json,.json" disabled={loading} onChange={(event) => void importConfig(event.target.files?.[0])} />
        </label>
      </div>
      {loading && <div className="info">导入中...</div>}
      {summary && <div className="success">{summary}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

export function ChildPicker({ children, value, onChange }: { children: Child[]; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <fieldset className="picker">
      <legend>适用孩子</legend>
      {children.map((child) => (
        <label key={child.id}>
          <input
            type="checkbox"
            checked={value.includes(child.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, child.id] : value.filter((id) => id !== child.id))}
          />
          {child.display_name}
        </label>
      ))}
    </fieldset>
  );
}

export function FormPanel({ title, icon, children, onSubmit, submitLabel = "保存" }: { title: string; icon: ReactNode; children: ReactNode; onSubmit: () => void; submitLabel?: string }) {
  return (
    <section className="panel">
      <div className="panel-title">{icon}<h2>{title}</h2></div>
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        {children}
        <button className="primary"><Plus size={18} />{submitLabel}</button>
      </form>
    </section>
  );
}

export function CategoryOverview({ items, onCreate, onUpdate, onDelete }: { items: Category[]; onCreate: (data: any) => any; onUpdate: (item: Category, data: any) => any; onDelete: (item: Category) => void }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [data, setData] = useState({ name: "", iconValue: "📚" });
  return (
    <section className="panel">
      <div className="panel-title"><Star /><h2>任务分类</h2></div>
      <form className="stack compact" onSubmit={async (event) => { event.preventDefault(); if (await onCreate({ ...data, iconType: "emoji" })) setData({ name: "", iconValue: "📚" }); }}>
        <Field label="名称"><input required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></Field>
        <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
        <button className="primary"><Plus size={18} />新建分类</button>
      </form>
      <div className="list config-list scroll-list">
        {items.length ? items.map((item) => (
          <article className="row config-row" key={item.id}>
            <div className="config-main">
              {icon(item.icon_type, item.icon_value, item.name)}
              <div>
                <strong>{item.name}</strong>
                <span>{item.is_system ? "系统预置，编辑后仅影响当前家长" : "自定义分类"}</span>
              </div>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setEditing(item)}><Edit3 size={16} />编辑</button>
              <button className="icon danger" title="删除" onClick={() => onDelete(item)}><Trash2 size={18} /></button>
            </div>
          </article>
        )) : <Empty text="暂无分类" />}
      </div>
      {editing && (
        <EditDialog title="编辑任务分类" icon={<Star />} onClose={() => setEditing(null)}>
          <CategoryEditForm item={editing} onCancel={() => setEditing(null)} onSave={async (data) => { if (await onUpdate(editing, data)) setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

export function CategoryEditForm({ item, onSave, onCancel }: { item: Category; onSave: (data: any) => any; onCancel: () => void }) {
  const [data, setData] = useState({ name: item.name, iconValue: item.icon_value });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="名称"><input required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></Field>
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

export function Overview({ title, items, kind, children = [], categories = [], tasks = [], achievements = [], onUpdate, onDelete }: { title: string; items: any[]; kind: "task" | "reward" | "achievement"; children?: Child[]; categories?: Category[]; tasks?: Task[]; achievements?: any[]; onUpdate?: (item: any, data: any) => any; onDelete?: (item: any) => void }) {
  const [editing, setEditing] = useState<any | null>(null);
  const titleLabel = kind === "reward" ? "奖励" : kind === "achievement" ? "成就称号" : "任务";
  return (
    <section className="panel">
      <div className="panel-title"><Star /><h2>{title}</h2></div>
      <div className="list config-list scroll-list">
        {items.length ? items.map((item) => (
          <article className="row config-row" key={item.id}>
            <div className="config-main">
              {icon(item.icon_type, item.icon_value, item.title)}
              <div>
                <strong>{kind === "reward" ? rewardDisplayTitle(item) : item.title}</strong>
                {item.description && <span>{item.description}</span>}
                <small>
                  {kind === "task" && `${item.is_active ? "启用" : "停用"} · ${formatPeriod(item.period)} · ${item.grading_mode === "completion" ? "完成程度给分" : `+${item.points}`} · ${item.limit_count || 1}次 · ${weekdayLabel(item.enabled_weekdays || item.enabledWeekdays)}${item.is_required === 1 ? ` · 必做 ${item.required_count || 1} 次 · 未达标扣 ${item.required_penalty_points || 0} 分${item.required_remedy_enabled === 1 ? ` · 可补救 ${item.required_remedy_points || 0} 分 / ${item.required_remedy_deadline_hours || 24} 小时` : ""}` : ""}`}
                  {kind === "task" && submissionDeadlineText(item.period, parseSubmissionDeadline(item)) ? ` · ${submissionDeadlineText(item.period, parseSubmissionDeadline(item))}` : ""}
                  {kind === "reward" && `${item.is_active ? "启用" : "停用"} · ${item.cost_points}积分 · ${formatPeriod(item.limit_period)}${item.limit_period === "once" ? "" : ` · ${item.limit_count || 1}次`} · 核销${weekdayLabel(item.redeem_weekdays || item.redeemWeekdays)}${item.requiredAchievementTitle ? ` · 解锁${item.requiredAchievementTitle}` : ""}`}
                  {kind === "achievement" && formatAchievementRule(item, tasks, categories)}
                </small>
              </div>
            </div>
            <div className="actions">
              {onUpdate && <button className="secondary" onClick={() => setEditing(item)}><Edit3 size={16} />编辑</button>}
              {onDelete && <button className="icon danger" title="删除" onClick={() => onDelete(item)}><Trash2 size={18} /></button>}
            </div>
          </article>
        )) : <Empty text="暂无内容" />}
      </div>
      {editing && onUpdate && (
        <EditDialog title={`编辑${titleLabel}`} icon={kind === "reward" ? <Gift /> : kind === "achievement" ? <Award /> : <ClipboardCheck />} onClose={() => setEditing(null)}>
          <EditItemForm kind={kind} item={editing} children={children} categories={categories} tasks={tasks} achievements={achievements} onCancel={() => setEditing(null)} onSave={async (data) => { if (await onUpdate(editing, data)) setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

export function EditItemForm({ kind, item, children, categories, tasks, achievements, onSave, onCancel }: { kind: "task" | "reward" | "achievement"; item: any; children: Child[]; categories: Category[]; tasks: Task[]; achievements: any[]; onSave: (data: any) => any; onCancel: () => void }) {
  const [data, setData] = useState<any>(() => ({
    title: item.title || "",
    description: item.description || "",
    categoryId: item.category_id || categories[0]?.id || "",
    period: item.period || "daily",
    limitCount: item.limit_count || item.limitCount || 1,
    points: item.points || 0,
    costPoints: item.cost_points || 0,
    limitPeriod: item.limit_period === "none" ? "daily" : item.limit_period || "daily",
    metric: item.metric || "tasks_completed",
    condition: conditionFromAchievement(item),
    threshold: item.threshold || 1,
    windowStart: item.window_start || "",
    windowEnd: item.window_end || "",
    targetTaskId: item.target_task_id || "",
    targetCategoryId: item.target_category_id || "",
    requiredAchievementId: item.requiredAchievementId || item.required_achievement_id || "",
    enabledWeekdays: normalizeWeekdaysLocal(item.enabled_weekdays || item.enabledWeekdays),
    redeemWeekdays: normalizeWeekdaysLocal(item.redeem_weekdays || item.redeemWeekdays),
    prerequisites: item.prerequisites || [],
    iconValue: item.icon_value || "⭐",
    isActive: item.is_active !== 0,
    childIds: item.assignees || [],
    isRequired: item.is_required === 1,
    requiredCount: item.required_count || 1,
    requiredPenaltyPoints: item.required_penalty_points || 0,
    requiredRemedyEnabled: item.required_remedy_enabled === 1,
    requiredRemedyCondition: item.required_remedy_condition || "",
    requiredRemedyPoints: item.required_remedy_points || 0,
    requiredRemedyDeadlineHours: item.required_remedy_deadline_hours || 24,
    gradingMode: item.grading_mode || "fixed",
    completionStandards: parseCompletionStandards(item).length ? parseCompletionStandards(item) : [{ label: "完成", points: item.points || 0 }],
    submissionDeadlineEnabled: Boolean(parseSubmissionDeadline(item)),
    submissionDeadline: parseSubmissionDeadline(item)
  }));
  const showRequired = kind === "task" && data.period !== "once";
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave(kind === "achievement" ? achievementPayload({ ...data, targetTaskId: data.targetTaskId || tasks[0]?.id || "", targetCategoryId: data.targetCategoryId || categories[0]?.id || "" }) : { ...data, limitCount: kind === "reward" && data.limitPeriod === "once" ? 1 : data.limitCount, iconType: "emoji", completionStandards: cleanCompletionStandards(data.completionStandards || []), submissionDeadline: kind === "task" && data.submissionDeadlineEnabled ? data.submissionDeadline : null }); }}>
      <Field label={kind === "reward" ? "名称" : "标题"}><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      {kind !== "task" && kind !== "reward" ? null : <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>}
      {kind === "task" && (
        <>
          <Field label="分类"><select value={data.categoryId} onChange={(e) => setData({ ...data, categoryId: e.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="周期"><select value={data.period} onChange={(e) => setData({ ...data, period: e.target.value, isRequired: e.target.value === "once" ? false : data.isRequired, submissionDeadlineEnabled: false, submissionDeadline: null })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="once">一次性</option></select></Field>
          <>
            <Toggle label="设置提交截止时间" checked={data.submissionDeadlineEnabled} onChange={(submissionDeadlineEnabled) => setData({ ...data, submissionDeadlineEnabled, submissionDeadline: submissionDeadlineEnabled ? defaultSubmissionDeadline(data.period) : null })} />
            {data.submissionDeadlineEnabled && <SubmissionDeadlineFields period={data.period} value={data.submissionDeadline || defaultSubmissionDeadline(data.period)} onChange={(submissionDeadline) => setData({ ...data, submissionDeadline })} />}
          </>
          <Field label="次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>
          <Field label="启用周几"><WeekdayPicker value={data.enabledWeekdays} onChange={(enabledWeekdays) => setData({ ...data, enabledWeekdays })} /></Field>
          <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Toggle label="按完成程度给分" checked={data.gradingMode === "completion"} onChange={(checked) => setData({ ...data, gradingMode: checked ? "completion" : "fixed" })} />
      {data.gradingMode === "completion" && <CompletionStandardsEditor value={data.completionStandards} onChange={(completionStandards) => setData({ ...data, completionStandards })} />}
          {showRequired && (
            <>
              <Toggle label="必做任务" checked={data.isRequired} onChange={(isRequired) => setData({ ...data, isRequired })} />
              {data.isRequired && (
                <>
                  <div className="grid two compact-fields">
                    <Field label="必做次数"><input type="number" min="1" value={data.requiredCount} onChange={(e) => setData({ ...data, requiredCount: Number(e.target.value) })} /></Field>
                    <Field label="未达标扣分"><input type="number" min="0" value={data.requiredPenaltyPoints} onChange={(e) => setData({ ...data, requiredPenaltyPoints: Number(e.target.value) })} /></Field>
                  </div>
                  <Toggle label="扣分后可补救" checked={data.requiredRemedyEnabled} onChange={(requiredRemedyEnabled) => setData({ ...data, requiredRemedyEnabled })} />
                  {data.requiredRemedyEnabled && <>
                    <Field label="补救条件"><textarea value={data.requiredRemedyCondition} onChange={(e) => setData({ ...data, requiredRemedyCondition: e.target.value })} /></Field>
                    <div className="grid two compact-fields">
                      <Field label="挽回积分"><input type="number" min="1" max={data.requiredPenaltyPoints} value={data.requiredRemedyPoints} onChange={(e) => setData({ ...data, requiredRemedyPoints: Number(e.target.value) })} /></Field>
                      <Field label="补救时限（小时）"><input type="number" min="1" value={data.requiredRemedyDeadlineHours} onChange={(e) => setData({ ...data, requiredRemedyDeadlineHours: Number(e.target.value) })} /></Field>
                    </div>
                  </>}
                </>
              )}
            </>
          )}
        </>
      )}
      {kind === "reward" && (
        <>
          <Field label="所需积分"><input type="number" min="0" value={data.costPoints} onChange={(e) => setData({ ...data, costPoints: Number(e.target.value) })} /></Field>
          <Field label="限制周期"><select value={data.limitPeriod} onChange={(e) => setData({ ...data, limitPeriod: e.target.value })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="once">一次性</option></select></Field>
          {data.limitPeriod !== "once" && <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>}
          <Field label="核销周几"><WeekdayPicker value={data.redeemWeekdays} onChange={(redeemWeekdays) => setData({ ...data, redeemWeekdays })} /></Field>
          <PrerequisiteEditor tasks={tasks} value={data.prerequisites} onChange={(prerequisites) => setData({ ...data, prerequisites })} />
          <Field label="解锁成就称号">
            <select value={data.requiredAchievementId} onChange={(e) => setData({ ...data, requiredAchievementId: e.target.value })}>
              <option value="">无条件</option>
              {achievements.map((achievement) => <option key={achievement.id} value={achievement.id}>{achievement.title}</option>)}
            </select>
          </Field>
        </>
      )}
      {kind === "achievement" && (
        <>
          <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
          <AchievementRuleFields data={data} setData={setData} tasks={tasks} categories={categories} />
        </>
      )}
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      {(kind === "task" || kind === "reward") && <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />}
      {(kind === "task" || kind === "reward") && <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />}
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

export function ChildEditForm({ child, onSave, onCancel }: { child: Child; onSave: (data: any) => any; onCancel: () => void }) {
  const [data, setData] = useState({ displayName: child.display_name, password: "", aiEnabled: child.ai_enabled === 1, gender: child.gender || "", birthDate: child.birth_date || "", dailyReviewEnabled: child.daily_review_enabled !== 0, dailyReviewSeconds: child.daily_review_seconds ?? 30 });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, password: data.password || undefined }); }}>
      <Field label="姓名"><input required value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} /></Field>
      <Field label="新密码"><input value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} placeholder="留空则不修改" type="password" autoComplete="new-password" /></Field>
      <Field label="性别">
        <select value={data.gender} onChange={(e) => setData({ ...data, gender: e.target.value })}>
          <option value="">未设置</option>
          <option value="male">男</option>
          <option value="female">女</option>
        </select>
      </Field>
      <Field label="出生日期"><input type="date" value={data.birthDate} onChange={(e) => setData({ ...data, birthDate: e.target.value })} /></Field>
      <Toggle label="启用 AI 寄语" checked={data.aiEnabled} onChange={(aiEnabled) => setData({ ...data, aiEnabled })} />
      <Toggle label="启用昨日表现回顾" checked={data.dailyReviewEnabled} onChange={(dailyReviewEnabled) => setData({ ...data, dailyReviewEnabled })} />
      <Field label="回顾阅读时间（秒）"><input type="number" min="0" max="300" step="1" value={data.dailyReviewSeconds} disabled={!data.dailyReviewEnabled} onChange={(e) => setData({ ...data, dailyReviewSeconds: Number(e.target.value) })} /></Field>
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}
