import { bootstrap, fail, validateNonGetRequest, requireRole, actorFromRequest, ok, cookie, body, id, nowIso, json } from "./utils.js";
import { handleAuthRoutes } from "./routes/auth.js";
import { handleAdminRoutes } from "./routes/admin.js";
import { handleParentRoutes } from "./routes/parent.js";
import { handleChildRoutes } from "./routes/child.js";
import { handleSharedRoutes } from "./routes/shared.js";
import { runScheduledAiRefresh } from "./ai/index.js";

async function route(request, env, ctx) {
    await bootstrap(env);
    if (env.ENVIRONMENT === "production" && (env.ADMIN_PASSWORD || "change-me-admin-password") === "change-me-admin-password") {
        return fail("SERVER_ERROR", "请先修改默认管理员密码后再部署生产环境", 500);
    }
    const url = new URL(request.url);
    const path = `/${(url.pathname.replace(/^\/api\/?/, "") || "").replace(/^\/|\/$/g, "")}`;
    const method = request.method;
    const actor = await actorFromRequest(request, env);

    const result =
        (await handleAuthRoutes(path, method, request, env, actor)) ||
        (await handleAdminRoutes(path, method, request, env, actor)) ||
        (await handleParentRoutes(path, method, request, env, actor, url, ctx)) ||
        (await handleChildRoutes(path, method, request, env, actor, ctx)) ||
        (await handleSharedRoutes(path, method, request, env, actor, url));

    if (result) return result;
    return fail("NOT_FOUND", "接口不存在", 404);
}

export const onRequest = async ({ request, env, ctx }) => {
    try {
        validateNonGetRequest(request, env);
        return await route(request, env, ctx);
    }
    catch (error) {
        if (error instanceof Response)
            return error;
        const msg = String(error?.message || error || "");
        if (msg.includes("UNIQUE constraint")) {
            console.error("Constraint violation:", msg);
            return fail("DUPLICATE_OPERATION", "操作冲突，请重试", 409);
        }
        console.error("Unhandled error:", error?.stack || error);
        return fail("SERVER_ERROR", "服务器错误，请稍后重试", 500);
    }
};

export const onScheduled = async ({ scheduledTime, env }) => {
    await bootstrap(env);
    return runScheduledAiRefresh(env, scheduledTime ? new Date(scheduledTime) : new Date());
};
