import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Award, BadgeCheck, Check, ClipboardCheck, Coins, Download, Edit3, Gift, KeyRound,
  MessageSquare, Plus, Printer, RotateCcw, Sparkles, Star, Trash2, Upload, Users
} from "lucide-react";
import { Me, Child, Category, Task, Reward, FeedbackTemplate, LedgerRow, WarehouseItem, FeedbackEvent, LedgerResponse, REFRESH_INTERVAL_MS, DEFAULT_WEEKDAYS, ParentAiServiceConfig, CartoonReportResponse, ParentDelegate } from "./types/api";
import { api } from "./api/client";
import { Field, Empty, FeedbackToast, Tabs, Toggle, EditDialog, icon, WeekdayPicker, formatPeriod, formatTime, weekdayLabel, rewardDisplayTitle, formatSource, PrerequisiteEditor, normalizeWeekdaysLocal } from "./components/UI";
import { EmojiSelect } from "./components/EmojiSelect";
import { Shell } from "./components/Shell";
import { ACHIEVEMENT_CONDITIONS, conditionFromAchievement, achievementPayload, formatAchievementRule } from "./lib/appHelpers";

type ParentAiServiceStoredConfig = Omit<ParentAiServiceConfig, "apiKey"> & { updatedAt?: string };
const EMPTY_AI_DRAFT: ParentAiServiceConfig = { baseUrl: "", model: "", prompt: "", reportPrompt: "", monthlyPrompt: "", hasKey: false, imageBaseUrl: "", imageModel: "gpt-image-2", imagePrompt: "", imageSize: "1024x1024", imageQuality: "low", imageFormat: "jpeg", imageN: 1, hasImageKey: false };

