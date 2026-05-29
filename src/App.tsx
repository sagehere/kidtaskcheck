import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  Award,
  BadgeCheck,
  Bell,
  Check,
  ClipboardCheck,
  Coins,
  Download,
  Edit3,
  Gift,
  Image,
  KeyRound,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  Users
} from "lucide-react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Me =
  | { type: "user"; role: "admin" | "parent"; id: string; displayName: string; username: string }
  | { type: "child"; role: "child"; id: string; parentId: string; displayName: string; username: string }
  | null;

type Child = { id: string; username: string; display_name: string; status: string; balance?: number };
type Gallery = { id: string; name: string; url: string; usage: string };
type Category = { id: string; name: string; icon_type: string; icon_value: string; is_system: number };
type Task = Record<string, any> & { assignees?: string[] };
type Reward = Record<string, any> & { assignees?: string[] };
type FeedbackTemplate = Record<string, any> & { id: string; kind: "praise" | "criticism"; title: string; description: string; points: number; icon_type: string; icon_value: string; is_active: number };
type Notification = { id: string; title: string; body: string; event_type?: string; read_at: string | null; created_at: string; sourceLabel?: string; sourceTypeLabel?: string };
type LedgerRow = { id: string; amount: number; source_type: string; note: string; created_at: string; period_key?: string | null };
type SystemSettings = { timezoneOffsetMinutes: number; timezoneLabel: string };
const REFRESH_INTERVAL_MS = 12000;

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "请求失败");
  return payload.data as T;
}

