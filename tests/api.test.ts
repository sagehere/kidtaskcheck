import { describe, expect, it, beforeEach } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { handleAuthRoutes } from "../functions/api/routes/auth.js";
import { handleAdminRoutes } from "../functions/api/routes/admin.js";
import { handleChildRoutes } from "../functions/api/routes/child.js";
import { ensureAdmin, actorFromRequest, loginAttempts, sessionCookie, validateHttpsUrl, isPrivateUrl, truncateAiOutput, id, hashPassword } from "../functions/api/utils.js";

function makeRequest(m: string, p: string, b?: any, c?: string): Request {
  const h: Record<string, string> = {};
  if (m !== "GET" && m !== "HEAD") h["content-type"] = "application/json";
  if (c) h["cookie"] = c;
  return new Request(`http://localhost/api${p}`, { method: m, headers: h, ...(b ? { body: JSON.stringify(b) } : {}) });
}
function norm(p: string) { return `/${(p.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`; }
async function safe(h: Function, ...a: any[]) { try { return await h(...a); } catch (e) { if (e instanceof Response) return e; throw e; } }
async function login(env: any, u: string, p: string): Promise<string> {
  const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: u, password: p }), env, null);
  if (!r || r.status !== 200) throw new Error(`Login failed: ${r?.status}`);
  return (r.headers.get("set-cookie") || "").match(/session=([^;]+)/)?.[1] || "";
}

describe("Auth", () => {
  let env: any;
  beforeEach(async () => { env = resetTestEnv(); await ensureAdmin(env); loginAttempts.clear(); });
  it("rejects wrong password", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "x" }), env, null);
    expect(r!.status).toBe(401);
  });
  it("login succeeds with correct password", async () => {
    const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: "test-admin-pw" }), env, null);
    expect(r!.status).toBe(200);
    const c = r!.headers.get("set-cookie") || "";
    expect(c).toContain("session=");
  });
  it("login cookie includes Secure in production", () => {
    expect(sessionCookie("tok", { ENVIRONMENT: "production" })).toContain("Secure");
  });
  it("login cookie omits Secure in dev", () => {
    expect(sessionCookie("tok", {})).not.toContain("Secure");
  });
  it("rate-limits after 5 rapid failures", async () => {
    for (let i = 0; i < 6; i++) {
      const r = await safe(handleAuthRoutes, "/auth/login", "POST", makeRequest("POST", "/auth/login", { username: "admin", password: `w${i}` }), env, null);
      if (i < 5) expect(r!.status).toBe(401);
      else expect(r!.status).toBe(429);
    }
  });
});

describe("Real Child Session Integration", () => {
  let env: any;
  let pid: string, cid: string;

  beforeEach(async () => {
    env = resetTestEnv();
    await ensureAdmin(env);
    loginAttempts.clear();
    pid = id();
    const pw = await hashPassword("pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'P')").bind(pid, "p", pw).run();
    cid = id();
    const cpw = await hashPassword("cpw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, status) VALUES (?, ?, ?, ?, 'Child', 'active')").bind(cid, pid, "child", cpw).run();
    env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value) VALUES ('cat', ?, 'Cat', 'emoji', '📚')").bind(pid).run();
    const tid = id();
    env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, points, period, limit_count, point_type, enabled_weekdays) VALUES (?, ?, 'cat', 'T', 10, 'daily', 5, 'earn', '[1,2,3,4,5,6,0]')").bind(tid, pid).run();
    env.DB.prepare("INSERT INTO task_assignees (task_id, child_id) VALUES (?, ?)").bind(tid, cid).run();
    const rid = id();
    env.DB.prepare("INSERT INTO rewards (id, parent_id, title, cost_points, limit_period, redeem_weekdays) VALUES (?, ?, 'R', 10, 'daily', '[1,2,3,4,5,6,0]')").bind(rid, pid).run();
    env.DB.prepare("INSERT INTO reward_assignees (reward_id, child_id) VALUES (?, ?)").bind(rid, cid).run();
  });

  it("child login -> actorFromRequest -> dashboard succeeds and has correct parentId", async () => {
    const cookie = await login(env, "child", "cpw");
    const req = makeRequest("GET", "/auth/me", undefined, `session=${cookie}`);
    const actor = await actorFromRequest(req, env);
    expect(actor).not.toBeNull();
    expect(actor!.role).toBe("child");
    expect(actor!.parentId).toBe(pid);
    expect(actor!.parent_id).toBe(pid);
    // Dashboard
    const dashReq = makeRequest("GET", "/dashboard/child");
    const dashRes = await safe(handleChildRoutes, norm(new URL(dashReq.url).pathname), "GET", dashReq, env, actor, { waitUntil: () => {} });
    expect(dashRes!.status).toBe(200);
    const dash = await dashRes!.json();
    expect(dash.data.tasks.length).toBeGreaterThanOrEqual(1);
    expect(dash.data.tasks[0].title).toBe("T");
  });

  it("child login -> submit task succeeds", async () => {
    const cookie = await login(env, "child", "cpw");
    const req = makeRequest("GET", "/auth/me", undefined, `session=${cookie}`);
    const actor = await actorFromRequest(req, env);
    // Get task ID from dashboard
    const dashReq = makeRequest("GET", "/dashboard/child");
    const dashRes = await safe(handleChildRoutes, norm(new URL(dashReq.url).pathname), "GET", dashReq, env, actor, { waitUntil: () => {} });
    const dash = await dashRes!.json();
    const taskId = dash.data.tasks[0].id;
    // Submit
    const subReq = makeRequest("POST", "/task-submissions", { taskId });
    const subRes = await safe(handleChildRoutes, norm(new URL(subReq.url).pathname), "POST", subReq, env, actor);
    expect(subRes!.status).toBe(200);
  });
});