export function ParentApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [feedbackTemplates, setFeedbackTemplates] = useState<FeedbackTemplate[]>([]);
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
  const [aiPreviewResult, setAiPreviewResult] = useState<{ title: string; text: string } | null>(null);
  const [cartoonReportGenerating, setCartoonReportGenerating] = useState<"" | "weekly" | "monthly">("");
  const [cartoonReportResult, setCartoonReportResult] = useState<(CartoonReportResponse & { title: string }) | null>(null);
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
      imageSize: nextConfig.imageSize || "1024x1024",
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
      setAiPreviewResult({ title, text: result.text || "本次没有返回内容" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 预览失败");
    } finally {
      setAiPreviewing("");
    }
  }

  async function load() {
    if (loadLockRef.current) return;
    loadLockRef.current = true;
    let hasError = false;
    try {
      const [childRows, categoryRows, taskRows, rewardRows, achievementRows, feedbackRows, delegateRows, dash, aiRows] = await Promise.all([
        api<Child[]>("/children").catch(() => { hasError = true; return [] as Child[]; }),
        api<Category[]>("/task-categories").catch(() => { hasError = true; return [] as Category[]; }),
        api<Task[]>("/tasks").catch(() => { hasError = true; return [] as Task[]; }),
        api<Reward[]>("/rewards").catch(() => { hasError = true; return [] as Reward[]; }),
        api<any[]>("/achievements").catch(() => { hasError = true; return []; }),
        api<FeedbackTemplate[]>("/feedback-templates").catch(() => { hasError = true; return [] as FeedbackTemplate[]; }),
        me.role === "parent" ? api<ParentDelegate[]>("/parent/delegates").catch(() => []) : Promise.resolve([] as ParentDelegate[]),
        api<any>("/dashboard/parent").catch(() => { hasError = true; return { pendingSubmissions: [], pendingRedemptions: [], children: [] }; }),
        api<ParentAiServiceStoredConfig>("/parent/ai-service").catch(() => ({ ...EMPTY_AI_DRAFT, updatedAt: "" }))
      ]);
      setChildren(childRows);
      setCategories(categoryRows);
      setTasks(taskRows);
      setRewards(rewardRows);
      setAchievements(achievementRows);
      setFeedbackTemplates(feedbackRows);
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
  useEffect(() => {
    void load();
    pollingRef.current = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    function onVisibility() {
      if (document.hidden) {
        if (pollingRef.current !== null) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      } else if (pollingRef.current === null) {
        void load();
        pollingRef.current = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
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
  }, [activeTab, aiConfigLoaded, savedAiConfig.baseUrl, savedAiConfig.model, savedAiConfig.prompt, savedAiConfig.hasKey, savedAiConfig.imageBaseUrl, savedAiConfig.imageModel, savedAiConfig.imagePrompt, savedAiConfig.hasImageKey]);
  useEffect(() => {
    if (activeTab !== "settings") return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".settings-surface > .setting-group").forEach((section, index) => {
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

  async function review(id: string, approved: boolean) {
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
      () => api(`/task-submissions/${id}/review`, { method: "PATCH", body: JSON.stringify({ approved, note: "" }) }),
      "任务已通过并结算积分"
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

  function exportChildPrint(child: Child) {
    window.open(`/api/children/${encodeURIComponent(child.id)}/export-print`, "_blank", "noopener,noreferrer");
  }

  function exportChildReport(child: Child, period: "weekly" | "monthly") {
    window.open(`/api/children/${encodeURIComponent(child.id)}/report?period=${period}`, "_blank", "noopener,noreferrer");
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
                <small>当前积分</small>
              </button>
            ))}
          </div>
          <div className="grid two">
            <ReviewPanel title="任务审核" items={dashboard.pendingSubmissions || []} empty="没有待审核任务" approve={(id) => review(id, true)} reject={(id) => review(id, false)} />
            <RedemptionPanel items={dashboard.pendingRedemptions || []} onFinish={finishRedemption} />
          </div>
          <div className="grid two">
            <PraiseCriticismPanel children={children} templates={feedbackTemplates.filter((item) => item.is_active !== 0)} onSubmit={applyFeedback} />
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
                    <select value={draftAiConfig.model} onChange={(e) => updateAiDraft({ model: e.target.value })} style={{ flex: 1 }}>
                      {!draftAiConfig.model && <option value="">请选择或拉取模型列表</option>}
                      {aiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
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
                <div className="grid two compact-fields">
                  <Field label="尺寸">
                    <select value={draftAiConfig.imageSize || "1024x1024"} onChange={(e) => updateAiDraft({ imageSize: e.target.value })}>
                      <option value="1024x1024">1024x1024</option>
                      <option value="1536x1024">1536x1024</option>
                      <option value="1024x1536">1024x1536</option>
                      <option value="2048x2048">2048x2048</option>
                      <option value="2048x1152">2048x1152</option>
                      <option value="3840x2160">3840x2160</option>
                      <option value="2160x3840">2160x3840</option>
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
          generating={cartoonReportGenerating}
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
          onClose={() => setAiPreviewResult(null)}
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

export function ReviewPanel({ title, items, empty, approve, reject }: { title: string; items: any[]; empty: string; approve: (id: string) => void; reject: (id: string) => void }) {
  const groups = [...new Map(items.map((item) => [item.child_id, { id: item.child_id, name: item.child_name }])).values()];
  const [activeChildId, setActiveChildId] = useState("");
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
          visible.map((item: any) => (
            <article className="row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.child_name} · {item.period_key}</span>
              </div>
              <div className="actions">
                <button className="icon good" title="通过" onClick={() => approve(item.id)}>
                  <Check size={18} />
                </button>
                <button className="icon danger" title="驳回" onClick={() => reject(item.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))
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

export function PraiseCriticismPanel({ children, templates, onSubmit }: { children: Child[]; templates: FeedbackTemplate[]; onSubmit: (data: { childId: string; templateId: string }) => void }) {
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
    </section>
  );
}

export function LedgerList({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="list ledger-list">
      {rows.length ? rows.map((row) => (
        <article className="row" key={row.id}>
          <div>
            <strong className={row.amount >= 0 ? "positive" : "negative"}>{row.amount >= 0 ? "+" : ""}{row.amount}</strong>
            <span>{[row.sourceLabel || row.note || formatSource(row.source_type), row.actorLabel ? `操作者：${row.actorLabel}` : "", row.localCreatedAt || formatTime(row.created_at)].filter(Boolean).join(" · ")}</span>
          </div>
          <span>{row.sourceTypeLabel || formatSource(row.source_type)}</span>
        </article>
      )) : <Empty text="暂无积分记录" />}
    </div>
  );
}

export function LedgerModal({ title, rows, onClose }: { title: string; rows: LedgerRow[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel ledger-modal">
        <div className="panel-title compact-title">
          <Coins />
          <h2>{title}</h2>
          <button className="secondary" onClick={onClose}>关闭</button>
        </div>
        <LedgerList rows={rows} />
      </section>
    </div>
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
      <section className="panel refund-modal">
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
      <section className="panel refund-modal">
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
                <span>{item.localCreatedAt || formatTime(item.created_at)} · {item.amount >= 0 ? "+" : ""}{item.amount} 积分</span>
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

export function ReportDialog({ child, onPrint, onReport, onCartoonReport, generating, onClose }: { child: Child; onPrint: (child: Child) => void; onReport: (child: Child, period: "weekly" | "monthly") => void; onCartoonReport: (child: Child, period: "weekly" | "monthly") => void; generating: "" | "weekly" | "monthly"; onClose: () => void }) {
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

export function AiPreviewDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel refund-modal">
        <div className="panel-title compact-title">
          <Sparkles />
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        <p className="ai-preview-text">{text}</p>
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
              <span>{child.username} · {child.status === "active" ? "启用" : "停用"}</span>
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

export function CreateTask({ children, categories, onCreate }: { children: Child[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", categoryId: "", period: "daily", limitCount: 1, points: 5, enabledWeekdays: [...DEFAULT_WEEKDAYS], iconValue: "✅", isActive: true, childIds: [] as string[] });
  const categoryId = data.categoryId || categories[0]?.id || "";
  return (
    <FormPanel title="新任务" icon={<ClipboardCheck />} onSubmit={() => onCreate({ ...data, categoryId, iconType: "emoji" })}>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <Field label="分类">
        <select value={categoryId} onChange={(e) => setData({ ...data, categoryId: e.target.value })}>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="周期">
        <select value={data.period} onChange={(e) => setData({ ...data, period: e.target.value })}>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
          <option value="once">一次性</option>
        </select>
      </Field>
      <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>
      <Field label="启用周几"><WeekdayPicker value={data.enabledWeekdays} onChange={(enabledWeekdays) => setData({ ...data, enabledWeekdays })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Field label="符号"><EmojiSelect value={data.iconValue} onChange={(iconValue) => setData({ ...data, iconValue })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
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
  const [data, setData] = useState({ kind: "praise", title: "", points: 5, iconValue: "✨", isActive: true });
  return (
    <FormPanel title="新条款" icon={<MessageSquare />} onSubmit={() => onCreate({ ...data, iconType: "emoji" })}>
      <Field label="类型">
        <select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value, iconValue: e.target.value === "praise" ? "✨" : "⚠️" })}>
          <option value="praise">表扬</option>
          <option value="criticism">批评</option>
        </select>
      </Field>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
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
                <small>{item.kind === "praise" ? "表扬" : "批评"} · {item.is_active ? "启用" : "停用"} · <span className={item.kind === "praise" ? "positive" : "negative"}>{item.kind === "praise" ? "+" : "-"}{item.points} 积分</span></small>
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
  const [data, setData] = useState({ kind: item.kind, title: item.title, points: item.points || 0, iconValue: item.icon_value || "✨", isActive: item.is_active !== 0 });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="类型"><select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value as "praise" | "criticism" })}><option value="praise">表扬</option><option value="criticism">批评</option></select></Field>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
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
                  {kind === "task" && `${item.is_active ? "启用" : "停用"} · ${formatPeriod(item.period)} · +${item.points} · ${item.limit_count || 1}次 · ${weekdayLabel(item.enabled_weekdays || item.enabledWeekdays)}`}
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
    childIds: item.assignees || []
  }));
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave(kind === "achievement" ? achievementPayload({ ...data, targetTaskId: data.targetTaskId || tasks[0]?.id || "", targetCategoryId: data.targetCategoryId || categories[0]?.id || "" }) : { ...data, limitCount: kind === "reward" && data.limitPeriod === "once" ? 1 : data.limitCount, iconType: "emoji" }); }}>
      <Field label={kind === "reward" ? "名称" : "标题"}><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      {kind !== "task" && kind !== "reward" ? null : <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>}
      {kind === "task" && (
        <>
          <Field label="分类"><select value={data.categoryId} onChange={(e) => setData({ ...data, categoryId: e.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="周期"><select value={data.period} onChange={(e) => setData({ ...data, period: e.target.value })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="once">一次性</option></select></Field>
          <Field label="次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>
          <Field label="启用周几"><WeekdayPicker value={data.enabledWeekdays} onChange={(enabledWeekdays) => setData({ ...data, enabledWeekdays })} /></Field>
          <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
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
  const [data, setData] = useState({ displayName: child.display_name, password: "", aiEnabled: child.ai_enabled === 1, gender: child.gender || "", birthDate: child.birth_date || "" });
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
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}
