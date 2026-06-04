import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resetTestEnv } from "./helpers/setup";
import { handleAuthRoutes } from "../functions/api/routes/auth.js";
import { handleAdminRoutes } from "../functions/api/routes/admin.js";
import { handleChildRoutes } from "../functions/api/routes/child.js";
import { handleParentRoutes } from "../functions/api/routes/parent.js";
import { ensureAdmin, actorFromRequest, loginAttempts, sessionCookie, validateHttpsUrl, isPrivateUrl, id, hashPassword } from "../functions/api/utils.js";
import { truncateAiOutput, aiReportConfigHash } from "../functions/api/ai/index.js";
import { reportWindowRange } from "../src/lib/domain";

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

describe("Parent AI Service Validation", () => {
  let env: any;
  let parentId: string;
  beforeEach(async () => {
    env = resetTestEnv(); await ensureAdmin(env); loginAttempts.clear();
    parentId = id();
    const pw = await hashPassword("parent-ai-pw");
    env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', 'AI Parent')").bind(parentId, "parent-ai", pw).run();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  async function asAdmin() {
    const c = await login(env, "admin", "test-admin-pw");
    const a = await actorFromRequest(makeRequest("GET", "/auth/me", undefined, `session=${c}`), env);
    return { cookie: c, actor: a };
  }
  async function seedAiChild(aiEnabled = 1) {
    const childId = id();
    const pw = await hashPassword("child-ai-pw");
    env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, ai_enabled) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(childId, parentId, `child-${childId}`, pw, "AI Child", aiEnabled)
      .run();
    return childId;
  }
  function stubChat(text = "AI generated commentary") {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("rejects AI baseUrl with HTTP", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "http://localhost", model: "gpt-4o-mini", prompt: "hello" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("rejects AI baseUrl with localhost", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://localhost:8080", model: "gpt-4o-mini", prompt: "hello" }), env, actor);
    expect(r!.status).toBe(400);
  });
  it("accepts valid HTTPS AI baseUrl", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", prompt: "hello", apiKey: "sk-test" }), env, actor);
    expect(r!.status).toBe(200);
    const getRes = await safe(handleParentRoutes, "/parent/ai-service", "GET", makeRequest("GET", "/parent/ai-service"), env, actor);
    expect(getRes!.status).toBe(200);
    const config = await getRes!.json();
    expect(config.data.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.data.model).toBe("gpt-4o-mini");
    expect(config.data.hasKey).toBe(true);
    expect(config.data.apiKey).toBeUndefined();
  });
  it("creates missing parent AI settings table before saving", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    env.DB.prepare("DROP TABLE parent_ai_service_settings").run();
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-test", prompt: "hello", apiKey: "sk-test" }), env, actor);
    expect(r!.status).toBe(200);
    const row = env.DB.prepare("SELECT base_url, model, api_key FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
    expect(row.base_url).toBe("https://api.example.com/v1");
    expect(row.model).toBe("gpt-test");
    expect(row.api_key).toBe("sk-test");
  });
  it("keeps saved AI key when later updates omit apiKey", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1/", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const r = await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1/", model: "gpt-b", prompt: "updated" }), env, actor);
    expect(r!.status).toBe(200);
    const row = env.DB.prepare("SELECT base_url, model, prompt, api_key FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
    expect(row.base_url).toBe("https://api.example.com/v1");
    expect(row.model).toBe("gpt-b");
    expect(row.prompt).toBe("updated");
    expect(row.api_key).toBe("sk-test");
  });
  it("fetches AI models with saved key, timeout, and manual redirects", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.com/v1/models");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
      expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer sk-test");
      return new Response(JSON.stringify({ data: [{ id: "gpt-a" }, { id: 123 }, {}, { id: " gpt-b " }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await safe(handleParentRoutes, "/parent/ai-service/models", "POST", makeRequest("POST", "/parent/ai-service/models", { baseUrl: "https://api.example.com/v1" }), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.models).toEqual(["gpt-a", "gpt-b"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("processes AI refresh queue without waitUntil", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = stubChat("Queue greeting");
    const r = await safe(handleParentRoutes, "/parent/ai-service/refresh-greetings", "POST", makeRequest("POST", "/parent/ai-service/refresh-greetings"), env, actor);
    expect(r!.status).toBe(200);
    const data = await r!.json();
    expect(data.data.queued).toBe(1);
    expect(data.data.queue.processed).toBe(1);
    const status = await safe(handleParentRoutes, "/parent/ai-service/queue-status", "GET", makeRequest("GET", "/parent/ai-service/queue-status"), env, actor);
    const statusData = await status!.json();
    expect(statusData.data.pending).toBe(0);
    expect(statusData.data.completed).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("generates weekly and monthly report commentaries through the queue", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const fetchMock = stubChat("Report queue commentary");
    for (const periodType of ["weekly", "monthly"]) {
      const r = await safe(handleParentRoutes, "/parent/ai-service/refresh-commentaries", "POST", makeRequest("POST", "/parent/ai-service/refresh-commentaries", { periodType }), env, actor);
      expect(r!.status).toBe(200);
      const data = await r!.json();
      expect(data.data.queued).toBe(1);
    }
    const rows = env.DB.prepare("SELECT period_type, commentary FROM ai_report_commentaries WHERE child_id=? ORDER BY period_type").bind(childId).all().results as any[];
    expect(rows.map((row) => row.period_type)).toEqual(["monthly", "weekly"]);
    expect(rows.every((row) => row.commentary === "Report queue commentary")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("renders cached report commentary and generates missing commentary", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    const childId = await seedAiChild(1);
    await safe(handleParentRoutes, "/parent/ai-service", "PATCH", makeRequest("PATCH", "/parent/ai-service", { baseUrl: "https://api.example.com/v1", model: "gpt-a", prompt: "hello", apiKey: "sk-test" }), env, actor);
    const weeklyKey = reportWindowRange("weekly", "2026-06-03T00:00:00.000Z", 480).label;
    const weeklyHash = aiReportConfigHash({ baseUrl: "https://api.example.com/v1", model: "gpt-a", reportPrompt: "", monthlyPrompt: "" }, "weekly");
    env.DB.prepare("INSERT INTO ai_report_commentaries (child_id, parent_id, period_key, period_type, config_hash, commentary, generated_at) VALUES (?, ?, ?, 'weekly', ?, 'Cached commentary', '2026-06-01T00:00:00.000Z')")
      .bind(childId, parentId, weeklyKey, weeklyHash)
      .run();
    const fetchMock = stubChat("Generated monthly commentary");
    const weeklyReq = makeRequest("GET", `/children/${childId}/report?period=weekly&anchor=2026-06-03T00:00:00.000Z`);
    const weekly = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", weeklyReq, env, actor, new URL(weeklyReq.url));
    const weeklyHtml = await weekly!.text();
    expect(weeklyHtml).toContain("Cached commentary");
    const monthlyReq = makeRequest("GET", `/children/${childId}/report?period=monthly&anchor=2026-06-03T00:00:00.000Z`);
    const monthly = await safe(handleParentRoutes, `/children/${childId}/report`, "GET", monthlyReq, env, actor, new URL(monthlyReq.url));
    const monthlyHtml = await monthly!.text();
    expect(monthlyHtml).toContain("Generated monthly commentary");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("marks queue items failed when AI config is incomplete", async () => {
    const actor = { type: "user", role: "parent", id: parentId };
    await seedAiChild(1);
    const r = await safe(handleParentRoutes, "/parent/ai-service/refresh-greetings", "POST", makeRequest("POST", "/parent/ai-service/refresh-greetings"), env, actor);
    expect(r!.status).toBe(200);
    const status = await safe(handleParentRoutes, "/parent/ai-service/queue-status", "GET", makeRequest("GET", "/parent/ai-service/queue-status"), env, actor);
    const data = await status!.json();
    expect(data.data.pending).toBe(0);
    expect(data.data.failed).toBe(1);
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
