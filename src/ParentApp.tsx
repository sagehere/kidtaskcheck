import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Award, BadgeCheck, Check, ClipboardCheck, Coins, Download, Edit3, Gift, KeyRound,
  MessageSquare, Plus, Printer, RotateCcw, Sparkles, Star, Trash2, Upload, Users
} from "lucide-react";
import { Me, Child, Category, Task, Reward, FeedbackTemplate, LedgerRow, WarehouseItem, FeedbackEvent, LedgerResponse, REFRESH_INTERVAL_MS, DEFAULT_WEEKDAYS, ParentAiServiceConfig } from "./types/api";
import { api } from "./api/client";
import { Field, Empty, FeedbackToast, Tabs, Toggle, EditDialog, icon, WeekdayPicker, formatPeriod, formatTime, weekdayLabel, rewardDisplayTitle, formatSource, PrerequisiteEditor, normalizeWeekdaysLocal } from "./components/UI";
import { EmojiSelect } from "./components/EmojiSelect";
import { Shell } from "./components/Shell";
import { ACHIEVEMENT_CONDITIONS, conditionFromAchievement, achievementPayload, formatAchievementRule } from "./lib/appHelpers";

type ParentAiServiceStoredConfig = Omit<ParentAiServiceConfig, "apiKey"> & { updatedAt?: string };
const EMPTY_AI_DRAFT: ParentAiServiceConfig = { baseUrl: "", model: "", prompt: "", hasKey: false };

