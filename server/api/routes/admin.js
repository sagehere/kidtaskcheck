import { DEFAULT_TIMEZONE_OFFSET_MINUTES } from "../../../src/lib/domain.js";
import { ok, fail, json, body, id, nowIso, requireRole, hashPassword, verifyPassword, usernameExists, clampTimezoneOffset, timezoneOffsetMinutes, timezoneLabel, updateSetting, validateInput, INPUT_RULES, validateEnum, ensureSystemErrorLogs, cleanupSystemErrorLogs } from "../utils.js";

function parseMetadata(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

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
    if (path === "/admin/system-error-logs") {
        requireRole(actor, ["admin"]);
        await ensureSystemErrorLogs(env);
        if (method === "GET") {
            const url = new URL(request.url);
            const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 80)));
            const rows = await env.DB.prepare(`SELECT id, level, source, message, stack, status, method, path, actor_type, actor_id, metadata_json, created_at
FROM system_error_logs
ORDER BY created_at DESC
LIMIT ?`)
                .bind(limit)
                .all();
            return ok(rows.results.map((row) => ({
                ...row,
                metadata: parseMetadata(row.metadata_json)
            })));
        }
        if (method === "POST") {
            await cleanupSystemErrorLogs(env);
            return ok(true);
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
