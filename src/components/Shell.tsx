import { ReactNode, useEffect, useRef, useState } from "react";
import { BadgeCheck, Bell, Check, LogOut, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { Me, Notification, REFRESH_INTERVAL_MS } from "../types/api";
import { api } from "../api/client";
import { Empty, formatNotificationSource, formatTime } from "./UI";

type NotificationTab = "all" | "action" | "ack" | "normal";

const NOTIFICATION_TABS: { value: NotificationTab; label: string }[] = [
  { value: "all", label: "全部未读" },
  { value: "action", label: "待处理" },
  { value: "ack", label: "需签收" },
  { value: "normal", label: "普通消息" }
];

export function Shell({ me, refresh, children, onQuickAction }: { me: NonNullable<Me>; refresh: () => void; children: ReactNode; onQuickAction?: () => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState<NotificationTab>("all");
  const [quickError, setQuickError] = useState("");
  const [quickBusyId, setQuickBusyId] = useState("");
  const [ackBusy, setAckBusy] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const loadNotifLockRef = useRef(false);
  const notifPollingRef = useRef<number | null>(null);

  async function loadNotifications() {
    if (loadNotifLockRef.current) return;
    loadNotifLockRef.current = true;
    try {
      const data = await api<{ items: Notification[]; unread: number }>("/notifications").catch(() => ({ items: [], unread: 0 }));
      setNotifications(data.items);
      setUnread(data.unread);
    } finally {
      loadNotifLockRef.current = false;
    }
  }

  async function loadUnread() {
    const data = await api<{ unread: number }>("/notifications?summary=1").catch(() => ({ unread: 0 }));
    setUnread(data.unread);
  }

  useEffect(() => {
    if (open) void loadNotifications();
    else void loadUnread();
    function onRefresh() {
      if (open) void loadNotifications();
      else void loadUnread();
    }
    window.addEventListener("app:refresh-notifications", onRefresh);
    notifPollingRef.current = window.setInterval(() => void (open ? loadNotifications() : loadUnread()), REFRESH_INTERVAL_MS);
    function onVisibility() {
      if (document.hidden) {
        if (notifPollingRef.current !== null) { window.clearInterval(notifPollingRef.current); notifPollingRef.current = null; }
      } else if (notifPollingRef.current === null) {
        void (open ? loadNotifications() : loadUnread());
        notifPollingRef.current = window.setInterval(() => void (open ? loadNotifications() : loadUnread()), REFRESH_INTERVAL_MS);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (notifPollingRef.current !== null) { window.clearInterval(notifPollingRef.current); notifPollingRef.current = null; }
      window.removeEventListener("app:refresh-notifications", onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [me.id, open]);
  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!notificationRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  async function readAll() {
    await api("/notifications/read-all", { method: "PATCH", body: JSON.stringify({}) });
    await loadNotifications();
  }

  async function readOne(id: string) {
    setAckBusy(true);
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({}) });
      await loadNotifications();
    } catch { setQuickError("签收失败，请重试"); }
    finally { setAckBusy(false); }
  }

  async function quickAction(item: Notification, action: string) {
    const busyKey = `${item.id}:${action}`;
    setQuickBusyId(busyKey);
    setQuickError("");
    try {
      if (action === "approve") {
        await api(`/task-submissions/${item.related_id}/review`, { method: "PATCH", body: JSON.stringify({ approved: true, note: "" }) });
      } else if (action === "reject") {
        const note = window.prompt("请输入驳回原因，孩子会看到这条说明");
        if (note === null) { setQuickBusyId(""); return; }
        await api(`/task-submissions/${item.related_id}/review`, { method: "PATCH", body: JSON.stringify({ approved: false, note: note || "" }) });
      } else if (action === "redeem") {
        if (!window.confirm("确认核销该奖励？")) { setQuickBusyId(""); return; }
        await api(`/reward-redemptions/${item.related_id}/redeem`, { method: "PATCH", body: JSON.stringify({}) });
      } else if (action === "cancel") {
        if (!window.confirm("确认取消该奖励兑换？积分会自动退回。")) { setQuickBusyId(""); return; }
        await api(`/reward-redemptions/${item.related_id}/cancel`, { method: "PATCH", body: JSON.stringify({}) });
      }
      await readOne(item.id);
      onQuickAction?.();
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setQuickBusyId("");
    }
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    refresh();
  }
  const canQuickAction = me.role === "parent" || me.role === "parent_delegate";
  function isActionable(item: Notification) {
    return canQuickAction && (
      (item.related_type === "task_submission" && !item.requiresCompletionSelection) ||
      (item.related_type === "reward_redemption" && item.event_type === "reward_requested")
    );
  }
  function matchesTab(item: Notification) {
    if (notificationTab === "action") return isActionable(item);
    if (notificationTab === "ack") return !!item.requires_ack;
    if (notificationTab === "normal") return !isActionable(item) && !item.requires_ack;
    return true;
  }
  const visibleNotifications = notifications.filter(matchesTab);
  const actionNotifications = visibleNotifications.filter(isActionable);
  const otherNotifications = visibleNotifications.filter((item) => !isActionable(item));
  function renderNotification(item: Notification) {
    const isBusy = quickBusyId === `${item.id}:approve` || quickBusyId === `${item.id}:reject` || quickBusyId === `${item.id}:redeem` || quickBusyId === `${item.id}:cancel`;
    const source = formatNotificationSource(item);
    return (
      <article className={`notification-row ${item.read_at ? "" : "unread"}`} key={item.id}>
        <div className="notification-main">
          <div className="notification-row-head">
            <span className="notification-chip">{source || item.sourceTypeLabel || "消息"}</span>
            <time>{formatTime(item.created_at)}</time>
          </div>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
          {item.actorLabel && <small className="source-line">操作者：{item.actorLabel}</small>}
        </div>
        <div className="notification-actions">
          {canQuickAction && item.related_type === "task_submission" && !item.requiresCompletionSelection && (
            <>
              <button className="icon good" title="通过" aria-label="通过" disabled={isBusy} onClick={() => quickAction(item, "approve")}><Check size={16} /></button>
              <button className="icon danger" title="驳回" aria-label="驳回" disabled={isBusy} onClick={() => quickAction(item, "reject")}><Trash2 size={16} /></button>
            </>
          )}
          {canQuickAction && item.related_type === "task_submission" && item.requiresCompletionSelection && <small>请到待处理选择完成程度</small>}
          {canQuickAction && item.related_type === "reward_redemption" && item.event_type === "reward_requested" && (
            <>
              <button className="icon good" title="核销" aria-label="核销" disabled={isBusy} onClick={() => quickAction(item, "redeem")}><BadgeCheck size={16} /></button>
              <button className="icon danger" title="取消" aria-label="取消奖励" disabled={isBusy} onClick={() => quickAction(item, "cancel")}><Trash2 size={16} /></button>
            </>
          )}
          {!item.read_at && <button className="secondary" disabled={ackBusy || isBusy} aria-label="签收" onClick={() => readOne(item.id)}>签收</button>}
        </div>
      </article>
    );
  }
  function renderNotificationGroup(title: string, rows: Notification[]) {
    if (!rows.length) return null;
    return (
      <section className="notification-group" key={title}>
        <h3>{title}</h3>
        <div className="notification-group-list">{rows.map(renderNotification)}</div>
      </section>
    );
  }
  const blockingAck = me.role === "child" ? notifications.find((item) => item.requires_ack && !item.read_at && (item.event_type === "praise" || item.event_type === "criticism")) : null;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Sparkles />儿童任务打卡</div>
        <div className="account">
          <div className="notification-wrap" ref={notificationRef}>
            <button className="icon" title="消息中心" aria-label="消息中心" onClick={() => setOpen(!open)}>
              <Bell size={18} />
              {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            {open && (
              <div className="notification-panel">
                <div className="panel-title compact-title">
                  <Bell />
                  <h2>消息中心</h2>
                  <button className="secondary" disabled={!unread} onClick={readAll}>全部已读</button>
                </div>
                {quickError && <div className="error" style={{ padding: "0.5rem" }}>{quickError}</div>}
                <div className="notification-filter-bar" role="tablist" aria-label="消息筛选">
                  {NOTIFICATION_TABS.map((item) => (
                    <button key={item.value} type="button" className={notificationTab === item.value ? "active" : ""} onClick={() => setNotificationTab(item.value)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="notification-list scroll-list">
                  {visibleNotifications.length ? (
                    notificationTab === "all"
                      ? <>
                          {renderNotificationGroup("待处理", actionNotifications)}
                          {renderNotificationGroup(actionNotifications.length ? "其他未读" : "未读消息", otherNotifications)}
                        </>
                      : renderNotificationGroup(NOTIFICATION_TABS.find((item) => item.value === notificationTab)?.label || "未读消息", visibleNotifications)
                  ) : <Empty text="暂无消息" />}
                </div>
              </div>
            )}
          </div>
          <span>{me.displayName}</span>
          <button className="icon" title="退出登录" aria-label="退出登录" onClick={logout}><LogOut size={18} /></button>
        </div>
      </header>
      {blockingAck && (
        <div className="modal-backdrop blocking-ack" role="dialog" aria-modal="true">
          <section className="panel ack-modal">
            <div className="panel-title"><MessageSquare /><h2>{blockingAck.title}</h2></div>
            <p>{blockingAck.body}</p>
            <small>{blockingAck.sourceLabel || formatNotificationSource(blockingAck)}</small>
            <button className="primary" disabled={ackBusy} onClick={() => readOne(blockingAck.id)}>签收</button>
          </section>
        </div>
      )}
      <main className="content">{children}</main>
    </div>
  );
}
