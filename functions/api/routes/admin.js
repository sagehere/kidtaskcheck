import { DEFAULT_TIMEZONE_OFFSET_MINUTES } from "../../../src/lib/domain.js";
import { ok, fail, json, body, id, nowIso, requireRole, hashPassword, verifyPassword, usernameExists, clampTimezoneOffset, timezoneOffsetMinutes, timezoneLabel, updateSetting, batchRefreshGreetings, validateInput, INPUT_RULES, validateEnum, validateHttpsUrl } from "../utils.js";

export async function handleAdminRoutes(path, method, request, env, actor) {
    if (path === "/admin/users" && method === "GET") {
        requireRole(actor, ["admin"]);
        return ok((await env.DB.prepare("SELECT id, username, display_name, status, created_at FROM users WHERE role='parent' AND deleted_at IS NULL ORDER BY created_at DESC").all()).results);
    }
    if (path === "/admin/profile" && method === "PATCH") {
        const a = requireRole(actor, ["admin"]);
        const input = await body(request);
        const currentPassword = String(input.currentPassword || "");
        if (!currentPassword)
            return fail("BAD_REQUEST", "请输入当前密码");
        const admin = await env.DB.prepare("SELECT * FROM users WHERE id=? AND role='admin' AND status='active' AND deleted_at IS NULL").bind(a.id).first();
        if (!admin)
            return fail("NOT_FOUND", "管理员账号不存在", 404);
        if (!(await verifyPassword(currentPassword, admin.password_hash)))
            return fail("BAD_CREDENTIALS", "当前密码不正确", 401);
        const username = String(input.username || "").trim();
        if (!username)
            return fail("BAD_REQUEST", "请输入账号");
        if (await usernameExists(env, username, `user:${admin.id}`))
            return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
        const displayName = String(input.displayName || "").trim() || username;
        const newPassword = String(input.newPassword || "");
        const passwordHash = newPassword ? await hashPassword(newPassword) : admin.password_hash;
        await env.DB.prepare("UPDATE users SET username=?, display_name=?, password_hash=?, updated_at=? WHERE id=? AND role='admin'")
            .bind(username, displayName, passwordHash, nowIso(), admin.id)
            .run();
        return ok({ id: admin.id, username, displayName, role: "admin" });
    }
    if (path === "/admin/system-settings") {
        requireRole(actor, ["admin"]);
        if (method === "GET") {
            const offset = await timezoneOffsetMinutes(env);
            return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset) });
        }
        if (method === "PATCH") {
            const input = await body(request);
            const offset = clampTimezoneOffset(input.timezoneOffsetMinutes);
            if (!Number.isFinite(offset) || offset % 15 !== 0)
                return fail("BAD_REQUEST", "请输入有效时区，最小单位为 15 分钟");
            await env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES ('timezone_offset_minutes', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
                .bind(String(offset), nowIso())
                .run();
            return ok({ timezoneOffsetMinutes: offset, timezoneLabel: timezoneLabel(offset) });
        }
    }
    if (path === "/admin/users" && method === "POST") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        let err = validateInput(input.username, INPUT_RULES.username, "账号") || validateInput(input.displayName, INPUT_RULES.displayName, "显示名");
        if (err) return fail("BAD_REQUEST", err);
        const username = String(input.username || "").trim();
        if (await usernameExists(env, username))
            return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
        await env.DB.prepare("INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, 'parent', ?)")
            .bind(id(), username, await hashPassword(input.password || "123456"), input.displayName || username)
            .run();
        return ok(true);
    }
    const userDelete = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userDelete && method === "DELETE") {
        requireRole(actor, ["admin"]);
        const parentId = userDelete[1];
        await env.DB.prepare("UPDATE users SET deleted_at=?, status='disabled' WHERE id=? AND role='parent'").bind(nowIso(), parentId).run();
        await env.DB.prepare("UPDATE children SET deleted_at=?, status='disabled' WHERE parent_id=?").bind(nowIso(), parentId).run();
        for (const table of ["tasks", "rewards", "achievements"]) {
            await env.DB.prepare(`UPDATE ${table} SET deleted_at=?, is_active=0 WHERE parent_id=?`).bind(nowIso(), parentId).run();
        }
        await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE owner_id=?").bind(parentId).run();
        return ok(true);
    }
    const userPatch = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userPatch && method === "PATCH") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        if (input.password) {
            await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=? AND role='parent'").bind(await hashPassword(input.password), nowIso(), userPatch[1]).run();
        }
        if (input.displayName) {
            await env.DB.prepare("UPDATE users SET display_name=?, updated_at=? WHERE id=? AND role='parent'").bind(input.displayName, nowIso(), userPatch[1]).run();
        }
        if (input.status) {
            const statusErr = validateEnum(input.status, ["active", "disabled"], "状态");
            if (statusErr) return fail("BAD_REQUEST", statusErr);
            await env.DB.prepare("UPDATE users SET status=?, updated_at=? WHERE id=? AND role='parent'").bind(input.status, nowIso(), userPatch[1]).run();
        }
        return ok(true);
    }
    if (path === "/admin/ai-service" && method === "GET") {
        requireRole(actor, ["admin"]);
        const baseUrl = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_base_url'").first();
        const model = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_model'").first();
        const prompt = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_prompt'").first();
        const hasKey = await env.DB.prepare("SELECT 1 FROM system_settings WHERE key='ai_api_key' AND value!=''").first();
        return ok({
            baseUrl: baseUrl?.value || "",
            model: model?.value || "",
            prompt: prompt?.value || "你是一位温暖、具体、不过度夸张的家庭成长教练。请根据孩子上一周的周报数据，并结合孩子的年龄与性别信息，写一段给孩子看的中文寄语：先肯定一个具体进步，再给一个可执行的小建议。语气亲切、有鼓励感，不说教，不提数据库或系统。总长度控制在120个汉字以内。",
            hasKey: !!hasKey
        });
    }
    if (path === "/admin/ai-service" && method === "PATCH") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        if (input.baseUrl !== undefined) {
            const urlErr = validateHttpsUrl(input.baseUrl, "AI Base URL");
            if (urlErr) return fail("BAD_REQUEST", urlErr);
            await updateSetting(env, "ai_base_url", String(input.baseUrl));
        }
        if (input.apiKey !== undefined && String(input.apiKey).trim()) {
            await updateSetting(env, "ai_api_key", String(input.apiKey));
        }
        if (input.model !== undefined) {
            await updateSetting(env, "ai_model", String(input.model));
        }
        if (input.prompt !== undefined) {
            await updateSetting(env, "ai_prompt", String(input.prompt));
        }
        return ok(true);
    }
    if (path === "/admin/ai-service/refresh-greetings" && method === "POST") {
        requireRole(actor, ["admin"]);
        const offset = await timezoneOffsetMinutes(env);
        const result = await batchRefreshGreetings(env, offset);
        return ok(result);
    }
    if (path === "/admin/ai-service/models" && method === "POST") {
        requireRole(actor, ["admin"]);
        const input = await body(request);
        const baseUrl = String(input.baseUrl || "").replace(/\/+$/, "");
        if (!baseUrl)
            return fail("BAD_REQUEST", "请先设置 baseUrl");
        const urlErr = validateHttpsUrl(baseUrl, "AI Base URL");
        if (urlErr) return fail("BAD_REQUEST", urlErr);
        const apiKey = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_api_key'").first();
        const key = env.AI_API_KEY || String(input.apiKey && String(input.apiKey).trim() ? input.apiKey : apiKey?.value || "");
        const headers = { "content-type": "application/json" };
        if (key)
            headers["authorization"] = `Bearer ${key}`;
        try {
            const resp = await fetch(`${baseUrl}/models`, { headers });
            if (!resp.ok)
                return fail("AI_SERVICE_ERROR", `获取模型列表失败：${resp.status}`, 502);
            const body = await resp.json();
            const models = (body.data || []).map((item) => item.id);
            return ok({ models });
        }
        catch (err) {
            return fail("AI_SERVICE_ERROR", "无法连接 AI 服务", 502);
        }
    }
    if (path === "/admin/gallery-images") {
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM gallery_images WHERE is_active=1 ORDER BY created_at DESC").all()).results);
        requireRole(actor, ["admin"]);
        const input = await body(request);
        if (method === "POST") {
            try {
                const gUrl = new URL(input.url);
                const allowedSchemes = env.ENVIRONMENT === "production" ? ["https:"] : ["https:", "http:"];
                if (!allowedSchemes.includes(gUrl.protocol))
                    return fail("BAD_REQUEST", env.ENVIRONMENT === "production" ? "生产环境图片 URL 必须使用 HTTPS 协议" : "图片 URL 必须使用 http 或 https 协议");
            } catch {
                return fail("BAD_REQUEST", "图片 URL 格式不正确");
            }
            await env.DB.prepare("INSERT INTO gallery_images (id, name, url, usage, is_active) VALUES (?, ?, ?, ?, 1)")
                .bind(id(), input.name, input.url, input.usage || "general")
                .run();
            return ok(true);
        }
    }
    return null;
}
