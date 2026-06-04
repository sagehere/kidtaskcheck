import { useEffect, useRef, useState } from 'react';
import { Award, ClipboardCheck, Coins, Gift, Package, Pin, Star } from "lucide-react";
import { Me, LedgerRow, LedgerResponse, WarehouseItem, REFRESH_INTERVAL_MS, ChildDashboardSummary } from "./types/api";
import { api } from "./api/client";
import { Empty, FeedbackToast, Tabs, icon, formatPeriod, formatReset, formatTime, rewardDisplayTitle, formatSource } from "./components/UI";
import { Shell } from "./components/Shell";

function LedgerList({ rows }: { rows: LedgerRow[] }) {
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

function LedgerModal({ title, rows, onClose }: { title: string; rows: LedgerRow[]; onClose: () => void }) {
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

export function ChildApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [dash, setDash] = useState<any>({ tasks: [], rewards: [], achievements: [], balance: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "rewards" | "warehouse">("tasks");
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseItem[]>([]);
  const [summary, setSummary] = useState<ChildDashboardSummary>({ balance: 0, aiGreeting: "", aiRefreshPending: false, child: null });
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [, setTick] = useState(0);
  const loadSummaryLockRef = useRef(false);
  const loadDashLockRef = useRef(false);
  const pollingRef = useRef<number | null>(null);

  async function loadWarehouse() {
    setWarehouse(await api<WarehouseItem[]>("/warehouse").catch(() => []));
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
    const limited = !task.canSubmit;
    const busyId = busy === "task:" + task.id;
    const points = (task.point_type === "earn" ? "+" : "-") + task.points;
    return (
      <article className={["task-card", "wall-card", pinned ? "pinned-card" : "", limited ? "is-muted" : ""].filter(Boolean).join(" ")} key={task.id}>
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
          <span>{task.periodKey}</span>
        </div>
        <button disabled={limited || busyId} className="primary card-action" onClick={() => submitTask(task)}>
          {busyId ? "提交中..." : limited ? formatReset(task.resetAt) : "提交完成"}
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

  const pinnedTask = dash.tasks.find((task: any) => task.isPinned);
  const pinnedReward = dash.rewards.find((reward: any) => reward.isPinned);
  const pinnedCount = Number(Boolean(pinnedTask)) + Number(Boolean(pinnedReward));

  async function loadSummary() {
    if (loadSummaryLockRef.current) return;
    loadSummaryLockRef.current = true;
    try {
      const data = await api<ChildDashboardSummary>("/dashboard/child-summary").catch(() => ({ balance: 0, aiGreeting: "", aiRefreshPending: false, child: null }));
      setSummary(data);
      setDash((current: any) => ({
        ...current,
        balance: data.balance,
        aiGreeting: data.aiGreeting,
        aiRefreshPending: data.aiRefreshPending
      }));
    } finally {
      loadSummaryLockRef.current = false;
    }
  }

  async function loadDashboard() {
    if (loadDashLockRef.current) return;
    loadDashLockRef.current = true;
    let hasError = false;
    try {
      const dashData = await api<any>("/dashboard/child").catch(() => {
        hasError = true;
        return { tasks: [], rewards: [], achievements: [], notifications: [], timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00", balance: 0, warehouse_count: 0, greeting: "", child: null };
      });
      setDash(dashData);
      await loadWarehouse();
      if (hasError) setError("閮ㄥ垎鏁版嵁鍔犺浇澶辫触锛屽彲鐐瑰嚮閲嶈瘯");
    } catch (err) {
      setError("鍔犺浇鏁版嵁澶辫触锛屽彲鐐瑰嚮閲嶈瘯");
    } finally {
      loadDashLockRef.current = false;
    }
  }

  async function refreshAll() {
    await loadSummary();
    await loadDashboard();
  }

  async function load() {
    await refreshAll();
  }
  useEffect(() => {
    void loadSummary();
    void loadDashboard();
    pollingRef.current = window.setInterval(() => void refreshAll(), REFRESH_INTERVAL_MS);
    function onVisibility() {
      if (document.hidden) {
        if (pollingRef.current !== null) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      } else if (pollingRef.current === null) {
        void refreshAll();
        pollingRef.current = window.setInterval(() => void refreshAll(), REFRESH_INTERVAL_MS);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (pollingRef.current !== null) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);
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

  return (
    <Shell me={me} refresh={refresh} onQuickAction={() => void loadDashboard()}>
      <section className="hero-band child">
        <div>
          <p>孩子面板</p>
          <h1>{me.displayName}</h1>
        </div>
        {(summary.aiGreeting || dash.aiGreeting)
          ? <p className="ai-greeting">{summary.aiGreeting || dash.aiGreeting}{summary.aiRefreshPending || dash.aiRefreshPending ? " · 刷新中" : ""}</p>
          : (summary.aiRefreshPending || dash.aiRefreshPending) ? <p className="ai-greeting muted">AI 寄语生成中...</p> : null
        }
        <button className="metric large clickable" onClick={() => void openLedger()}>
          <Star />
          <strong>{summary.balance || dash.balance}</strong>
          <span>当前积分</span>
        </button>
      </section>
      <FeedbackToast message={message} error={error} onDismiss={() => { setMessage(""); setError(""); }} />
      {error && <div className="actions" style={{ justifyContent: "center", marginBottom: "0.5rem" }}><button className="secondary" onClick={() => void load()}>重试</button></div>}
      <section className="panel">
        <div className="panel-title"><Award /><h2>成就墙</h2></div>
        <div className="cards scroll-list">
          {dash.achievements.length ? dash.achievements.map((item: any) => (
            <article className="achievement" key={item.id}>
              {icon(item.icon_type, item.icon_value, item.title)}
              <strong>{item.title}</strong>
              <span>{item.description || "已解锁"}</span>
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
      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as typeof activeTab)}
        options={[
          { value: "tasks", label: "任务" },
          { value: "rewards", label: "奖励" },
          { value: "warehouse", label: "仓库" }
        ]}
      />
      {activeTab === "tasks" && (
        <div className="grid">
          <section className="panel child-panel">
            <div className="panel-title"><ClipboardCheck /><h2>任务墙</h2></div>
            <div className="wall-grid scroll-list">
              {dash.tasks.length ? dash.tasks.map((task: any) => {
                const limited = !task.canSubmit;
                const busyId = busy === `task:${task.id}`;
                const points = `${task.point_type === "earn" ? "+" : "-"}${task.points}`;
                return (
                  <article className={`task-card wall-card ${limited ? "is-muted" : ""}`} key={task.id}>
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
                      <span>{task.periodKey}</span>
                    </div>
                    <button disabled={limited || busyId} className="primary card-action" onClick={() => submitTask(task)}>
                      {busyId ? "提交中..." : limited ? formatReset(task.resetAt) : "提交完成"}
                    </button>
                  </article>
                );
              }) : <Empty text="暂无任务" />}
            </div>
          </section>
        </div>
      )}
      {activeTab === "rewards" && (
        <section className="panel child-panel">
          <div className="panel-title"><Gift /><h2>奖励墙</h2></div>
          <div className="wall-grid scroll-list">
            {dash.rewards.length ? dash.rewards.map((reward: any) => {
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
            <button className="secondary" disabled={!warehouse.some((item) => item.status === "redeemed")} onClick={() => void clearRedeemedWarehouse()}>一键清理已核销奖励</button>
          </div>
          <div className="wall-grid warehouse-grid scroll-list">
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
        </section>
      )}
      {ledgerOpen && <LedgerModal title="我的积分清单" rows={ledger} onClose={() => setLedgerOpen(false)} />}
    </Shell>
  );
}