describe("Input Validation", () => {
  it("validateHttpsUrl rejects localhost", () => {
    expect(validateHttpsUrl("http://localhost:8080", "URL")).not.toBeNull();
  });
  it("validateHttpsUrl rejects HTTP", () => {
    expect(validateHttpsUrl("http://example.com", "URL")).not.toBeNull();
  });
  it("validateHttpsUrl accepts HTTPS", () => {
    expect(validateHttpsUrl("https://api.openai.com", "URL")).toBeNull();
  });
  it("isPrivateUrl blocks private ranges", () => {
    expect(isPrivateUrl("https://10.0.0.1")).toBe(true);
    expect(isPrivateUrl("https://172.16.0.1")).toBe(true);
    expect(isPrivateUrl("https://192.168.1.1")).toBe(true);
    expect(isPrivateUrl("https://169.254.169.254")).toBe(true);
    expect(isPrivateUrl("https://127.0.0.1")).toBe(true);
  });
  it("isPrivateUrl allows public HTTPS", () => {
    expect(isPrivateUrl("https://api.openai.com")).toBe(false);
  });
  it("truncateAiOutput truncates long text", () => {
    const long = "a".repeat(200);
    expect(truncateAiOutput(long).length).toBe(121);
  });
  it("truncateAiOutput keeps short text", () => {
    expect(truncateAiOutput("hello")).toBe("hello");
  });
});

describe("Admin Input Validation", () => {
  let env: any;
  beforeEach(async () => {
    env = resetTestEnv(); await ensureAdmin(env); loginAttempts.clear();
  });
  async function asAdmin() {
    const c = await login(env, "admin", "test-admin-pw");
    const a = await actorFromRequest(makeRequest("GET", "/auth/me", undefined, `session=${c}`), env);
    return { cookie: c, actor: a };
  }
  it("rejects AI baseUrl with HTTP", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/ai-service", "PATCH", makeRequest("PATCH", "/admin/ai-service", { baseUrl: "http://localhost" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("rejects AI baseUrl with localhost", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/ai-service", "PATCH", makeRequest("PATCH", "/admin/ai-service", { baseUrl: "https://localhost:8080" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("accepts valid HTTPS AI baseUrl", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/ai-service", "PATCH", makeRequest("PATCH", "/admin/ai-service", { baseUrl: "https://api.openai.com/v1" }), env, actor);
    expect(r!.status).toBe(200);
  });
  it("rejects gallery URL with javascript scheme", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/gallery-images", "POST", makeRequest("POST", "/admin/gallery-images", { name: "test", url: "javascript:alert(1)" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("rejects gallery URL with file scheme", async () => {
    const { actor } = await asAdmin();
    const r = await safe(handleAdminRoutes, "/admin/gallery-images", "POST", makeRequest("POST", "/admin/gallery-images", { name: "test", url: "file:///etc/passwd" }), env, actor);
    expect(r!.status).toBe(400);
  });
});
