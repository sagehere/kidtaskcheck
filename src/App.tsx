import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  Check,
  ClipboardCheck,
  Gift,
  Image,
  LogOut,
  Plus,
  Shield,
  Sparkles,
  Star,
  Trash2,
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

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("change-me-admin-password");
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
        <p>任务、积分、奖励和成就都在一个温和清楚的家庭激励面板里。</p>
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
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [imageForm, setImageForm] = useState({ name: "", url: "", usage: "general" });

  async function load() {
    setUsers(await api("/admin/users"));
    setGallery(await api("/admin/gallery-images"));
  }
  useEffect(() => void load(), []);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    await api("/admin/users", { method: "POST", body: JSON.stringify(form) });
    setForm({ username: "", displayName: "", password: "" });
    setMessage("家长用户已创建");
    await load();
  }

  async function createImage(event: FormEvent) {
    event.preventDefault();
    await api("/admin/gallery-images", { method: "POST", body: JSON.stringify(imageForm) });
    setImageForm({ name: "", url: "", usage: "general" });
    setMessage("图库图片已添加");
    await load();
  }

  async function deleteUser(id: string) {
    await api(`/admin/users/${id}`, { method: "DELETE" });
    setMessage("家长用户及其子账户已归档删除");
    await load();
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
                <button className="icon danger" title="归档删除" onClick={() => deleteUser(user.id)}>
                  <Trash2 size={18} />
                </button>
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
            <Field label="图片URL">
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
  const [dashboard, setDashboard] = useState<any>({ children: [], pendingSubmissions: [], pendingRedemptions: [] });
  const [message, setMessage] = useState("");

  async function load() {
    const [childRows, categoryRows, taskRows, rewardRows, achievementRows, dash] = await Promise.all([
      api<Child[]>("/children"),
      api<Category[]>("/task-categories"),
      api<Task[]>("/tasks"),
      api<Reward[]>("/rewards"),
      api<any[]>("/achievements"),
      api<any>("/dashboard/parent")
    ]);
    setChildren(childRows);
    setCategories(categoryRows);
    setTasks(taskRows);
    setRewards(rewardRows);
    setAchievements(achievementRows);
    setDashboard(dash);
  }
  useEffect(() => void load(), []);

  async function create(path: string, data: Record<string, unknown>, note: string) {
    await api(path, { method: "POST", body: JSON.stringify(data) });
    setMessage(note);
    await load();
  }

  async function review(id: string, approved: boolean) {
    await api(`/task-submissions/${id}/review`, { method: "PATCH", body: JSON.stringify({ approved }) });
    setMessage(approved ? "任务已通过并结算积分" : "任务已驳回");
    await load();
  }

  async function finishRedemption(id: string, action: "redeem" | "cancel") {
    await api(`/reward-redemptions/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) });
    setMessage(action === "redeem" ? "奖励已核销" : "兑换已取消并退回积分");
    await load();
  }

  return (
    <Shell me={me} refresh={refresh}>
      <section className="hero-band parent">
        <div>
          <p>家长面板</p>
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

      <div className="dashboard-strip">
        {dashboard.children?.map((child: Child) => (
          <article className="child-tile" key={child.id}>
            <span>{child.display_name}</span>
            <strong>{child.balance || 0}</strong>
            <small>当前积分</small>
          </article>
        ))}
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-title">
            <ClipboardCheck />
            <h2>任务审核</h2>
          </div>
          <div className="list">
            {dashboard.pendingSubmissions?.length ? (
              dashboard.pendingSubmissions.map((item: any) => (
                <article className="row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.child_name} · {item.period_key}</span>
                  </div>
                  <div className="actions">
                    <button className="icon good" title="通过" onClick={() => review(item.id, true)}>
                      <Check size={18} />
                    </button>
                    <button className="icon danger" title="驳回" onClick={() => review(item.id, false)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <Empty text="没有待审核任务" />
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <Gift />
            <h2>奖励核销</h2>
          </div>
          <div className="list">
            {dashboard.pendingRedemptions?.length ? (
              dashboard.pendingRedemptions.map((item: any) => (
                <article className="row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.child_name} · {item.period_key}</span>
                  </div>
                  <div className="actions">
                    <button className="icon good" title="核销" onClick={() => finishRedemption(item.id, "redeem")}>
                      <BadgeCheck size={18} />
                    </button>
                    <button className="icon danger" title="取消" onClick={() => finishRedemption(item.id, "cancel")}>
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
      </div>

      <div className="grid three">
        <CreateChild onCreate={(data) => create("/children", data, "孩子账号已创建")} />
        <CreateCategory onCreate={(data) => create("/task-categories", data, "任务分类已创建")} />
        <CreateAchievement onCreate={(data) => create("/achievements", data, "成就称号已创建")} />
      </div>
      <div className="grid two">
        <CreateTask children={children} categories={categories} onCreate={(data) => create("/tasks", data, "任务已创建")} />
        <CreateReward children={children} onCreate={(data) => create("/rewards", data, "奖励已创建")} />
      </div>
      <Overview title="现有任务" items={tasks} kind="task" />
      <Overview title="现有奖励" items={rewards} kind="reward" />
      <Overview title="成就称号" items={achievements} kind="achievement" />
    </Shell>
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

function CreateCategory({ onCreate }: { onCreate: (data: any) => void }) {
  const [data, setData] = useState({ name: "", iconValue: "📚" });
  return (
    <FormPanel title="任务分类" icon={<Star />} onSubmit={() => onCreate({ ...data, iconType: "emoji" })}>
      <Field label="名称"><input required value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} /></Field>
      <Field label="符号"><input required value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
    </FormPanel>
  );
}

function CreateAchievement({ onCreate }: { onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", metric: "tasks_completed", threshold: 5, iconValue: "🏅" });
  return (
    <FormPanel title="成就称号" icon={<Award />} onSubmit={() => onCreate({ ...data, iconType: "emoji" })}>
      <Field label="称号"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="条件">
        <select value={data.metric} onChange={(e) => setData({ ...data, metric: e.target.value })}>
          <option value="tasks_completed">累计完成任务</option>
          <option value="total_earned">累计获得积分</option>
          <option value="balance">当前积分余额</option>
          <option value="streak_days">连续打卡天数</option>
          <option value="redemptions">累计兑换奖励</option>
        </select>
      </Field>
      <Field label="阈值"><input type="number" value={data.threshold} onChange={(e) => setData({ ...data, threshold: Number(e.target.value) })} /></Field>
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
    </FormPanel>
  );
}

function CreateTask({ children, categories, onCreate }: { children: Child[]; categories: Category[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", categoryId: "", period: "daily", pointType: "earn", points: 5, iconValue: "✅", childIds: [] as string[] });
  const categoryId = data.categoryId || categories[0]?.id || "";
  return (
    <FormPanel title="新任务" icon={<ClipboardCheck />} onSubmit={() => onCreate({ ...data, categoryId, iconType: "emoji" })}>
      <Field label="标题"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
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
      <Field label="积分类型">
        <select value={data.pointType} onChange={(e) => setData({ ...data, pointType: e.target.value })}>
          <option value="earn">加分</option>
          <option value="deduct">扣分</option>
        </select>
      </Field>
      <Field label="分值"><input type="number" min="0" value={data.points} onChange={(e) => setData({ ...data, points: Number(e.target.value) })} /></Field>
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
  );
}

function CreateReward({ children, onCreate }: { children: Child[]; onCreate: (data: any) => void }) {
  const [data, setData] = useState({ title: "", costPoints: 10, limitPeriod: "none", limitCount: 1, iconValue: "🎁", childIds: [] as string[] });
  return (
    <FormPanel title="新奖励" icon={<Gift />} onSubmit={() => onCreate({ ...data, iconType: "emoji" })}>
      <Field label="名称"><input required value={data.title} onChange={(e) => setData({ ...data, title: e.target.value })} /></Field>
      <Field label="所需积分"><input type="number" min="0" value={data.costPoints} onChange={(e) => setData({ ...data, costPoints: Number(e.target.value) })} /></Field>
      <Field label="限制周期">
        <select value={data.limitPeriod} onChange={(e) => setData({ ...data, limitPeriod: e.target.value })}>
          <option value="none">不限</option>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
        </select>
      </Field>
      <Field label="周期次数"><input type="number" min="1" value={data.limitCount} onChange={(e) => setData({ ...data, limitCount: Number(e.target.value) })} /></Field>
      <Field label="符号"><input value={data.iconValue} onChange={(e) => setData({ ...data, iconValue: e.target.value })} /></Field>
      <ChildPicker children={children} value={data.childIds} onChange={(childIds) => setData({ ...data, childIds })} />
    </FormPanel>
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

function FormPanel({ title, icon, children, onSubmit }: { title: string; icon: ReactNode; children: ReactNode; onSubmit: () => void }) {
  return (
    <section className="panel">
      <div className="panel-title">{icon}<h2>{title}</h2></div>
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        {children}
        <button className="primary"><Plus size={18} />保存</button>
      </form>
    </section>
  );
}

function Overview({ title, items, kind }: { title: string; items: any[]; kind: "task" | "reward" | "achievement" }) {
  return (
    <section className="panel">
      <div className="panel-title"><Star /><h2>{title}</h2></div>
      <div className="cards">
        {items.length ? items.map((item) => (
          <article className="mini-card" key={item.id}>
            {icon(item.icon_type, item.icon_value, item.title)}
            <strong>{item.title}</strong>
            <span>
              {kind === "task" && `${item.period} · ${item.point_type === "earn" ? "+" : "-"}${item.points}`}
              {kind === "reward" && `${item.cost_points} 积分 · ${item.limit_period}`}
              {kind === "achievement" && `${item.metric} ≥ ${item.threshold}`}
            </span>
          </article>
        )) : <Empty text="暂无内容" />}
      </div>
    </section>
  );
}

function ChildApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [dash, setDash] = useState<any>({ tasks: [], rewards: [], achievements: [], balance: 0 });
  const [message, setMessage] = useState("");
  const grouped = useMemo(() => {
    return dash.tasks.reduce((acc: Record<string, any[]>, task: any) => {
      const key = task.category_name || "任务";
      acc[key] = [...(acc[key] || []), task];
      return acc;
    }, {});
  }, [dash.tasks]);

  async function load() {
    setDash(await api("/dashboard/child"));
  }
  useEffect(() => void load(), []);

  async function submitTask(taskId: string) {
    await api("/task-submissions", { method: "POST", body: JSON.stringify({ taskId }) });
    setMessage("任务已提交，等待家长审核");
    await load();
  }

  async function redeem(rewardId: string) {
    await api("/reward-redemptions", { method: "POST", body: JSON.stringify({ rewardId }) });
    setMessage("奖励已兑换，等待家长核销");
    await load();
  }

  return (
    <Shell me={me} refresh={refresh}>
      <section className="hero-band child">
        <div>
          <p>孩子面板</p>
          <h1>{me.displayName}，今天也很棒</h1>
        </div>
        <div className="metric large">
          <Star />
          <strong>{dash.balance}</strong>
          <span>当前积分</span>
        </div>
      </section>
      {message && <div className="success">{message}</div>}
      <div className="grid two">
        <section className="panel">
          <div className="panel-title"><ClipboardCheck /><h2>当前任务</h2></div>
          {Object.entries(grouped).map(([category, items]) => (
            <div className="task-group" key={category}>
              <h3>{category}</h3>
              <div className="cards">
                {(items as any[]).map((task) => (
                  <article className="task-card" key={task.id}>
                    {icon(task.icon_type, task.icon_value, task.title)}
                    <strong>{task.title}</strong>
                    <span>{task.period_key} · {task.point_type === "earn" ? "+" : "-"}{task.points}</span>
                    <button disabled={!!task.submissionStatus} className="primary" onClick={() => submitTask(task.id)}>
                      {task.submissionStatus ? statusText(task.submissionStatus) : "提交完成"}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-title"><Gift /><h2>可兑换奖励</h2></div>
          <div className="cards">
            {dash.rewards.map((reward: any) => (
              <article className="mini-card" key={reward.id}>
                {icon(reward.icon_type, reward.icon_value, reward.title)}
                <strong>{reward.title}</strong>
                <span>{reward.cost_points} 积分</span>
                <button className="secondary" disabled={dash.balance < reward.cost_points} onClick={() => redeem(reward.id)}>兑换</button>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title"><Award /><h2>成就墙</h2></div>
        <div className="cards">
          {dash.achievements.length ? dash.achievements.map((item: any) => (
            <article className="achievement" key={item.id}>
              {icon(item.icon_type, item.icon_value, item.title)}
              <strong>{item.title}</strong>
              <span>{item.description || "已解锁"}</span>
            </article>
          )) : <Empty text="完成任务后会解锁称号" />}
        </div>
      </section>
    </Shell>
  );
}

function statusText(status: string) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已完成";
  return "已驳回";
}

function Shell({ me, refresh, children }: { me: NonNullable<Me>; refresh: () => void; children: ReactNode }) {
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    refresh();
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Sparkles />儿童任务打卡</div>
        <div className="account">
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