function icon(type: string, value: string, label: string) {
  if (type === "gallery_image") return <img className="visual" src={value} alt={label} />;
  return <span className="emoji">{value || "⭐"}</span>;
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function Empty(props: { text: string }) {
  return <div className="empty">{props.text}</div>;
}

function formatReset(resetAt?: string | null) {
  if (!resetAt) return "已达上限";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return "即将重置";
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `距重置 ${days}天${hours}小时`;
  return `距重置 ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatSource(value: string) {
  const labels: Record<string, string> = {
    task: "任务",
    reward: "奖励兑换",
    reward_cancel: "兑换退回",
    manual_deduction: "即时扣分",
    praise: "表扬",
    criticism: "批评"
  };
  return labels[value] || value;
}

function formatNotificationSource(item: Notification) {
  if (item.sourceLabel || item.sourceTypeLabel) return item.sourceLabel || item.sourceTypeLabel;
  const labels: Record<string, string> = {
    task_submitted: "任务",
    task_approved: "任务",
    task_rejected: "任务",
    reward_requested: "奖励",
    reward_redeemed: "奖励",
    reward_cancelled: "奖励",
    praise: "表扬",
    criticism: "批评"
  };
  return labels[item.event_type || ""] || "消息";
}

function formatPeriod(value: string) {
  const labels: Record<string, string> = {
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
    once: "一次性",
    none: "不限"
  };
  return labels[value] || value;
}

function formatMetric(value: string) {
  const labels: Record<string, string> = {
    tasks_completed: "累计完成任务",
    total_earned: "累计获得积分",
    balance: "当前积分余额",
    streak_days: "连续打卡天数",
    redemptions: "累计兑换奖励"
  };
  return labels[value] || value;
}

const ACHIEVEMENT_CONDITIONS = [
  { value: "tasks_total", label: "累计完成任务" },
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

function conditionFromAchievement(item: any) {
  const ruleType = item.rule_type || item.metric || "tasks_completed";
  const windowType = item.window_type || "all_time";
  if (ruleType === "tasks_completed" && windowType === "current_week") return "tasks_week";
  if (ruleType === "tasks_completed" && windowType === "current_month") return "tasks_month";
  if (ruleType === "tasks_completed" && windowType === "custom") return "tasks_custom";
  if (ruleType === "tasks_completed") return "tasks_total";
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

function achievementRuleFromCondition(condition: string) {
  if (condition === "tasks_total") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "all_time" };
  if (condition === "tasks_week") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "current_week" };
  if (condition === "tasks_month") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "current_month" };
  if (condition === "tasks_custom") return { ruleType: "tasks_completed", metric: "tasks_completed", windowType: "custom" };
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

function achievementPayload(data: any) {
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
    targetTaskId: rule.ruleType === "same_task_streak" ? data.targetTaskId : null,
    targetCategoryId: rule.ruleType === "category_tasks" || rule.ruleType === "category_streak" ? data.targetCategoryId : null
  };
}

function formatAchievementRule(item: any, tasks: Task[] = [], categories: Category[] = []) {
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
  if (condition === "category_streak") return `${category?.name || "指定分类"}连续打卡 ≥ ${item.threshold}天`;
  if (condition.startsWith("category_tasks_")) return `${category?.name || "指定分类"}${label.replace("指定分类", "")} ≥ ${item.threshold}次`;
  if (condition === "no_criticism_week" || condition === "no_criticism_month") return label;
  const unit = condition === "total_earned" || condition === "balance" ? "分" : condition === "streak_days" || condition === "praise_streak" || condition === "no_criticism_days" ? "天" : "次";
  return `${label} ≥ ${item.threshold}${unit}`;
}

function timezoneOptions() {
  const values = [-720, -600, -480, -300, -240, 0, 330, 480, 540, 600, 720];
  return values.map((value) => {
    const sign = value >= 0 ? "+" : "-";
    const abs = Math.abs(value);
    return { value, label: `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}` };
  });
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <main className="login-shell">
      <section className="login-hero">
        <div className="brand-mark">
          <Sparkles />
        </div>
        <h1>儿童任务打卡</h1>
        <p>任务、积分、奖励和成就都在一个清晰的家庭激励面板里。</p>
      </section>
      <form className="login-panel" onSubmit={submit}>
        <h2>登录</h2>
        <Field label="账号">
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </Field>
        <Field label="密码">
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </Field>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">
          <Shield size={18} />
          进入系统
        </button>
      </form>
    </main>
  );
}

function AdminApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [gallery, setGallery] = useState<Gallery[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [profileForm, setProfileForm] = useState({ username: me.username, displayName: me.displayName, currentPassword: "", newPassword: "", confirmPassword: "" });
  const [imageForm, setImageForm] = useState({ name: "", url: "", usage: "general" });
  const [settings, setSettings] = useState<SystemSettings>({ timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00" });

  async function load() {
    const [userRows, galleryRows, settingRows] = await Promise.all([api<any[]>("/admin/users"), api<Gallery[]>("/admin/gallery-images"), api<SystemSettings>("/admin/system-settings")]);
    setUsers(userRows);
    setGallery(galleryRows);
    setSettings(settingRows);
  }
  useEffect(() => void load(), []);
  useEffect(() => {
    setProfileForm((current) => ({ ...current, username: me.username, displayName: me.displayName }));
  }, [me.username, me.displayName]);

  async function run(action: () => Promise<void>, note: string) {
    setError("");
    try {
      await action();
      setMessage(note);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ username: "", displayName: "", password: "" });
    }, "家长用户已创建");
  }

  async function updateProfile(event: FormEvent) {
    event.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      setMessage("");
      setError("两次输入的新密码不一致");
      return;
    }
    await run(async () => {
      const next = await api<{ username: string; displayName: string }>("/admin/profile", {
        method: "PATCH",
        body: JSON.stringify({
          username: profileForm.username,
          displayName: profileForm.displayName,
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword
        })
      });
      setProfileForm({ username: next.username, displayName: next.displayName, currentPassword: "", newPassword: "", confirmPassword: "" });
      refresh();
    }, "管理员账号已更新");
  }

  async function createImage(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/admin/gallery-images", { method: "POST", body: JSON.stringify(imageForm) });
      setImageForm({ name: "", url: "", usage: "general" });
    }, "图库图片已添加");
  }

  async function resetPassword(user: any) {
    const password = window.prompt(`为 ${user.display_name} 设置新密码`);
    if (!password) return;
    await run(() => api(`/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password }) }), "家长密码已更新");
  }

  async function deleteUser(id: string) {
    if (!window.confirm("确认归档这个家长及其孩子账号？")) return;
    await run(() => api(`/admin/users/${id}`, { method: "DELETE" }), "家长用户及其子账号已归档");
  }

  async function updateSettings(timezoneOffsetMinutes: number) {
    await run(async () => {
      const next = await api<SystemSettings>("/admin/system-settings", { method: "PATCH", body: JSON.stringify({ timezoneOffsetMinutes }) });
      setSettings(next);
    }, "系统设置已更新");
  }

  return (
    <Shell me={me} refresh={refresh}>
      <section className="hero-band admin">
        <div>
          <p>管理员面板</p>
          <h1>用户与系统资源</h1>
        </div>
        <div className="metric">
          <Users />
          <strong>{users.length}</strong>
          <span>家长用户</span>
        </div>
      </section>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}
      <section className="panel setting-group">
        <div className="panel-title">
          <Shield />
          <h2>管理员账号设置</h2>
        </div>
        <form className="stack compact" onSubmit={updateProfile}>
          <Field label="管理员账号">
            <input value={profileForm.username} onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })} autoComplete="username" required />
          </Field>
          <Field label="显示名">
            <input value={profileForm.displayName} onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })} required />
          </Field>
          <Field label="当前密码">
            <input value={profileForm.currentPassword} onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })} type="password" autoComplete="current-password" required />
          </Field>
          <Field label="新密码">
            <input value={profileForm.newPassword} onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })} type="password" autoComplete="new-password" />
          </Field>
          <Field label="确认新密码">
            <input value={profileForm.confirmPassword} onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} type="password" autoComplete="new-password" />
          </Field>
          <button className="primary">
            <KeyRound size={18} />
            保存管理员账号
          </button>
        </form>
      </section>
      <section className="panel setting-group">
        <div className="panel-title">
          <Settings />
          <h2>系统设置</h2>
        </div>
        <form className="stack compact" onSubmit={(event) => { event.preventDefault(); void updateSettings(settings.timezoneOffsetMinutes); }}>
          <Field label="重置时区">
            <select value={settings.timezoneOffsetMinutes} onChange={(e) => setSettings({ ...settings, timezoneOffsetMinutes: Number(e.target.value) })}>
              {timezoneOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="field">
            <span>当前设置</span>
            <div className="readonly-value">{settings.timezoneLabel}</div>
          </div>
          <button className="primary"><Settings size={18} />保存系统设置</button>
        </form>
      </section>
      <div className="grid two">
        <section className="panel">
          <div className="panel-title">
            <UserRound />
            <h2>家长用户</h2>
          </div>
          <form className="stack compact" onSubmit={createUser}>
            <Field label="账号">
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </Field>
            <Field label="显示名">
              <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
            </Field>
            <Field label="初始密码">
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
            <button className="primary">
              <Plus size={18} />
              创建家长
            </button>
          </form>
          <div className="list">
            {users.map((user) => (
              <article className="row" key={user.id}>
                <div>
                  <strong>{user.display_name}</strong>
                  <span>{user.username}</span>
                </div>
                <div className="actions">
                  <button className="icon" title="重置密码" onClick={() => resetPassword(user)}>
                    <KeyRound size={18} />
                  </button>
                  <button className="icon danger" title="归档删除" onClick={() => deleteUser(user.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <Image />
            <h2>内置图库</h2>
          </div>
          <form className="stack compact" onSubmit={createImage}>
            <Field label="名称">
              <input value={imageForm.name} onChange={(e) => setImageForm({ ...imageForm, name: e.target.value })} required />
            </Field>
            <Field label="图片 URL">
              <input value={imageForm.url} onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })} required />
            </Field>
            <Field label="用途">
              <input value={imageForm.usage} onChange={(e) => setImageForm({ ...imageForm, usage: e.target.value })} />
            </Field>
            <button className="primary">
              <Plus size={18} />
              添加图片
            </button>
          </form>
          <div className="gallery">
            {gallery.map((item) => (
              <figure key={item.id}>
                <img src={item.url} alt={item.name} />
                <figcaption>{item.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function ParentApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [feedbackTemplates, setFeedbackTemplates] = useState<FeedbackTemplate[]>([]);
  const [dashboard, setDashboard] = useState<any>({ children: [], pendingSubmissions: [], pendingRedemptions: [] });
  const [activeTab, setActiveTab] = useState<"pending" | "children" | "settings">("pending");
  const [ledgerChild, setLedgerChild] = useState<{ id: string; display_name: string } | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const resetTapCount = useRef(0);
  const resetTapTimer = useRef<number | null>(null);

  async function load() {
    const [childRows, categoryRows, taskRows, rewardRows, achievementRows, feedbackRows, dash] = await Promise.all([
      api<Child[]>("/children"),
      api<Category[]>("/task-categories"),
      api<Task[]>("/tasks"),
      api<Reward[]>("/rewards"),
      api<any[]>("/achievements"),
      api<FeedbackTemplate[]>("/feedback-templates"),
      api<any>("/dashboard/parent")
    ]);
    setChildren(childRows);
    setCategories(categoryRows);
    setTasks(taskRows);
    setRewards(rewardRows);
    setAchievements(achievementRows);
    setFeedbackTemplates(feedbackRows);
    setDashboard(dash);
  }
  useEffect(() => void load(), []);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (ledgerChild) void loadLedger(ledgerChild);
  }, [dashboard, ledgerChild?.id]);
  useEffect(() => () => {
    if (resetTapTimer.current) window.clearTimeout(resetTapTimer.current);
  }, []);

  async function loadLedger(child: { id: string; display_name: string }) {
    setLedgerChild(child);
    setLedger(await api<LedgerRow[]>(`/points/ledger?childId=${encodeURIComponent(child.id)}`).catch(() => []));
  }

  async function run(action: () => Promise<void>, note: string) {
    setError("");
    try {
      await action();
      setMessage(note);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function create(path: string, data: Record<string, unknown>, note: string) {
    await run(() => api(path, { method: "POST", body: JSON.stringify(data) }), note);
  }

  async function update(path: string, data: Record<string, unknown>, note: string) {
    await run(() => api(path, { method: "PATCH", body: JSON.stringify(data) }), note);
  }

  async function remove(path: string, note: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    await run(() => api(path, { method: "DELETE" }), note);
  }

  async function review(id: string, approved: boolean) {
    const note = approved ? "" : window.prompt("请输入驳回原因，孩子会看到这条说明", "") || "";
    await run(
      () => api(`/task-submissions/${id}/review`, { method: "PATCH", body: JSON.stringify({ approved, note }) }),
      approved ? "任务已通过并结算积分" : "任务已驳回"
    );
  }

  async function finishRedemption(id: string, action: "redeem" | "cancel") {
    await run(
      () => api(`/reward-redemptions/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) }),
      action === "redeem" ? "奖励已核销" : "兑换已取消并退回积分"
    );
  }

  async function updateChild(child: Child) {
    const displayName = window.prompt("新的显示名", child.display_name) || child.display_name;
    const password = window.prompt("新密码，留空则不修改", "") || undefined;
    await run(() => api(`/children/${child.id}`, { method: "PATCH", body: JSON.stringify({ displayName, password }) }), "孩子账号已更新");
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
    if (!window.confirm("确认清空当前家长全部孩子的积分、任务、奖励与成就进度？账号和配置会保留。")) return;
    await run(() => api("/testing/reset-parent-progress", { method: "POST", body: JSON.stringify({}) }), "测试进度已重置");
  }

  function tapHiddenReset() {
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

  async function applyFeedback(data: { childId: string; templateId: string }) {
    await run(
      () => api(`/children/${data.childId}/feedback-events`, { method: "POST", body: JSON.stringify({ templateId: data.templateId }) }),
      "表扬与批评已记录"
    );
  }

  return (
    <Shell me={me} refresh={refresh}>
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
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

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
            <ChildManager children={children} onEdit={updateChild} onToggle={toggleChild} onDelete={deleteChild} />
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
            <CreateReward children={children} onCreate={(data) => create("/rewards", data, "奖励已创建")} />
            <Overview title="现有奖励" items={rewards} kind="reward" children={children} onUpdate={(item, data) => update(`/rewards/${item.id}`, data, "奖励已更新")} onDelete={(item) => remove(`/rewards/${item.id}`, "奖励已删除", `确认删除奖励「${item.title}」？历史兑换记录会保留。`)} />
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
        </>
      )}
      {ledgerChild && <LedgerModal title={`${ledgerChild.display_name} 的积分清单`} rows={ledger} onClose={() => setLedgerChild(null)} />}
    </Shell>
  );
}

function ReviewPanel({ title, items, empty, approve, reject }: { title: string; items: any[]; empty: string; approve: (id: string) => void; reject: (id: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <ClipboardCheck />
        <h2>{title}</h2>
      </div>
      <div className="list scroll-list">
        {items.length ? (
          items.map((item: any) => (
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

function Tabs({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="tabs">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RedemptionPanel({ items, onFinish }: { items: any[]; onFinish: (id: string, action: "redeem" | "cancel") => void }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <Gift />
        <h2>奖励核销</h2>
      </div>
      <div className="list scroll-list">
        {items.length ? (
          items.map((item: any) => (
            <article className="row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
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

function PraiseCriticismPanel({ children, templates, onSubmit }: { children: Child[]; templates: FeedbackTemplate[]; onSubmit: (data: { childId: string; templateId: string }) => void }) {
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

function LedgerList({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="list ledger-list">
      {rows.length ? rows.map((row) => (
        <article className="row" key={row.id}>
          <div>
            <strong className={row.amount >= 0 ? "positive" : "negative"}>{row.amount >= 0 ? "+" : ""}{row.amount}</strong>
            <span>{row.note || formatSource(row.source_type)} · {formatTime(row.created_at)}</span>
          </div>
          <span>{formatSource(row.source_type)}</span>
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

function CreateChild({ onCreate }: { onCreate: (data: any) => void }) {
  const [data, setData] = useState({ username: "", displayName: "", password: "" });
  return (
    <FormPanel title="孩子账号" icon={<Users />} onSubmit={() => onCreate(data)}>
      <Field label="账号"><input required value={data.username} onChange={(e) => setData({ ...data, username: e.target.value })} /></Field>
      <Field label="姓名"><input required value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} /></Field>
      <Field label="密码"><input required value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} /></Field>
    </FormPanel>
  );
}

function ChildManager({ children, onEdit, onToggle, onDelete }: { children: Child[]; onEdit: (child: Child) => void; onToggle: (child: Child) => void; onDelete: (child: Child) => void }) {
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
              <button className="secondary" onClick={() => onToggle(child)}>{child.status === "active" ? "停用" : "启用"}</button>
              <button className="icon danger" title="归档" onClick={() => onDelete(child)}><Trash2 size={18} /></button>
            </div>
          </article>
        )) : <Empty text="暂无孩子账号" />}
      </div>
    </section>
  );
}

function AchievementRuleFields({ data, setData, tasks, categories }: { data: any; setData: (data: any) => void; tasks: Task[]; categories: Category[] }) {
  const needsCustomWindow = ["tasks_custom", "category_tasks_custom", "praise_custom", "no_criticism_custom"].includes(data.condition);
  const needsTask = data.condition === "same_task_streak";
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

function CreateAchievement({ tasks, categories, onCreate }: { tasks: Task[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", condition: "tasks_total", threshold: 5, windowStart: "", windowEnd: "", targetTaskId: "", targetCategoryId: "", iconValue: "🏅" });
  return (
    <FormPanel title="成就称号" icon={<Award />} onSubmit={() => onCreate(achievementPayload({ ...data, targetTaskId: data.targetTaskId || tasks[0]?.id || "", targetCategoryId: data.targetCategoryId || categories[0]?.id || "" }))}>
      <Field label="称号"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
      <AchievementRuleFields data={data} setData={setData} tasks={tasks} categories={categories} />
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
    </FormPanel>
  );
}

function CreateTask({ children, categories, onCreate }: { children: Child[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", categoryId: "", period: "daily", limitCount: 1, points: 5, iconValue: "✅", isActive: true, childIds: [] as string[] });
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
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
  );
}

function CreateReward({ children, onCreate }: { children: Child[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", description: "", costPoints: 10, limitPeriod: "daily", limitCount: 1, iconValue: "🎁", isActive: true, childIds: [] as string[] });
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
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
  );
}

function CreateFeedbackTemplate({ onCreate }: { onCreate: (data: any) => void }) {
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
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
    </FormPanel>
  );
}

function FeedbackOverview({ items, onUpdate, onDelete }: { items: FeedbackTemplate[]; onUpdate: (item: FeedbackTemplate, data: any) => void; onDelete: (item: FeedbackTemplate) => void }) {
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
          <EditFeedbackForm item={editing} onCancel={() => setEditing(null)} onSave={(data) => { onUpdate(editing, data); setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

function EditFeedbackForm({ item, onSave, onCancel }: { item: FeedbackTemplate; onSave: (data: any) => void; onCancel: () => void }) {
  const [data, setData] = useState({ kind: item.kind, title: item.title, points: item.points || 0, iconValue: item.icon_value || "✨", isActive: item.is_active !== 0 });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="类型"><select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value as "praise" | "criticism" })}><option value="praise">表扬</option><option value="criticism">批评</option></select></Field>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

function ConfigPortPanel({ onImported }: { onImported: () => Promise<void> }) {
  const [summary, setSummary] = useState("");
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
    const data = JSON.parse(await file.text());
    const stats = await api<Record<string, { created: number; skipped: number }>>("/config/import", { method: "POST", body: JSON.stringify(data) });
    setSummary(Object.entries(stats).map(([key, value]) => `${key}: 新增 ${value.created}，跳过 ${value.skipped}`).join("；"));
    await onImported();
  }
  return (
    <section className="panel setting-group">
      <div className="panel-title"><Upload /><h2>配置导入导出</h2></div>
      <div className="actions wrap">
        <button className="secondary" type="button" onClick={() => void exportConfig()}><Download size={18} />导出配置</button>
        <label className="secondary file-action">
          <Upload size={18} />
          导入配置
          <input type="file" accept="application/json,.json" onChange={(event) => void importConfig(event.target.files?.[0])} />
        </label>
      </div>
      {summary && <div className="success">{summary}</div>}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ChildPicker({ children, value, onChange }: { children: Child[]; value: string[]; onChange: (value: string[]) => void }) {
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

function FormPanel({ title, icon, children, onSubmit, submitLabel = "保存" }: { title: string; icon: ReactNode; children: ReactNode; onSubmit: () => void; submitLabel?: string }) {
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

function EditDialog({ title, icon: dialogIcon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel edit-modal">
        <div className="panel-title compact-title">
          {dialogIcon}
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>关闭</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CategoryOverview({ items, onCreate, onUpdate, onDelete }: { items: Category[]; onCreate: (data: any) => void; onUpdate: (item: Category, data: any) => void; onDelete: (item: Category) => void }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [data, setData] = useState({ name: "", iconValue: "📚" });
  return (
    <section className="panel">
      <div className="panel-title"><Star /><h2>任务分类</h2></div>
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); onCreate({ ...data, iconType: "emoji" }); setData({ name: "", iconValue: "📚" }); }}>
        <Field label="名称"><input required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></Field>
        <Field label="符号"><input required value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
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
          <CategoryEditForm item={editing} onCancel={() => setEditing(null)} onSave={(data) => { onUpdate(editing, data); setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

function CategoryEditForm({ item, onSave, onCancel }: { item: Category; onSave: (data: any) => void; onCancel: () => void }) {
  const [data, setData] = useState({ name: item.name, iconValue: item.icon_value });
  return (
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ ...data, iconType: "emoji" }); }}>
      <Field label="名称"><input required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></Field>
      <Field label="符号"><input required value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

function Overview({ title, items, kind, children = [], categories = [], tasks = [], onUpdate, onDelete }: { title: string; items: any[]; kind: "task" | "reward" | "achievement"; children?: Child[]; categories?: Category[]; tasks?: Task[]; onUpdate?: (item: any, data: any) => void; onDelete?: (item: any) => void }) {
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
                <strong>{item.title}</strong>
                {item.description && <span>{item.description}</span>}
                <small>
                  {kind === "task" && `${item.is_active ? "启用" : "停用"} · ${formatPeriod(item.period)} · +${item.points} · ${item.limit_count || 1}次`}
                  {kind === "reward" && `${item.is_active ? "启用" : "停用"} · ${item.cost_points}积分 · ${formatPeriod(item.limit_period)}${item.limit_period === "once" ? "" : ` · ${item.limit_count || 1}次`}`}
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
          <EditItemForm kind={kind} item={editing} children={children} categories={categories} tasks={tasks} onCancel={() => setEditing(null)} onSave={(data) => { onUpdate(editing, data); setEditing(null); }} />
        </EditDialog>
      )}
    </section>
  );
}

function EditItemForm({ kind, item, children, categories, tasks, onSave, onCancel }: { kind: "task" | "reward" | "achievement"; item: any; children: Child[]; categories: Category[]; tasks: Task[]; onSave: (data: any) => void; onCancel: () => void }) {
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
          <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
        </>
      )}
      {kind === "reward" && (
        <>
          <Field label="所需积分"><input type="number" min="0" value={data.costPoints} onChange={(e) => setData({ ...data, costPoints: Number(e.target.value) })} /></Field>
          <Field label="限制周期"><select value={data.limitPeriod} onChange={(e) => setData({ ...data, limitPeriod: e.target.value })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="once">一次性</option></select></Field>
          {data.limitPeriod !== "once" && <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>}
        </>
      )}
      {kind === "achievement" && (
        <>
          <Field label="说明"><textarea value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></Field>
          <AchievementRuleFields data={data} setData={setData} tasks={tasks} categories={categories} />
        </>
      )}
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      {(kind === "task" || kind === "reward") && <Toggle label="启用" checked={data.isActive} onChange={(isActive) => setData({ ...data, isActive })} />}
      {(kind === "task" || kind === "reward") && <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />}
      <div className="actions"><button className="primary">保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </form>
  );
}

function ChildApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [dash, setDash] = useState<any>({ tasks: [], rewards: [], achievements: [], balance: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "rewards">("tasks");
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [, setTick] = useState(0);

  async function load() {
    setDash(await api("/dashboard/child"));
  }
  useEffect(() => void load(), []);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (ledgerOpen) void api<LedgerRow[]>("/points/ledger").then(setLedger).catch(() => setLedger([]));
  }, [dash, ledgerOpen]);

  async function openLedger() {
    setLedger(await api<LedgerRow[]>("/points/ledger").catch(() => []));
    setLedgerOpen(true);
  }

  async function run(id: string, action: () => Promise<void>, note: string) {
    setBusy(id);
    setError("");
    try {
      await action();
      setMessage(note);
      await load();
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

  return (
    <Shell me={me} refresh={refresh}>
      <section className="hero-band child">
        <div>
          <p>孩子面板</p>
          <h1>{me.displayName}，今天也很棒</h1>
        </div>
        <button className="metric large clickable" onClick={() => void openLedger()}>
          <Star />
          <strong>{dash.balance}</strong>
          <span>当前积分</span>
        </button>
      </section>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}
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
      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as typeof activeTab)}
        options={[
          { value: "tasks", label: "任务" },
          { value: "rewards", label: "奖励" }
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
                    <div className="card-head wall-card-head">
                      {icon(task.icon_type, task.icon_value, task.title)}
                      <div>
                        <strong>{task.title}</strong>
                        <small>{formatPeriod(task.period)}</small>
                      </div>
                    </div>
                    {task.description && <small className="card-description">{task.description}</small>}
                    <div className="card-meta">
                      <span className={task.point_type === "earn" ? "positive" : "negative"}>{points} 积分</span>
                      <span>{task.usedCount}/{task.limitCount} 次</span>
                      <span>{task.periodKey}</span>
                    </div>
                    {task.rejectionNote && <small className="card-status warn">上次驳回：{task.rejectionNote}</small>}
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
                  <div className="card-head wall-card-head">
                    {icon(reward.icon_type, reward.icon_value, reward.title)}
                    <div>
                      <strong>{reward.title}</strong>
                      <small>{formatPeriod(reward.limit_period)}</small>
                    </div>
                  </div>
                  {reward.description && <small className="card-description">{reward.description}</small>}
                  <div className="card-meta">
                    <span className="cost"><Coins size={16} />{reward.cost_points} 积分</span>
                    {reward.limitCount !== null && <span>{reward.usedCount}/{reward.limitCount} 次</span>}
                  </div>
                  <small className={`card-status ${disabled ? "warn" : "ready"}`}>
                    {limited ? formatReset(reward.resetAt) : dash.balance < reward.cost_points ? "积分还不够" : "可以兑换"}
                  </small>
                  <button className="secondary card-action" disabled={disabled} onClick={() => redeem(reward)}>
                    {busy === `reward:${reward.id}` ? "兑换中..." : limited ? formatReset(reward.resetAt) : dash.balance < reward.cost_points ? "积分不足" : "兑换"}
                  </button>
                </article>
              );
            }) : <Empty text="暂无可兑换奖励" />}
          </div>
        </section>
      )}
      {ledgerOpen && <LedgerModal title="我的积分清单" rows={ledger} onClose={() => setLedgerOpen(false)} />}
    </Shell>
  );
}

function Shell({ me, refresh, children }: { me: NonNullable<Me>; refresh: () => void; children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  async function loadNotifications() {
    const data = await api<{ items: Notification[]; unread: number }>("/notifications").catch(() => ({ items: [], unread: 0 }));
    setNotifications(data.items);
    setUnread(data.unread);
  }

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [me.id]);
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
    await api(`/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({}) });
    await loadNotifications();
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    refresh();
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Sparkles />儿童任务打卡</div>
        <div className="account">
          <div className="notification-wrap" ref={notificationRef}>
            <button className="icon" title="消息中心" onClick={() => setOpen(!open)}>
              <Bell size={18} />
              {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            {open && (
              <div className="notification-panel">
                <div className="panel-title compact-title">
                  <Bell />
                  <h2>消息中心</h2>
                  <button className="secondary" onClick={readAll}>全部已读</button>
                </div>
                <div className="list scroll-list">
                  {notifications.length ? notifications.map((item) => (
                    <article className={`row ${item.read_at ? "" : "unread"}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <small className="source-line">{formatNotificationSource(item)}</small>
                        <small>{formatTime(item.created_at)}</small>
                      </div>
                      {!item.read_at && <button className="secondary" onClick={() => readOne(item.id)}>签收</button>}
                    </article>
                  )) : <Empty text="暂无消息" />}
                </div>
              </div>
            )}
          </div>
          <span>{me.displayName}</span>
          <button className="icon" title="退出登录" onClick={logout}><LogOut size={18} /></button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me>(null);
  const [loading, setLoading] = useState(true);
  async function loadMe() {
    setLoading(true);
    setMe(await api<Me>("/auth/me").catch(() => null));
    setLoading(false);
  }
  useEffect(() => void loadMe(), []);
  if (loading) return <div className="loading">加载中...</div>;
  if (!me) return <Login onDone={loadMe} />;
  if (me.role === "admin") return <AdminApp me={me} refresh={loadMe} />;
  if (me.role === "parent") return <ParentApp me={me} refresh={loadMe} />;
  return <ChildApp me={me} refresh={loadMe} />;
}

createRoot(document.getElementById("root")!).render(<App />);
