import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, Award, ClipboardCheck, Coins, Gift, Package, Pin, Star, Calendar, Bold, Italic, Underline, List, Eye, EyeOff } from "lucide-react";
import { Me, LedgerRow, LedgerResponse, WarehouseItem, REFRESH_INTERVAL_MS, ChildScheduleData, ChildScheduleSlot, DailyReview } from "./types/api";
import { api } from "./api/client";
import { Empty, FeedbackToast, Tabs, icon, formatPeriod, formatReset, formatTime, rewardDisplayTitle } from "./components/UI";
import { LedgerModal } from "./components/LedgerModal";
import { Shell } from "./components/Shell";

function SchedulePlanEditor({
  html,
  onSelect,
  onChange
}: {
  html: ChildScheduleSlot["planHtml"];
  onSelect: () => void;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = html || "";
    if (document.activeElement === editor) return;
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [html]);

  return (
    <div
      ref={editorRef}
      className="schedule-plan-editor"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="输入这个时段的计划"
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onFocus={onSelect}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
    />
  );
}

export function ChildApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [dash, setDash] = useState<any>({ tasks: [], rewards: [], achievements: [], balance: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "rewards" | "warehouse" | "schedule">("tasks");
  const [schedule, setSchedule] = useState<ChildScheduleData>({ slots: [], items: [] });
  const [activeScheduleSlotId, setActiveScheduleSlotId] = useState("");
  const [showScheduleOnWall, setShowScheduleOnWall] = useState(() => {
    try {
      return localStorage.getItem(`task-wall-schedule:${me.id}`) === "1";
    } catch {
      return false;
    }
  });
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseItem[]>([]);
  const [warehouseAchievements, setWarehouseAchievements] = useState<any[]>([]);
  const [warehouseTab, setWarehouseTab] = useState<"rewards" | "achievements">("rewards");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [achievementTipId, setAchievementTipId] = useState("");
  const [tick, setTick] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const loadDashLockRef = useRef(false);
  const dailyReviewEntryRef = useRef(true);
  const pollingRef = useRef<number | null>(null);

  async function loadWarehouse() {
    setWarehouse(await api<WarehouseItem[]>("/warehouse").catch(() => []));
    setWarehouseAchievements(await api<any[]>("/warehouse/achievements").catch(() => []));
  }

  async function togglePin(kind: "task" | "reward", item: any) {
    const itemId = item.isPinned ? null : item.id;
    await run(
      `pin:${kind}:${item.id}`,
      () => api(`/child-pins/${kind}`, { method: "PATCH", body: JSON.stringify({ itemId }) }),
      itemId ? "已置顶" : "已取消置顶"
    );
  }

  function pinButton(kind: "task" | "reward", item: any) {
    const busyId = busy === `pin:${kind}:${item.id}`;
    return (
      <button
        type="button"
        className={`icon pin-action ${item.isPinned ? "is-pinned" : ""}`}
        title={item.isPinned ? "取消置顶" : "置顶"}
        disabled={busyId}
        onClick={() => void togglePin(kind, item)}
      >
        <Pin size={18} />
      </button>
    );
  }

  function rewardProgress(reward: any) {
    const cost = Number(reward.cost_points || 0);
    const current = Number(dash.balance || 0);
    const complete = cost <= 0 || current >= cost;
    const percent = cost <= 0 ? 100 : Math.min(100, Math.max(0, (current / cost) * 100));
    return (
      <div className={`reward-progress ${complete ? "is-complete" : ""}`}>
        <div>
          <span>兑换进度</span>
          <strong>{current}/{cost} 积分</strong>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  function renderTaskCard(task: any, pinned = false) {
    const now = Date.now();
    const deadlineAt = task.deadlineAt ? Date.parse(task.deadlineAt) : NaN;
    const resetAt = task.resetAt ? Date.parse(task.resetAt) : NaN;
    const deadlineActive = Number.isFinite(deadlineAt) && (!Number.isFinite(resetAt) || now < resetAt);
    const deadlineLocked = !task.submissionDeadlineExempted && (deadlineActive && deadlineAt <= now || task.submitLockReason === "deadline" && (!Number.isFinite(resetAt) || now < resetAt));
    const limited = deadlineLocked || task.submitLockReason !== "deadline" && !task.canSubmit;
    const busyId = busy === "task:" + task.id;
    const points = (task.point_type === "earn" ? "+" : "-") + task.points;
    const isRequired = task.is_required === 1;
    return (
      <article className={["task-card", "wall-card", pinned ? "pinned-card" : "", limited ? "is-muted" : "", isRequired ? "required-card" : ""].filter(Boolean).join(" ")} key={task.id}>
        <div className="card-head wall-card-head with-pin">
          {icon(task.icon_type, task.icon_value, task.title)}
          <div>
            <strong>{task.title}</strong>
            <small>{formatPeriod(task.period)}</small>
          </div>
          {pinButton("task", task)}
        </div>
        {task.description && <small className="card-description">{task.description}</small>}
        <div className="card-meta">
          <span className={task.point_type === "earn" ? "positive" : "negative"}>{points} 积分</span>
          <span>{task.usedCount}/{task.limitCount} 次</span>
          {task.taskSetTitle && <span className="required-tag">任务集：{task.taskSetTitle}</span>}
          {isRequired && <span className="required-tag">须完成{task.required_count || 1}次</span>}
          {task.requiredPenaltyExempted && <span className="exempted-tag">已豁免</span>}
          {task.submissionDeadlineExempted && <span className="exempted-tag">截止已解除</span>}
          <span>{task.periodKey}</span>
          {deadlineActive && <span>截止：{task.localDeadlineAt || formatTime(task.deadlineAt)}</span>}
          {deadlineActive && <span className={deadlineLocked ? "negative" : ""}>{task.submissionDeadlineExempted ? "本周期截止已解除" : deadlineLocked ? "已截止" : `剩余：${formatCountdown(deadlineAt - now, true)}`}</span>}
        </div>
        <button disabled={limited || busyId} className="primary card-action" onClick={() => submitTask(task)}>
          {busyId ? "提交中..." : limited ? deadlineLocked ? formatReset(task.resetAt, "距提交解锁", "已截止") : formatReset(task.resetAt) : "提交完成"}
        </button>
      </article>
    );
  }

  function renderRewardCard(reward: any, pinned = false) {
    const limited = !reward.canRedeem;
    const disabled = dash.balance < reward.cost_points || limited || busy === "reward:" + reward.id;
    return (
      <article className={["mini-card", "wall-card", "reward-wall-card", pinned ? "pinned-card" : "", disabled ? "is-muted" : ""].filter(Boolean).join(" ")} key={reward.id}>
        <div className="card-head wall-card-head with-pin">
          {icon(reward.icon_type, reward.icon_value, reward.title)}
          <div>
            <strong>{rewardDisplayTitle(reward)}</strong>
            <small>{formatPeriod(reward.limit_period)}</small>
          </div>
          {pinButton("reward", reward)}
        </div>
        {reward.description && <small className="card-description">{reward.description}</small>}
        <div className="card-meta">
          <span className="cost"><Coins size={16} />{reward.cost_points} 积分</span>
          {reward.limitCount !== null && <span>{reward.usedCount}/{reward.limitCount} 次</span>}
        </div>
        {pinned && rewardProgress(reward)}
        <button className="secondary card-action" disabled={disabled} onClick={() => redeem(reward)}>
          {busy === "reward:" + reward.id ? "兑换中..." : limited ? formatReset(reward.resetAt) : dash.balance < reward.cost_points ? "积分不足" : "兑换"}
        </button>
      </article>
    );
  }

  const taskRows = dash.tasks || [];
  const taskSets = dash.taskSets || [];
  const rewardRows = dash.rewards || [];
  const pinnedTask = taskRows.find((task: any) => task.isPinned);
  const pinnedReward = rewardRows.find((reward: any) => reward.isPinned);
  const pinnedCount = Number(Boolean(pinnedTask)) + Number(Boolean(pinnedReward));
  const remedyCriticisms = dash.remedyCriticisms || [];
  const remedyItems = [...remedyCriticisms, ...(dash.requiredPenaltyRemedies || [])];
  const activeTasks = taskRows.filter((task: any) => task.is_active !== 0);
  const sortedTasks = [...taskRows].sort((a: any, b: any) => (b.is_required || 0) - (a.is_required || 0));
  const groupedTaskIds = new Set(taskSets.flatMap((set: any) => set.taskIds || []));
  const taskById = new Map(taskRows.map((task: any) => [task.id, task]));
  const scheduledTaskIds = new Set(schedule.items.map((item) => item.taskId));
  const availableScheduleTasks = activeTasks.filter((task: any) => scheduledCountForTask(task.id) < getTaskScheduleLimit(task.id));
  const selectedScheduleSlot = schedule.slots.find((slot) => slot.id === activeScheduleSlotId);

  function formatCountdown(ms: number, clock = false) {
    const total = Math.max(0, Math.floor(ms / 1000));
    if (!clock) {
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (hours > 0) return `${hours}小时${String(minutes).padStart(2, "0")}分`;
      return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
    }
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total % 86400 / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return days ? `${days}天 ${time}` : time;
  }

  async function loadDashboard() {
    if (loadDashLockRef.current) return;
    loadDashLockRef.current = true;
    try {
      const dailyReviewEntry = dailyReviewEntryRef.current;
      const dashData = await api<any>(`/dashboard/child${dailyReviewEntry ? "?dailyReviewEntry=1" : ""}`);
      setDash(dashData);
      if (dailyReviewEntry) dailyReviewEntryRef.current = false;
    } catch (err) {
      setError("加载数据失败，可点击重试");
    } finally {
      setDashboardLoading(false);
      loadDashLockRef.current = false;
    }
  }

  async function loadSchedule() {
    const raw = await api<any>("/child-schedule").catch(() => ({ slots: [], items: [] }));
    const slots: ChildScheduleData["slots"] = (raw.slots || []).map((s: any) => ({
      id: s.id,
      title: s.title ?? "",
      planHtml: s.plan_html ?? s.planHtml ?? "",
      startMinutes: s.start_minutes ?? s.startMinutes ?? 0,
      endMinutes: s.end_minutes ?? s.endMinutes ?? 0,
      sort_order: s.sort_order,
    }));
    const items: ChildScheduleData["items"] = (raw.items || []).map((it: any) => ({
      id: it.id,
      slotId: it.slot_id ?? it.slotId,
      taskId: it.task_id ?? it.taskId,
      title: it.title,
      points: it.points,
      period: it.period,
      category_name: it.category_name,
      is_required: it.is_required,
      required_count: it.required_count,
      description: it.description,
      requiredPenaltyExempted: it.requiredPenaltyExempted,
    }));
    setSchedule({ slots, items });
  }

  async function saveSchedule() {
    const newSlots = schedule.slots.map((s) => ({ id: s.id, title: s.title, planHtml: s.planHtml || "", startMinutes: s.startMinutes, endMinutes: s.endMinutes }));
    const newItems = schedule.items.map((item) => ({
      id: item.id,
      slotId: item.slotId,
      taskId: item.taskId
    }));
    await run("schedule:save", () => api("/child-schedule", { method: "PUT", body: JSON.stringify({ slots: newSlots, items: newItems }) }), "日程已保存");
    await loadSchedule();
  }

  function addScheduleSlot() {
    const slots = [...schedule.slots];
    const last = slots.length > 0 ? slots[slots.length - 1] : null;
    const start = last ? Math.min(last.endMinutes + 30, 1380) : 480;
    const end = Math.min(start + 60, 1440);
    slots.push({ id: crypto.randomUUID(), title: "", planHtml: "", startMinutes: start, endMinutes: end });
    setSchedule({ ...schedule, slots });
  }

  function updateScheduleSlot(index: number, field: string, value: any) {
    const slots = [...schedule.slots];
    (slots[index] as any)[field] = value;
    setSchedule({ ...schedule, slots });
  }

  function removeScheduleSlot(index: number) {
    const slot = schedule.slots[index];
    const slots = schedule.slots.filter((_, i) => i !== index);
    const items = schedule.items.filter((item) => item.slotId !== slot.id);
    setSchedule({ ...schedule, slots, items });
  }

  function getTaskScheduleLimit(taskId: string): number {
    const task = taskById.get(taskId) as any;
    return Math.max(1, Number(task?.limitCount || task?.limit_count || 1));
  }

  function scheduledCountForTask(taskId: string): number {
    return schedule.items.filter((item) => item.taskId === taskId).length;
  }

  function selectScheduleSlot(slotId: string) {
    setActiveScheduleSlotId(slotId);
  }

  function toggleTaskInSlot(taskId: string, slotId: string) {
    const items = [...schedule.items];
    const existingInSlotIdx = items.findIndex((item) => item.taskId === taskId && item.slotId === slotId);
    const maxCount = getTaskScheduleLimit(taskId);

    if (existingInSlotIdx >= 0) {
      items.splice(existingInSlotIdx, 1);
    } else if (scheduledCountForTask(taskId) < maxCount) {
      const task = taskById.get(taskId) as any;
      items.push({ id: crypto.randomUUID(), slotId, taskId, title: task?.title });
    } else {
      return;
    }
    setSchedule({ ...schedule, items });
    selectScheduleSlot(slotId);
  }

  function addTaskToSelectedSlot(taskId: string) {
    const slotId = activeScheduleSlotId || schedule.slots[0]?.id || "";
    if (!slotId) return;
    toggleTaskInSlot(taskId, slotId);
  }

  function removeTaskFromSchedule(itemId: string) {
    setSchedule({ ...schedule, items: schedule.items.filter((item) => item.id !== itemId) });
  }

  function handleDragStart(e: DragEvent, taskId: string) {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleSlotDrop(e: DragEvent, slotId: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (taskId) toggleTaskInSlot(taskId, slotId);
    e.currentTarget.classList.remove("drag-over");
  }

  function handleSlotDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.classList.add("drag-over");
  }

  function handleSlotDragLeave(e: DragEvent) {
    e.currentTarget.classList.remove("drag-over");
  }

  function updateSchedulePlan(index: number, html: string) {
    const slots = [...schedule.slots];
    slots[index] = { ...slots[index], planHtml: html };
    setSchedule({ ...schedule, slots });
  }

  function formatSchedulePlan(command: "bold" | "italic" | "underline" | "insertUnorderedList") {
    document.execCommand(command);
  }

  function renderScheduleTaskCard(item: ChildScheduleData["items"][number]) {
    const task = taskById.get(item.taskId) as any;
    const title = task?.title || item.title || "加载中...";
    const points = task ? (task.point_type === "earn" ? "+" : "-") + task.points : item.points;
    return (
      <article className={["task-card", "wall-card", "schedule-slot-task-card", task?.is_required === 1 ? "required-card" : ""].filter(Boolean).join(" " )} key={item.id}>
        <div className="card-head wall-card-head">
          {task ? icon(task.icon_type, task.icon_value, title) : null}
          <div>
            <strong>{title}</strong>
            <small>{formatPeriod(task?.period || item.period || "daily")}</small>
          </div>
          <button className="icon" onClick={(e) => { e.stopPropagation(); if (item.id) removeTaskFromSchedule(item.id); }} title="移除">&times;</button>
        </div>
        {task?.description || item.description ? <small className="card-description">{task?.description || item.description}</small> : null}
        <div className="card-meta">
          {points !== undefined && <span className={task?.point_type === "spend" ? "negative" : "positive"}>{points} 积分</span>}
          {task && <span>{scheduledCountForTask(task.id)}/{getTaskScheduleLimit(task.id)} 次</span>}
          {(task?.is_required === 1 || item.is_required) && <span className="required-tag">须完成{task?.required_count || item.required_count || 1}次</span>}
          {(task?.requiredPenaltyExempted || item.requiredPenaltyExempted) && <span className="exempted-tag">已豁免</span>}
        </div>
      </article>
    );
  }

  function fmtMinutes(m: number) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  function hasSchedulePlan(html: string | undefined) {
    return Boolean((html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim());
  }

  async function load() {
    await Promise.all([loadDashboard(), loadSchedule()]);
  }
  useEffect(() => {
    void loadDashboard();
    void loadSchedule();
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
    if (activeTab === "warehouse") void loadWarehouse();
  }, [activeTab]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(`task-wall-schedule:${me.id}`, showScheduleOnWall ? "1" : "0");
    } catch {
      // Ignore private browsing or storage quota failures; the toggle still works for this session.
    }
  }, [me.id, showScheduleOnWall]);
  useEffect(() => {
    if (!schedule.slots.length) {
      if (activeScheduleSlotId) setActiveScheduleSlotId("");
      return;
    }
    if (!activeScheduleSlotId || !schedule.slots.some((slot) => slot.id === activeScheduleSlotId)) {
      setActiveScheduleSlotId(schedule.slots[0].id || "");
    }
  }, [schedule.slots, activeScheduleSlotId]);
  useEffect(() => {
    if (remedyItems.some((item: any) => item.remedyDeadlineAt && Date.parse(item.remedyDeadlineAt) - Date.now() <= 0)) void loadDashboard();
  }, [tick, remedyItems.map((item: any) => `${item.id}:${item.remedyDeadlineAt}`).join("|")]);
  useEffect(() => {
    if (ledgerOpen) void api<LedgerResponse>("/points/ledger").then((data) => setLedger(data.items)).catch(() => setLedger([]));
  }, [dash, ledgerOpen]);

  async function openLedger() {
    const data = await api<LedgerResponse>("/points/ledger").catch(() => ({ items: [], timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00" }));
    setLedger(data.items);
    setLedgerOpen(true);
  }

  async function run(id: string, action: () => Promise<void>, note: string) {
    setBusy(id);
    setError("");
    try {
      await action();
      setMessage(note);
      await load();
      window.dispatchEvent(new CustomEvent("app:refresh-notifications"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  async function setAchievementHidden(item: any, hidden: boolean) {
    await run(`achievement:${item.id}`, () => api(`/child-achievements/${item.id}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden }) }), hidden ? "称号已隐藏" : "称号已展示");
    await loadWarehouse();
  }
  async function submitTask(task: any) {
    if (!window.confirm(`确认提交任务“${task.title}”？`)) return;
    await run(`task:${task.id}`, () => api("/task-submissions", { method: "POST", body: JSON.stringify({ taskId: task.id }) }), "任务已提交，等待家长审核");
  }

  async function redeem(reward: any) {
    if (!window.confirm(`确认兑换“${reward.title}”？将扣除 ${reward.cost_points} 积分。`)) return;
    await run(`reward:${reward.id}`, () => api("/reward-redemptions", { method: "POST", body: JSON.stringify({ rewardId: reward.id }) }), "奖励已兑换，等待家长核销");
  }

  async function clearRedeemedWarehouse() {
    if (!window.confirm("确认清理仓库内已核销奖励的显示？历史记录和积分不会删除。")) return;
    await run("warehouse:clear", () => api("/warehouse/clear-redeemed", { method: "PATCH", body: JSON.stringify({}) }), "已清理已核销奖励");
    await loadWarehouse();
  }

  const dailyReview = dash.dailyReview as DailyReview | null | undefined;
  const dailyReviewReady = !!dailyReview && Date.parse(dailyReview.acknowledgeAvailableAt) <= Date.now();
  const dailyReviewRemaining = dailyReview ? Math.max(0, Date.parse(dailyReview.acknowledgeAvailableAt) - Date.now()) : 0;
  const dailyReviewPraise = dailyReview?.praiseItems || [];
  const dailyReviewDeductions = (dailyReview?.items || []).filter((item) => Number(item.amount) < 0 && ["criticism", "task_required_penalty"].includes(item.source_type));
  const dailyReviewOther = (dailyReview?.items || []).filter((item) => item.source_type !== "praise" && !dailyReviewDeductions.includes(item));

  async function acknowledgeDailyReview() {
    if (!dailyReview) return;
    setBusy("daily-review:acknowledge");
    setError("");
    try {
      await api("/child-daily-review/acknowledge", { method: "PATCH", body: JSON.stringify({ reviewDate: dailyReview.reviewDate }) });
      setDash((current: any) => ({ ...current, dailyReview: null }));
      setMessage("昨日表现已签收，消息中心已同步更新");
      window.dispatchEvent(new CustomEvent("app:refresh-notifications"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "签收失败，请重试");
    } finally {
      setBusy("");
    }
  }

  if (dashboardLoading) return <div className="loading">加载中...</div>;

  return (
    <Shell
      me={me}
      refresh={refresh}
      onQuickAction={() => void loadDashboard()}
      navigation={[
        { value: "tasks", label: "今日", icon: <ClipboardCheck /> },
        { value: "rewards", label: "奖励", icon: <Gift /> },
        { value: "warehouse", label: "仓库", icon: <Package /> },
        { value: "schedule", label: "日程", icon: <Calendar /> }
      ]}
      activeNavigation={activeTab}
      onNavigate={(value) => setActiveTab(value as typeof activeTab)}
    >
      <section className="hero-band child">
        <div>
          <p>孩子面板</p>
          <h1>{me.displayName}</h1>
        </div>
        {dash.aiGreeting
          ? <p className="ai-greeting">{dash.aiGreeting}{dash.aiRefreshPending ? " · 等待定时更新" : ""}</p>
          : dash.aiRefreshPending ? <p className="ai-greeting muted">AI 寄语等待定时生成</p> : null
        }
        <button className="metric large clickable" onClick={() => void openLedger()}>
          <Star />
          <strong>{dash.balance}</strong>
          <span>积分</span>
          {(dash.frozenPoints || 0) > 0 && <span className="frozen-tag">{dash.frozenPoints}积分冻结中</span>}
        </button>
      </section>
      <FeedbackToast message={message} error={error} onDismiss={() => { setMessage(""); setError(""); }} />
      {error && <div className="actions" style={{ justifyContent: "center", marginBottom: "0.5rem" }}><button className="secondary" onClick={() => void load()}>重试</button></div>}
      <section className="panel">
        <div className="panel-title"><Award /><h2>成就墙</h2></div>
        <div className="cards scroll-list">
          {dash.achievements.length ? dash.achievements.map((item: any) => (
            <article className="achievement achievement-title-only" key={item.id}>
              <button type="button" className="achievement-trigger" onClick={() => setAchievementTipId((current) => current === item.id ? "" : item.id)}>
              {icon(item.icon_type, item.icon_value, item.title)}
              <strong>{item.title}</strong>
              </button>
              <button type="button" className="icon" title="隐藏称号" disabled={busy === `achievement:${item.id}`} onClick={() => void setAchievementHidden(item, true)}><EyeOff size={16} /></button>
              {achievementTipId === item.id && <span className="achievement-tooltip">{item.description || "已解锁"}</span>}
            </article>
          )) : <Empty text="完成任务后会解锁称号" />}
        </div>
      </section>
      {pinnedCount > 0 && (
        <section className={`pinned-strip ${pinnedCount === 1 ? "is-single" : "is-pair"}`} aria-label="置顶任务和奖励">
          {pinnedTask && (
            <div className="pinned-slot">
              <div className="pinned-slot-title"><ClipboardCheck size={18} /><span>置顶任务</span></div>
              {renderTaskCard(pinnedTask, true)}
            </div>
          )}
          {pinnedReward && (
            <div className="pinned-slot">
              <div className="pinned-slot-title"><Gift size={18} /><span>置顶奖励</span></div>
              {renderRewardCard(pinnedReward, true)}
            </div>
          )}
        </section>
      )}
      {remedyItems.length > 0 && (
        <section className="panel remedy-panel" aria-label="待补救">
          <div className="panel-title"><AlertTriangle /><h2>待补救</h2></div>
          <div className="list">
            {remedyItems.map((item: any) => {
              const deadlineMs = item.remedyDeadlineAt ? Date.parse(item.remedyDeadlineAt) - Date.now() : Number(item.remainingMs || 0);
              return (
                <article className="row remedy-card" key={item.id}>
                  <div>
                    <strong>{item.sourceType === "task_required_penalty" ? "必做扣分 · " : ""}{item.title}</strong>
                    <span>{item.remedyCondition || "请按家长要求完成补救"} · 预扣冻结 {item.frozenAmount || 0} 积分 · 可挽回 {item.remedyPoints || 0} 积分</span>
                    <small>截止：{item.localRemedyDeadlineAt || formatTime(item.remedyDeadlineAt)}</small>
                  </div>
                  <span className="negative">{formatCountdown(deadlineMs)}</span>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {activeTab === "tasks" && (
        <div className="grid">
          <section className="panel child-panel">
            <div className="panel-title task-wall-title">
              <ClipboardCheck /><h2>任务墙</h2>
              <label className="toggle schedule-wall-toggle">
                <input type="checkbox" checked={showScheduleOnWall} onChange={(e) => setShowScheduleOnWall(e.target.checked)} />
                <span>日程表显示</span>
              </label>
            </div>
            {!showScheduleOnWall ? (
              <div className="child-tab-list stack">
                {taskSets.map((set: any) => {
                  const members = sortedTasks.filter((task: any) => task.taskSetId === set.id);
                  if (!members.length) return null;
                  const progress = set.progress || {};
                  const windowMode = set.settlementMode === "window" || set.settlement_mode === "window";
                  return <section className="panel task-set-wall" key={set.id}>
                    <div className="panel-title">{icon(set.icon_type, set.icon_value, set.title)}<div><h2>{set.title}</h2><small>{windowMode ? `${set.windowType === "weekly" ? "本周" : set.windowType === "monthly" ? "本月" : `${set.windowStart || set.window_start} 至 ${set.windowEnd || set.window_end}`} · 已达成 ${progress.completed || 0}/${progress.total || 0} 个周期 · ${progress.status || "active"}${progress.nextResetAt ? ` · 下次重置 ${String(progress.nextResetAt).slice(0, 10)}` : ""}${progress.awaitingDecisionCount ? ` · 上期待处理 ${progress.awaitingDecisionCount}` : ""}` : `下一轮已通过 ${progress.approved || 0}/${progress.total || members.length} · 已结算 ${progress.settledRounds || 0} 轮`} · {set.minPoints}{set.maxPoints !== set.minPoints ? `-${set.maxPoints}` : ""} 积分</small></div></div>
                    {set.description && <p className="card-description">{set.description}</p>}
                    <div className="wall-grid">{members.map((task: any) => renderTaskCard(task))}</div>
                  </section>;
                })}
                {sortedTasks.filter((task: any) => !groupedTaskIds.has(task.id)).length ? <section className="wall-grid">{sortedTasks.filter((task: any) => !groupedTaskIds.has(task.id)).map((task: any) => renderTaskCard(task))}</section> : null}
                {!sortedTasks.length && <Empty text="暂无任务" />}
              </div>
            ) : (
              <div className="schedule-wall-groups child-tab-list">
                {schedule.slots.length === 0 && <Empty text="暂无日程安排，请先到日程表设置中添加时段" />}
                {schedule.slots.map((slot) => {
                  if (!slot.id) return null;
                  const showPlan = hasSchedulePlan(slot.planHtml);
                  const tasksInSlot = schedule.items
                    .filter((item) => item.slotId === slot.id)
                    .map((item) => taskById.get(item.taskId))
                    .filter(Boolean);
                  return (
                    <section className="schedule-wall-group" key={slot.id}>
                      <div className="schedule-wall-group-title">
                        <strong>{slot.title || "未命名时段"}</strong>
                        <span>{fmtMinutes(slot.startMinutes)} - {fmtMinutes(slot.endMinutes)}</span>
                      </div>
                      {showPlan && (
                        <div className="schedule-wall-plan">
                          <span>计划</span>
                          <div dangerouslySetInnerHTML={{ __html: slot.planHtml || "" }} />
                        </div>
                      )}
                      {tasksInSlot.length ? (
                        <div className="wall-grid schedule-wall-grid">
                          {tasksInSlot.map((task: any) => renderTaskCard(task))}
                        </div>
                      ) : <Empty text="这个时段暂无任务" />}
                    </section>
                  );
                })}
                {(() => {
                  const unscheduledTasks = sortedTasks.filter((task: any) => !scheduledTaskIds.has(task.id));
                  if (!unscheduledTasks.length) return null;
                  return (
                    <section className="schedule-wall-group">
                      <div className="schedule-wall-group-title"><strong>未安排任务</strong><span>{unscheduledTasks.length} 项</span></div>
                      <div className="wall-grid schedule-wall-grid">
                        {unscheduledTasks.map((task: any) => renderTaskCard(task))}
                      </div>
                    </section>
                  );
                })()}
              </div>
            )}
          </section>
        </div>
      )}
      {activeTab === "rewards" && (
        <section className="panel child-panel">
          <div className="panel-title"><Gift /><h2>奖励墙</h2></div>
          <div className="wall-grid child-tab-list">
            {rewardRows.length ? rewardRows.map((reward: any) => {
              const limited = !reward.canRedeem;
              const disabled = dash.balance < reward.cost_points || limited || busy === `reward:${reward.id}`;
              return (
                <article className={`mini-card wall-card reward-wall-card ${disabled ? "is-muted" : ""}`} key={reward.id}>
                  <div className="card-head wall-card-head with-pin">
                    {icon(reward.icon_type, reward.icon_value, reward.title)}
                    <div>
                      <strong>{rewardDisplayTitle(reward)}</strong>
                      <small>{formatPeriod(reward.limit_period)}</small>
                    </div>
                    {pinButton("reward", reward)}
                  </div>
                  {reward.description && <small className="card-description">{reward.description}</small>}
                  <div className="card-meta">
                    <span className="cost"><Coins size={16} />{reward.cost_points} 积分</span>
                    {reward.limitCount !== null && <span>{reward.usedCount}/{reward.limitCount} 次</span>}
                  </div>
                  <button className="secondary card-action" disabled={disabled} onClick={() => redeem(reward)}>
                    {busy === `reward:${reward.id}` ? "兑换中..." : limited ? formatReset(reward.resetAt) : dash.balance < reward.cost_points ? "积分不足" : "兑换"}
                  </button>
                </article>
              );
            }) : <Empty text="暂无可兑换奖励" />}
          </div>
        </section>
      )}
      {activeTab === "warehouse" && (
        <section className="panel child-panel">
          <div className="panel-title compact-title">
            <Package /><h2>仓库</h2>
            {warehouseTab === "rewards" && <button className="secondary" disabled={!warehouse.some((item) => item.status === "redeemed")} onClick={() => void clearRedeemedWarehouse()}>一键清理已核销奖励</button>}
          </div>
          <Tabs value={warehouseTab} onChange={(value) => setWarehouseTab(value as "rewards" | "achievements")} options={[{ value: "rewards", label: "奖励" }, { value: "achievements", label: "成就" }]} />
          {warehouseTab === "rewards" ? (
            <div className="wall-grid warehouse-grid child-tab-list">
              {warehouse.length ? warehouse.map((item) => (
                <article className={`mini-card wall-card reward-wall-card warehouse-card ${item.status === "redeemed" ? "is-muted redeemed" : ""}`} key={item.id}>
                  <div className="card-head wall-card-head">
                    {icon(item.icon_type, item.icon_value, item.title)}
                    <div>
                      <strong>{rewardDisplayTitle(item)}</strong>
                      <small>{item.status === "redeemed" && item.redeemed_at ? `${new Date(item.redeemed_at).toLocaleDateString("zh-CN")}已核销` : "待家长核销"}</small>
                    </div>
                  </div>
                  {item.description && <small className="card-description">{item.description}</small>}
                  <div className="card-meta"><span className="cost"><Coins size={16} />{item.cost_points} 积分</span></div>
                </article>
              )) : <Empty text="仓库暂无奖励" />}
            </div>
          ) : (
            <div className="wall-grid warehouse-grid child-tab-list">
              {warehouseAchievements.length ? warehouseAchievements.map((item) => (
                <article className="mini-card wall-card warehouse-card" key={item.id}>
                  <div className="card-head wall-card-head">
                    {icon(item.icon_type, item.icon_value, item.title)}
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.description || "已隐藏"}</small>
                    </div>
                  </div>
                  <button className="secondary card-action" disabled={busy === `achievement:${item.id}`} onClick={() => void setAchievementHidden(item, false)}><Eye size={16} />展示</button>
                </article>
              )) : <Empty text="仓库暂无隐藏成就" />}
            </div>
          )}
        </section>
      )}      {activeTab === "schedule" && (
        <section className="panel child-panel">
          <div className="panel-title compact-title">
            <Calendar /><h2>我的日程表设置</h2>
            <div className="actions" style={{ gap: "0.5rem" }}>
              <button className="secondary" onClick={addScheduleSlot}>添加时段</button>
              <button className="primary" disabled={busy === "schedule:save"} onClick={() => void saveSchedule()}>{busy === "schedule:save" ? "保存中..." : "保存日程"}</button>
            </div>
          </div>
          <div className="schedule-layout">
            <div className="schedule-slots">
              {schedule.slots.length === 0 && <Empty text="暂无时段，请添加" />}
              {schedule.slots.map((slot, index) => {
                if (!slot.id) return null;
                const slotId = slot.id;
                const slotItems = schedule.items.filter((item) => item.slotId === slotId);
                return (
                  <article className={`schedule-slot-card ${activeScheduleSlotId === slotId ? "is-active" : ""}`} key={slotId} onClick={() => selectScheduleSlot(slotId)}>
                    <div className="schedule-slot-header">
                      <input className="schedule-slot-title-input" placeholder="时段名称" value={slot.title} onChange={(e) => updateScheduleSlot(index, "title", e.target.value)} onFocus={() => selectScheduleSlot(slotId)} />
                      <div className="schedule-time-inputs">
                        <input type="time" value={fmtMinutes(slot.startMinutes)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); updateScheduleSlot(index, "startMinutes", h * 60 + m); }} onFocus={() => selectScheduleSlot(slotId)} />
                        <span>至</span>
                        <input type="time" value={fmtMinutes(slot.endMinutes)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); updateScheduleSlot(index, "endMinutes", h * 60 + m); }} onFocus={() => selectScheduleSlot(slotId)} />
                      </div>
                      <button className="icon" style={{ color: "var(--danger, #e53e3e)" }} onClick={(e) => { e.stopPropagation(); removeScheduleSlot(index); }} title="删除时段">&times;</button>
                    </div>
                    <div className="schedule-slot-section">
                      <div className="schedule-slot-section-title">计划</div>
                      <div className="schedule-rich-toolbar" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="icon" title="加粗" onMouseDown={(e) => { e.preventDefault(); formatSchedulePlan("bold"); }}><Bold size={15} /></button>
                        <button type="button" className="icon" title="斜体" onMouseDown={(e) => { e.preventDefault(); formatSchedulePlan("italic"); }}><Italic size={15} /></button>
                        <button type="button" className="icon" title="下划线" onMouseDown={(e) => { e.preventDefault(); formatSchedulePlan("underline"); }}><Underline size={15} /></button>
                        <button type="button" className="icon" title="列表" onMouseDown={(e) => { e.preventDefault(); formatSchedulePlan("insertUnorderedList"); }}><List size={15} /></button>
                      </div>
                      <SchedulePlanEditor
                        html={slot.planHtml}
                        onSelect={() => selectScheduleSlot(slotId)}
                        onChange={(html) => updateSchedulePlan(index, html)}
                      />
                    </div>
                    <div className="schedule-slot-section">
                      <div className="schedule-slot-section-title">可完成任务</div>
                      <div
                        className="schedule-slot-items"
                        onDragOver={handleSlotDragOver}
                        onDragLeave={handleSlotDragLeave}
                        onDrop={(e) => handleSlotDrop(e, slotId)}
                      >
                        {slotItems.length === 0 && <small className="muted">拖拽或点击任务到此处</small>}
                        {slotItems.map((item) => renderScheduleTaskCard(item))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <aside className="schedule-shared-pool" aria-label="任务卡片池">
              <div className="schedule-pool-title">
                <strong>任务卡片池</strong>
                <span>{selectedScheduleSlot ? `当前：${selectedScheduleSlot.title || "未命名时段"}` : "请先选择时段"}</span>
              </div>
              <div className="schedule-slot-tasks-pool">
                {availableScheduleTasks.length ? availableScheduleTasks.map((task: any) => {
                  const used = scheduledCountForTask(task.id);
                  const maxCount = getTaskScheduleLimit(task.id);
                  return (
                    <div
                      key={task.id}
                      className="schedule-task-chip"
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => addTaskToSelectedSlot(task.id)}
                      title={`${task.title}（已安排 ${used}/${maxCount} 次）`}
                    >
                      {icon(task.icon_type, task.icon_value, task.title)}
                      <div className="schedule-chip-info">
                        <span className="schedule-chip-title">{task.title}</span>
                        <span className="schedule-chip-meta">
                          <span className={task.point_type === "earn" ? "positive" : "negative"}>
                            {task.point_type === "earn" ? "+" : "-"}{task.points}
                          </span>
                          {maxCount > 1 && <span className="chip-count-badge">{used}/{maxCount}</span>}
                        </span>
                      </div>
                    </div>
                  );
                }) : <Empty text="本周期可安排次数已用完" />}
              </div>
            </aside>
          </div>
        </section>
      )}
      {ledgerOpen && <LedgerModal title="我的积分清单" rows={ledger} onClose={() => setLedgerOpen(false)} />}
      {dailyReview && (
        <div className="modal-backdrop daily-review-backdrop" role="dialog" aria-modal="true" aria-label="昨日表现回顾">
          <section className="panel daily-review-modal">
            <div className="panel-title daily-review-title"><Star /><div><h2>昨日表现回顾</h2><small>{dailyReview.reviewDate} · {dailyReview.timezoneLabel}</small></div></div>
            <div className="daily-review-totals">
              <span><small>净变化</small><strong className={dailyReview.totals.net >= 0 ? "positive" : "negative"}>{dailyReview.totals.net >= 0 ? "+" : ""}{dailyReview.totals.net}</strong></span>
              <span><small>获得</small><strong className="positive">+{dailyReview.totals.gained}</strong></span>
              <span><small>扣除/支出</small><strong className="negative">-{dailyReview.totals.deducted}</strong></span>
              <span><small>冻结</small><strong>{dailyReview.totals.frozen}</strong></span>
            </div>
            {!dailyReview.items.length && !dailyReview.notificationCount ? <p className="daily-review-empty">昨日无积分变化和消息。</p> : (
              <div className="daily-review-list">
                {dailyReviewDeductions.length > 0 && <section><h3 className="daily-review-deduction-title">昨日扣分 · {dailyReviewDeductions.length} 项</h3>{dailyReviewDeductions.map((item) => <article className="daily-review-row deduction" key={item.id}><div><strong>{item.sourceLabel || item.note || item.sourceTypeLabel || "扣分"}</strong><small>{item.localCreatedAt || item.created_at}</small></div><span className="negative">{item.amount}</span></article>)}</section>}
                {dailyReviewPraise.length > 0 && <section><h3>表扬奖励 · {dailyReview.totals.praiseCount} 条</h3>{dailyReviewPraise.map((item) => <article className="daily-review-row praise" key={item.id}><strong>{item.sourceLabel || item.note || "表扬"}</strong><span className="positive">+{item.amount}</span></article>)}</section>}
                {dailyReviewOther.length > 0 && <section><h3>积分变化</h3>{dailyReviewOther.map((item) => <article className="daily-review-row" key={item.id}><div><strong>{item.sourceLabel || item.note || item.sourceTypeLabel || "积分变化"}</strong><small>{item.localCreatedAt || item.created_at}</small></div><span className={Number(item.amount) >= 0 ? "positive" : "negative"}>{Number(item.amount) >= 0 ? "+" : ""}{item.amount}</span></article>)}</section>}
                {!dailyReview.items.length && dailyReview.notificationCount > 0 && <p className="daily-review-empty">昨日没有积分变化；签收后将同步确认 {dailyReview.notificationCount} 条消息。</p>}
              </div>
            )}
            {dailyReviewReady ? <button className="primary" disabled={busy === "daily-review:acknowledge"} onClick={() => void acknowledgeDailyReview()}>{busy === "daily-review:acknowledge" ? "签收中..." : "签收并进入系统"}</button> : <p className="daily-review-countdown">请认真看完，{formatCountdown(dailyReviewRemaining)} 后可签收</p>}
          </section>
        </div>
      )}
    </Shell>
  );
}
