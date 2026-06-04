import { FormEvent, useEffect, useState } from "react";
import { Image, KeyRound, Plus, Settings, Shield, Trash2, UserRound, Users } from "lucide-react";
import { Me, Gallery, SystemSettings } from "./types/api";
import { api } from "./api/client";
import { Field, FeedbackToast } from "./components/UI";
import { Shell } from "./components/Shell";
import { timezoneOptions } from "./lib/appHelpers";

export function AdminApp({ me, refresh }: { me: NonNullable<Me>; refresh: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [gallery, setGallery] = useState<Gallery[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [profileForm, setProfileForm] = useState({ username: me.username, displayName: me.displayName, currentPassword: "", newPassword: "", confirmPassword: "" });
  const [imageForm, setImageForm] = useState({ name: "", url: "", usage: "general" });
  const [settings, setSettings] = useState<SystemSettings>({ timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00" });

  async function load() {
    let hasError = false;
    try {
      const [userRows, galleryRows, settingRows] = await Promise.all([
        api<any[]>("/admin/users").catch(() => { hasError = true; return []; }),
        api<Gallery[]>("/admin/gallery-images").catch(() => { hasError = true; return []; }),
        api<SystemSettings>("/admin/system-settings").catch(() => { hasError = true; return { timezoneOffsetMinutes: 480, timezoneLabel: "UTC+08:00" }; })
      ]);
      setUsers(userRows as any[]);
      setGallery(galleryRows as Gallery[]);
      setSettings(settingRows as SystemSettings);
      if (hasError) setError("部分数据加载失败，可点击重试");
    } catch (err) {
      setError("加载数据失败，可点击重试");
    }
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return false;
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
      <FeedbackToast message={message} error={error} onDismiss={() => { setMessage(""); setError(""); }} />
      {error && <div className="actions" style={{ justifyContent: "center", marginBottom: "0.5rem" }}><button className="secondary" onClick={() => void load()}>重试</button></div>}
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
              <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
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
