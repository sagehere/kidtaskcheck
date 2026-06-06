import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { Shield, Sparkles } from "lucide-react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Me } from "./types/api";
import { api } from "./api/client";
import { Field } from "./components/UI";

const AdminApp = lazy(() => import("./AdminApp").then((m) => ({ default: m.AdminApp })));
const ParentApp = lazy(() => import("./ParentApp").then((m) => ({ default: m.ParentApp })));
const ChildApp = lazy(() => import("./ChildApp").then((m) => ({ default: m.ChildApp })));

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

function AppShell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="loading">加载中...</div>}>{children}</Suspense>;
}

function App() {
  const [me, setMe] = useState<Me>(null);
  const [loading, setLoading] = useState(true);
  async function loadMe() {
    setLoading(true);
    try {
      setMe(await api<Me>("/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadMe();
    function onUnauthorized() { setMe(null); }
    window.addEventListener("app:unauthorized", onUnauthorized);
    return () => window.removeEventListener("app:unauthorized", onUnauthorized);
  }, []);
  if (loading) return <div className="loading">加载中...</div>;
  if (!me) return <Login onDone={loadMe} />;
  return (
    <AppShell>
      {me.role === "admin" && <AdminApp me={me} refresh={loadMe} />}
      {(me.role === "parent" || me.role === "parent_delegate") && <ParentApp me={me} refresh={loadMe} />}
      {me.role === "child" && <ChildApp me={me} refresh={loadMe} />}
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
