import { json, ok, fail, body, cookie, id, nowIso, checkLoginRateLimit, verifyPassword, hashPassword, actorFromRequest, sessionCookie, ensureParentDelegatesSchema } from "../utils.js";

export async function handleAuthRoutes(path, method, request, env, actor) {
    if (path === "/auth/me" && method === "GET")
        return ok(actor);
    if (path === "/auth/logout" && method === "POST") {
        const token = cookie(request, "session");
        if (token)
            await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
        return json({ data: true }, { headers: { "set-cookie": sessionCookie("", env, request).replace(/Max-Age=\d+/, "Max-Age=0") } });
    }
    if (path === "/auth/login" && method === "POST") {
        const input = await body(request);
        const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        await checkLoginRateLimit(env, `${clientIp}:${String(input.username || "")}`);
        const user = await env.DB.prepare("SELECT * FROM users WHERE username=? AND status='active' AND deleted_at IS NULL").bind(input.username).first();
        const child = user ? null : await env.DB.prepare("SELECT * FROM children WHERE username=? AND status='active' AND deleted_at IS NULL").bind(input.username).first();
        await ensureParentDelegatesSchema(env);
        const delegate = user || child ? null : await env.DB.prepare("SELECT * FROM parent_delegates WHERE username=? AND status='active' AND deleted_at IS NULL").bind(input.username).first();
        const account = user || child || delegate;
        if (!account)
            return fail("BAD_CREDENTIALS", "账号或密码错误", 401);
        // Reject default admin password for admin accounts (unless ALLOW_DEFAULT_ADMIN_PASSWORD=1)
        const isDefaultAdminPassword = account.role === "admin" && (env.ADMIN_PASSWORD || "change-me-admin-password") === "change-me-admin-password";
        if (isDefaultAdminPassword && env.ALLOW_DEFAULT_ADMIN_PASSWORD !== "1")
            return fail("SECURITY_ERROR", "请先修改默认管理员密码后再登录", 403);
        let passwordOk = false;
        try {
            passwordOk = await verifyPassword(input.password || "", account.password_hash);
        }
        catch (error) {
            if (account.role === "admin" && account.username === (env.ADMIN_USERNAME || "admin") && input.password === (env.ADMIN_PASSWORD || "change-me-admin-password")) {
                const passwordHash = await hashPassword(input.password || "");
                await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
                    .bind(passwordHash, nowIso(), account.id)
                    .run();
                passwordOk = true;
            }
            else {
                throw error;
            }
        }
        if (!passwordOk)
            return fail("BAD_CREDENTIALS", "账号或密码错误", 401);
        const token = id();
        const expires = new Date(Date.now() + 180 * 86400000).toISOString();
        const actorType = child ? "child" : "user";
        const actorId = delegate ? `delegate:${account.id}` : account.id;
        await env.DB.prepare("INSERT INTO sessions (token, actor_type, actor_id, expires_at) VALUES (?, ?, ?, ?)")
            .bind(token, actorType, actorId, expires)
            .run();
        return json({ data: { role: user ? user.role : child ? "child" : "parent_delegate", displayName: account.display_name, operatorLabel: account.operator_label || account.display_name } }, { headers: { "set-cookie": sessionCookie(token, env, request) } });
    }
    return null;
}