export function ParentApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [feedbackTemplates, setFeedbackTemplates] = useState<FeedbackTemplate[]>([]);
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
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiFetching, setAiFetching] = useState(false);
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [aiConfigLoaded, setAiConfigLoaded] = useState(false);
  const [profileForm, setProfileForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const resetTapCount = useRef(0);
  const resetTapTimer = useRef<number | null>(null);
  const loadLockRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const aiDraftInitializedRef = useRef(false);
  const aiDraftDirtyRef = useRef(false);

  function syncAiDraft(nextConfig: ParentAiServiceStoredConfig) {
    setDraftAiConfig({
      baseUrl: nextConfig.baseUrl,
      model: nextConfig.model,
      prompt: nextConfig.prompt,
      hasKey: nextConfig.hasKey
    });
    setDraftAiApiKey("");
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

  async function load() {
    if (loadLockRef.current) return;
    loadLockRef.current = true;
    let hasError = false;
    try {
      const [childRows, categoryRows, taskRows, rewardRows, achievementRows, feedbackRows, dash, aiRows] = await Promise.all([
        api<Child[]>("/children").catch(() => { hasError = true; return [] as Child[]; }),
        api<Category[]>("/task-categories").catch(() => { hasError = true; return [] as Category[]; }),
        api<Task[]>("/tasks").catch(() => { hasError = true; return [] as Task[]; }),
        api<Reward[]>("/rewards").catch(() => { hasError = true; return [] as Reward[]; }),
        api<any[]>("/achievements").catch(() => { hasError = true; return []; }),
        api<FeedbackTemplate[]>("/feedback-templates").catch(() => { hasError = true; return [] as FeedbackTemplate[]; }),
        api<any>("/dashboard/parent").catch(() => { hasError = true; return { pendingSubmissions: [], pendingRedemptions: [], children: [] }; }),
        api<ParentAiServiceStoredConfig>("/parent/ai-service").catch(() => ({ baseUrl: "", hasKey: false, model: "", prompt: "", updatedAt: "" }))
      ]);
      setChildren(childRows);
      setCategories(categoryRows);
      setTasks(taskRows);
      setRewards(rewardRows);
      setAchievements(achievementRows);
      setFeedbackTemplates(feedbackRows);
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
  }, [activeTab, aiConfigLoaded, savedAiConfig.baseUrl, savedAiConfig.model, savedAiConfig.prompt, savedAiConfig.hasKey]);
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
          newPassword: profileForm.newPassword
        })
      });
      setProfileForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    }, "密码已更新");
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

  const aiDraftApiKeyValue = draftAiApiKey.trim();
  const aiFetchApiKey = aiDraftApiKeyValue;

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
        <>
          <section className="setting-group">
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
          <section className="setting-group">
            <div className="panel-title"><Gift /><h2>奖励配置</h2></div>
              <CreateReward children={children} tasks={tasks} achievements={achievements} onCreate={(data) => create("/rewards", data, "奖励已创建")} />
            <Overview title="现有奖励" items={rewards} kind="reward" children={children} tasks={tasks} achievements={achievements} onUpdate={(item, data) => update(`/rewards/${item.id}`, data, "奖励已更新")} onDelete={(item) => remove(`/rewards/${item.id}`, "奖励已删除", `确认删除奖励「${item.title}」？历史兑换记录会保留。`)} />
          </section>
          <section className="setting-group">
            <div className="panel-title"><Award /><h2>成就称号</h2></div>
            <CreateAchievement tasks={tasks} categories={categories} onCreate={(data) => create("/achievements", data, "成就称号已创建")} />
            <Overview title="成就称号" items={achievements} kind="achievement" tasks={tasks} categories={categories} onUpdate={(item, data) => update(`/achievements/${item.id}`, data, "成就称号已更新")} onDelete={(item) => remove(`/achievements/${item.id}`, "成就称号已删除", `确认删除成就称号「${item.title}」？已解锁历史会保留。`)} />
          </section>
          <section className="setting-group">
            <div className="panel-title"><MessageSquare /><h2>表扬与批评条款</h2></div>
            <CreateFeedbackTemplate onCreate={(data) => create("/feedback-templates", data, "条款已创建")} />
            <FeedbackOverview items={feedbackTemplates} onUpdate={(item, data) => update(`/feedback-templates/${item.id}`, data, "条款已更新")} onDelete={(item) => remove(`/feedback-templates/${item.id}`, "条款已删除", `确认删除${item.kind === "praise" ? "表扬" : "批评"}条款「${item.title}」？历史积分记录会保留。`)} />
          </section>
          <ConfigPortPanel onImported={load} />
          <section className="panel setting-group">
            <div className="panel-title"><KeyRound /><h2>修改密码</h2></div>
            <form className="stack compact" onSubmit={updateProfile}>
              <Field label="当前密码">
                <input value={profileForm.currentPassword} onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })} type="password" autoComplete="current-password" required />
              </Field>
              <Field label="新密码">
                <input value={profileForm.newPassword} onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })} type="password" autoComplete="new-password" required />
              </Field>
              <Field label="确认新密码">
                <input value={profileForm.confirmPassword} onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} type="password" autoComplete="new-password" required />
              </Field>
              <button className="primary"><KeyRound size={18} />保存密码</button>
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
              await run(async () => {
                const response = await api<Partial<ParentAiServiceStoredConfig>>("/parent/ai-service", {
                  method: "PATCH",
                  body: JSON.stringify({
                    baseUrl: draftAiConfig.baseUrl,
                    apiKey: nextApiKey || undefined,
                    model: draftAiConfig.model,
                    prompt: draftAiConfig.prompt
                  })
                });
                const nextSaved: ParentAiServiceStoredConfig = {
                  ...savedAiConfig,
                  ...response,
                  baseUrl: response.baseUrl ?? draftAiConfig.baseUrl,
                  model: response.model ?? draftAiConfig.model,
                  prompt: response.prompt ?? draftAiConfig.prompt,
                  hasKey: (response.hasKey ?? savedAiConfig.hasKey) || !!nextApiKey,
                  updatedAt: response.updatedAt ?? savedAiConfig.updatedAt
                };
                storeSavedAiConfig(nextSaved);
                syncAiDraft(nextSaved);
              }, "AI 服务配置已保存");
            }}>
              <Field label="Base URL">
                <input value={draftAiConfig.baseUrl} onChange={(e) => updateAiDraft({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
              </Field>
              <Field label="API Key">
                <input value={draftAiApiKey} onChange={(e) => updateAiApiKey(e.target.value)} type="password" placeholder={savedAiConfig.hasKey ? "已设置，留空则保留" : "请输入 API Key"} autoComplete="new-password" />
              </Field>
              <Field label="模型">
                <div className="inline-fields">
                  <select value={draftAiConfig.model} onChange={(e) => updateAiDraft({ model: e.target.value })} style={{ flex: 1 }}>
                    {!draftAiConfig.model && <option value="">请选择或拉取模型列表</option>}
                    {aiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <button type="button" className="secondary" disabled={aiFetching || !draftAiConfig.baseUrl} onClick={async () => { setAiFetching(true); try { const modelsBody: { baseUrl: string; apiKey?: string } = { baseUrl: draftAiConfig.baseUrl }; if (aiFetchApiKey) modelsBody.apiKey = aiFetchApiKey; const data = await api<{ models: string[] }>("/parent/ai-service/models", { method: "POST", body: JSON.stringify(modelsBody) }); setAiModels(data.models); if (data.models.length && !draftAiConfig.model) updateAiDraft({ model: data.models[0] }); } catch (err) { setError(err instanceof Error ? err.message : "拉取失败"); } finally { setAiFetching(false); } }}>{aiFetching ? "获取中..." : "拉取模型"}</button>
                </div>
              </Field>
              <Field label="提示词">
                <textarea value={draftAiConfig.prompt} onChange={(e) => updateAiDraft({ prompt: e.target.value })} rows={4} />
              </Field>
              <button className="primary"><Sparkles size={18} />保存 AI 配置</button>
              <div className="inline-fields">
                <button type="button" className="secondary" onClick={() => { syncAiDraft(savedAiConfig); setMessage("AI 配置已恢复为已保存内容"); }}>
                  重载 AI 配置
                </button>
                <button type="button" className="secondary" disabled={aiRefreshing} onClick={async () => { setAiRefreshing(true); try { const r = await api<{ success: number; failed: number }>("/parent/ai-service/refresh-greetings", { method: "POST" }); setMessage("AI 寄语刷新完成：成功 " + r.success + "，失败 " + r.failed); } catch (err) { setError(err instanceof Error ? err.message : "刷新失败"); } finally { setAiRefreshing(false); } }}>{aiRefreshing ? "刷新中..." : "刷新 AI 寄语"}</button>
              </div>
            </form>
          </section>
        </>
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
            <span>{row.sourceLabel || row.note || formatSource(row.source_type)} · {row.localCreatedAt || formatTime(row.created_at)}</span>
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

export function ReportDialog({ child, onPrint, onReport, onClose }: { child: Child; onPrint: (child: Child) => void; onReport: (child: Child, period: "weekly" | "monthly") => void; onClose: () => void }) {
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
          <button className="secondary" onClick={() => { onReport(child, "weekly"); onClose(); }}>
            <Printer size={18} />查看周报
          </button>
          <button className="secondary" onClick={() => { onReport(child, "monthly"); onClose(); }}>
            <Printer size={18} />查看月报
          </button>
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
      const stats = await api<Record<string, { created: number; skipped: number }>>("/config/import", { method: "POST", body: JSON.stringify(data) });
      setSummary(Object.entries(stats).map(([key, value]) => `${key}: 新增 ${value.created}，跳过 ${value.skipped}`).join("；"));
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
  const [previewGreeting, setPreviewGreeting] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
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
      <Field label="AI 寄语预览">
        <div className="inline-fields">
          <button type="button" className="secondary" disabled={previewLoading || !data.aiEnabled} onClick={async () => { setPreviewLoading(true); try { const r = await api<{ greeting: string }>(`/children/${encodeURIComponent(child.id)}/ai-greeting`, { method: "POST" }); setPreviewGreeting(r.greeting || "(未生成寄语)"); } catch (err) { setPreviewGreeting(`获取失败：${err instanceof Error ? err.message : "未知错误"}`); } finally { setPreviewLoading(false); } }}>{previewLoading ? "获取中..." : "刷新 AI 寄语"}</button>
        </div>
        {previewGreeting && <p className="ai-preview-text">{previewGreeting}</p>}
      </Field>
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}
