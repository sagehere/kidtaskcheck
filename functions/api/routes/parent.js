import { DEFAULT_TIMEZONE_OFFSET_MINUTES, normalizeWeekdays, isWeekdayAllowed, periodKey, prerequisitePeriodKey, signedPoints, nextPeriodReset, reportWindowRange } from "../../../src/lib/domain.js";
import { ok, fail, body, id, nowIso, requireRole, validateInput, INPUT_RULES, validateEnum, weekdayJson, replaceAssignees, validateChildIds, validateTaskIds, validateCategoryOwnership, usernameExists, hashPassword, timezoneOffsetMinutes, timezoneLabel, settingNumber, localTimeText, escapeHtml, childUsageForPeriod, childUsageCountsForPeriods, childLatestTaskStatuses, rewardLockedByAchievement, unmetRewardPrerequisites, balance, balancesForChildren, recalcAchievements, notify, rewardPrerequisites, replaceRewardPrerequisites, replaceRewardAchievementRequirement, deleteAchievementWithExclusiveReward, listWithAssignees, normalizeAchievementInput, validateHttpsUrl, ensureRewardOnceSchema } from "../utils.js";
import { generateParentAiGreeting, getParentAiServiceConfig, generateReportCommentary, aiReportConfigHash, ensureAiReportCommentaries, AI_FETCH_TIMEOUT_MS, enqueueAiGeneration, processAiQueue, getAiQueueStatus, listModels } from "../ai/index.js";

async function scheduleAiQueueProcessing(env, ctx) {
    const work = processAiQueue(env);
    if (ctx?.waitUntil) {
        ctx.waitUntil(work);
        return { scheduled: true, processed: 0, failed: 0 };
    }
    const result = await work;
    return { scheduled: false, ...result };
}

export async function handleParentRoutes(path, method, request, env, actor, url, ctx) {
    if (path === "/parent/profile" && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const currentPassword = String(input.currentPassword || "");
        if (!currentPassword)
            return fail("BAD_REQUEST", "请输入当前密码");
        const parent = await env.DB.prepare("SELECT * FROM users WHERE id=? AND role='parent' AND status='active' AND deleted_at IS NULL").bind(a.id).first();
        if (!parent)
            return fail("NOT_FOUND", "家长账号不存在", 404);
        if (!(await verifyPassword(currentPassword, parent.password_hash)))
            return fail("BAD_CREDENTIALS", "当前密码不正确", 401);
        const newPassword = String(input.newPassword || "");
        if (!newPassword)
            return fail("BAD_REQUEST", "请输入新密码");
        const passwordHash = await hashPassword(newPassword);
        await env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=? AND role='parent'")
            .bind(passwordHash, nowIso(), a.id).run();
        return ok(true);
    }
    if (path === "/parent/ai-service" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const config = await getParentAiServiceConfig(env, a.id);
        return ok({
            baseUrl: config.baseUrl,
            model: config.model,
            prompt: config.prompt,
            reportPrompt: config.reportPrompt,
            monthlyPrompt: config.monthlyPrompt,
            hasKey: config.hasKey,
            updatedAt: config.updatedAt
        });
    }
    if (path === "/parent/ai-service" && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const current = await getParentAiServiceConfig(env, a.id);
        const nextBaseUrl = input.baseUrl !== undefined ? String(input.baseUrl).trim().replace(/\/+$/, "") : current.baseUrl;
        const nextModel = input.model !== undefined ? String(input.model).trim() : current.model;
        const nextPrompt = input.prompt !== undefined ? String(input.prompt).trim() : current.prompt;
        const nextReportPrompt = input.reportPrompt !== undefined ? String(input.reportPrompt).trim() : (current.reportPrompt || "");
        const nextMonthlyPrompt = input.monthlyPrompt !== undefined ? String(input.monthlyPrompt).trim() : (current.monthlyPrompt || "");
        if (!nextBaseUrl || !nextModel || !nextPrompt)
            return fail("BAD_REQUEST", "请完整填写 AI 服务配置");
        const urlErr = validateHttpsUrl(nextBaseUrl, "AI Base URL");
        if (urlErr)
            return fail("BAD_REQUEST", urlErr);
        const nextApiKey = input.apiKey !== undefined && String(input.apiKey).trim() ? String(input.apiKey).trim() : current.apiKey;
        const updatedAt = nowIso();
        await env.DB.prepare(`INSERT INTO parent_ai_service_settings (parent_id, base_url, api_key, model, prompt, report_prompt, monthly_prompt, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(parent_id) DO UPDATE SET base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, prompt=excluded.prompt, report_prompt=excluded.report_prompt, monthly_prompt=excluded.monthly_prompt, updated_at=excluded.updated_at`)
            .bind(a.id, nextBaseUrl, nextApiKey, nextModel, nextPrompt, nextReportPrompt, nextMonthlyPrompt, updatedAt)
            .run();
        return ok({ baseUrl: nextBaseUrl, model: nextModel, prompt: nextPrompt, reportPrompt: nextReportPrompt, monthlyPrompt: nextMonthlyPrompt, hasKey: !!nextApiKey, updatedAt });
    }
    if (path === "/parent/ai-service/models" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const current = await getParentAiServiceConfig(env, a.id);
        const baseUrl = String(input.baseUrl || current.baseUrl || "").replace(/\/+$/, "");
        if (!baseUrl)
            return fail("BAD_REQUEST", "请先设置 baseUrl");
        const urlErr = validateHttpsUrl(baseUrl, "AI Base URL");
        if (urlErr)
            return fail("BAD_REQUEST", urlErr);
        const apiKey = input.apiKey !== undefined && String(input.apiKey).trim() ? String(input.apiKey).trim() : current.apiKey;
        const headers = { "content-type": "application/json" };
        if (apiKey)
            headers["authorization"] = `Bearer ${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
        try {
            const resp = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal, redirect: "manual" });
            clearTimeout(timeoutId);
            if (resp.status === 0 || resp.type === "opaqueredirect")
                return fail("AI_SERVICE_ERROR", "AI service redirects are not allowed", 502);
            if (!resp.ok)
                return fail("AI_SERVICE_ERROR", `获取模型列表失败：${resp.status}`, 502);
            const body = await resp.json().catch(() => ({}));
            let raw = [];
            if (Array.isArray(body.data)) {
                raw = body.data;
            } else if (Array.isArray(body.models)) {
                raw = body.models;
            } else if (Array.isArray(body)) {
                raw = body;
            }
            const models = raw
                .map((item) => (typeof item === "string" ? item : item?.id || item?.name || item?.model))
                .filter((value) => typeof value === "string" && value.trim())
                .map((value) => value.trim());
            return ok({ models });
        }
        catch (error) {
            clearTimeout(timeoutId);
            const name = error?.name || "";
            if (name === "AbortError")
                return fail("AI_SERVICE_ERROR", "AI 服务请求超时", 502);
            return fail("AI_SERVICE_ERROR", "无法连接 AI 服务", 502);
        }
    }
    if (path === "/parent/ai-service/test" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const current = await getParentAiServiceConfig(env, a.id);
        const baseUrl = String(input.baseUrl || current.baseUrl || "").replace(/\/+$/, "");
        const apiKey = input.apiKey !== undefined && String(input.apiKey).trim() ? String(input.apiKey).trim() : current.apiKey;
        const model = String(input.model || current.model || "");
        if (!baseUrl) return ok({ ok: false, error: "请先设置 Base URL" });
        const urlErr = validateHttpsUrl(baseUrl, "AI Base URL");
        if (urlErr) return ok({ ok: false, error: urlErr });
        try {
            const models = await listModels(baseUrl, apiKey);
            if (models.length > 0) return ok({ ok: true, models });
            if (!model) return ok({ ok: false, error: "Base URL 连接成功但未返回模型列表，请确认 URL 是否正确" });
            return ok({ ok: true, models: [], note: "连接成功，但未获取到模型列表" });
        }
        catch (error) {
            const msg = error?.message || String(error || "");
            if (msg.includes("timed out") || msg.includes("abort") || msg.includes("AbortError"))
                return ok({ ok: false, error: "连接超时，请检查 Base URL 是否正确" });
            return ok({ ok: false, error: "无法连接，请检查 Base URL 和 API Key" });
        }
    }
    if (path === "/parent/ai-service/refresh-greetings" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const offset = await timezoneOffsetMinutes(env);
        const children = await env.DB.prepare("SELECT id, ai_enabled FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all();
        const now = nowIso();
        const range = reportWindowRange("weekly", now, offset);
        const weekKey = periodKey("weekly", range.start, offset);
        let queued = 0;
        for (const child of children.results) {
            if (!child.ai_enabled) continue;
            await enqueueAiGeneration(env, a.id, child.id, "greeting", weekKey);
            queued++;
        }
        const queue = await scheduleAiQueueProcessing(env, ctx);
        return ok({ queued, queue });
    }
    if (path === "/parent/ai-service/refresh-commentaries" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const offset = await timezoneOffsetMinutes(env);
        const input = await body(request);
        const periodType = input?.periodType === "monthly" ? "monthly" : "weekly";
        const children = await env.DB.prepare("SELECT id, ai_enabled FROM children WHERE parent_id=? AND deleted_at IS NULL").bind(a.id).all();
        const now = nowIso();
        const range = reportWindowRange(periodType, now, offset);
        const pkey = range.label;
        let queued = 0;
        for (const child of children.results) {
            if (!child.ai_enabled) continue;
            await enqueueAiGeneration(env, a.id, child.id, `report_${periodType}`, pkey);
            queued++;
        }
        const queue = await scheduleAiQueueProcessing(env, ctx);
        return ok({ queued, queue });
    }
    if (path === "/parent/ai-service/queue-status" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const status = await getAiQueueStatus(env, a.id);
        return ok(status);
    }
    if (path === "/parent/ai-service/process-queue" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const result = await processAiQueue(env);
        return ok({ triggered: true, ...result });
    }
    if (path === "/children") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT id, username, display_name, status, ai_enabled, gender, birth_date FROM children WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const username = String(input.username || "").trim();
            if (!username)
                return fail("BAD_REQUEST", "请输入账号");
            if (await usernameExists(env, username))
                return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
            await env.DB.prepare("INSERT INTO children (id, parent_id, username, password_hash, display_name, ai_enabled, gender, birth_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), a.id, username, await hashPassword(input.password || "123456"), input.displayName || username, input.aiEnabled ? 1 : 0, input.gender || "", input.birthDate || null)
                .run();
            return ok(true);
        }
    }
    const childPatch = path.match(/^\/children\/([^/]+)$/);
    if (childPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(childPatch[1], a.id).first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const updates = [];
        const params = [];
        if (input.displayName !== undefined) {
            updates.push("display_name=?");
            params.push(input.displayName);
        }
        if (input.password) {
            updates.push("password_hash=?");
            params.push(await hashPassword(input.password));
        }
        if (input.status !== undefined) {
            const statusErr = validateEnum(input.status, ["active", "disabled"], "状态");
            if (statusErr) return fail("BAD_REQUEST", statusErr);
            updates.push("status=?");
            params.push(input.status);
        }
        if (input.aiEnabled !== undefined) {
            updates.push("ai_enabled=?");
            params.push(input.aiEnabled ? 1 : 0);
        }
        if (input.gender !== undefined) {
            if (input.gender && !["male", "female"].includes(input.gender))
                return fail("BAD_REQUEST", "性别取值须为 male、female 或空", 400);
            updates.push("gender=?");
            params.push(input.gender || "");
        }
        if (input.birthDate !== undefined) {
            if (input.birthDate) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.birthDate)))
                    return fail("BAD_REQUEST", "出生日期格式须为 YYYY-MM-DD", 400);
                if (String(input.birthDate) > nowIso().slice(0, 10))
                    return fail("BAD_REQUEST", "出生日期不能晚于今天", 400);
            }
            updates.push("birth_date=?");
            params.push(input.birthDate || null);
        }
        if (updates.length) {
            params.push(nowIso(), childPatch[1]);
            await env.DB.prepare(`UPDATE children SET ${updates.join(", ")}, updated_at=? WHERE id=?`).bind(...params).run();
        }
        return ok(true);
    }
    if (childPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        await env.DB.prepare("UPDATE children SET deleted_at=?, status='disabled', updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(nowIso(), nowIso(), childPatch[1], a.id)
            .run();
        return ok(true);
    }
    const childExport = path.match(/^\/children\/([^/]+)\/export-print$/);
    if (childExport && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childExport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const [tasks, rewards, feedbackTemplates] = await Promise.all([
            env.DB.prepare(`SELECT t.*, tc.name category_name FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL
ORDER BY tc.name, t.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare(`SELECT r.* FROM rewards r
JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(a.id).all()
        ]);
        const table = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} 打印清单</title><style>body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2933}h1{margin:0 0 8px}h2{margin-top:28px;border-bottom:2px solid #111;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top}th{background:#f0f0f0}@media print{button{display:none}body{margin:12mm}}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} 打印清单</h1><p>导出时间：${escapeHtml(localTimeText(nowIso(), await timezoneOffsetMinutes(env)))}</p><h2>任务</h2>${table(["标题","分类","周期","次数","积分","周","状态","说明"], tasks.results.map((item) => [item.title, item.category_name || "", item.period, item.limit_count || 1, item.points, normalizeWeekdays(item.enabled_weekdays).join(","), item.is_active ? "启用" : "停用", item.description || ""]))}<h2>奖励</h2>${table(["名称","所需积分","限制周期","次数","核销周几","状态","说明"], rewards.results.map((item) => [item.title, item.cost_points, item.limit_period, item.limit_count || "", normalizeWeekdays(item.redeem_weekdays).join(","), item.is_active ? "启用" : "停用", item.description || ""]))}<h2>表扬与批评条款</h2>${table(["类型","标题","积分","状态","说明"], feedbackTemplates.results.map((item) => [item.kind === "praise" ? "表扬" : "批评", item.title, item.points, item.is_active ? "启用" : "停用", item.description || ""]))}</body></html>`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childAiGreeting = path.match(/^\/children\/([^/]+)\/ai-greeting$/);
    if (childAiGreeting && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childAiGreeting[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const offset = await timezoneOffsetMinutes(env);
        let greeting = "";
        try {
            greeting = await generateParentAiGreeting(env, child, offset, true);
        } catch (error) {
            if (error?.name !== "NonRetryableError")
                throw error;
        }
        return ok({ greeting });
    }
    const childReportCommentary = path.match(/^\/children\/([^/]+)\/report-commentary$/);
    if (childReportCommentary && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childReportCommentary[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const offset = await timezoneOffsetMinutes(env);
        const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
        const periodKey = reportWindowRange(period, nowIso(), offset).label;
        await ensureAiReportCommentaries(env);
        let commentary = "";
        try {
            commentary = await generateReportCommentary(env, child, period, periodKey, offset, true);
        } catch (error) {
            if (error?.name !== "NonRetryableError")
                throw error;
        }
        return ok({ commentary });
    }
    const childReport = path.match(/^\/children\/([^/]+)\/report$/);
    if (childReport && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id, display_name, ai_enabled, gender, birth_date, parent_id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childReport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const offset = await timezoneOffsetMinutes(env);
        const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
        const anchor = url.searchParams.get("anchor") || nowIso();
        const range = reportWindowRange(period, anchor, offset);
        const periodKey = range.label;
        const [ledgerRows, taskRows, rewardRows, feedbackRows, achievementRows] = await Promise.all([
            env.DB.prepare("SELECT * FROM point_ledger WHERE child_id=? AND parent_id=? AND created_at>=? AND created_at<? ORDER BY created_at DESC").bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT s.*, t.title, tc.name category_name
FROM task_submissions s
JOIN tasks t ON t.id=s.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE s.child_id=? AND s.parent_id=? AND s.submitted_at>=? AND s.submitted_at<?
ORDER BY s.submitted_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT rr.*, r.title, r.cost_points
FROM reward_redemptions rr
JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.requested_at>=? AND rr.requested_at<?
ORDER BY rr.requested_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT pl.*, ft.title template_title
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=? AND pl.created_at<?
ORDER BY pl.created_at DESC`).bind(child.id, a.id, range.start, range.end).all(),
            env.DB.prepare(`SELECT a.title, ca.unlocked_at
FROM child_achievements ca
JOIN achievements a ON a.id=ca.achievement_id
WHERE ca.child_id=? AND a.parent_id=? AND ca.unlocked_at>=? AND ca.unlocked_at<?
ORDER BY ca.unlocked_at DESC`).bind(child.id, a.id, range.start, range.end).all()
        ]);
        const ledger = ledgerRows.results;
        const tasks = taskRows.results;
        const rewards = rewardRows.results;
        const feedback = feedbackRows.results;
        const achievements = achievementRows.results;
        const netPoints = ledger.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const currentBalance = await balance(env, child.id);
        const approved = tasks.filter((row) => row.status === "approved").length;
        const rejected = tasks.filter((row) => row.status === "rejected").length;
        const pending = tasks.filter((row) => row.status === "pending").length;
        const categoryCounts = [...tasks.filter((row) => row.status === "approved").reduce((map, row) => map.set(row.category_name || "未分类", (map.get(row.category_name || "未分类") || 0) + 1), new Map()).entries()];
        const tableHtml = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table>`;
        const reportTitle = period === "monthly" ? "月度报告" : "周度报告";
        let commentary = "";
        if (child.ai_enabled) {
            try {
                const config = await getParentAiServiceConfig(env, child.parent_id);
                if (config.baseUrl && config.apiKey && config.model) {
                    await ensureAiReportCommentaries(env);
                    const hash = aiReportConfigHash(config, period);
                    const cached = await env.DB.prepare("SELECT commentary FROM ai_report_commentaries WHERE child_id=? AND period_key=? AND period_type=? AND config_hash=?")
                        .bind(child.id, periodKey, period, hash)
                        .first();
                    if (cached?.commentary) {
                        commentary = cached.commentary;
                    }
                    else {
                        commentary = await generateReportCommentary(env, child, period, periodKey, offset);
                    }
                }
            } catch (error) {
                console.warn("AI report commentary skipped:", error?.message || error);
            }
        }
        const commentarySection = commentary ? `<div class="ai-commentary"><h2>AI 评语</h2><p>${escapeHtml(commentary)}</p><p class="note">* 评语由 AI 生成，仅供参考</p></div>` : "";
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} ${reportTitle}</title><style>body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2933}button{margin-bottom:16px}h1{margin:0 0 8px}h2{margin-top:28px;border-bottom:2px solid #111;padding-bottom:6px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.summary div{border:1px solid #999;padding:10px}.summary strong{display:block;font-size:24px}.ai-commentary{background:#f0f4ff;border-left:4px solid #6366f1;padding:16px 20px;margin:18px 0;border-radius:4px}.ai-commentary h2{margin:0 0 8px;border:none;padding:0}.ai-commentary p{margin:4px 0;line-height:1.8}.ai-commentary .note{font-size:12px;color:#888;margin-top:8px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top}th{background:#f0f0f0}@media print{button{display:none}body{margin:12mm}.summary{grid-template-columns:repeat(2,1fr)}}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} ${reportTitle}</h1><p>周期：${escapeHtml(localTimeText(range.start, offset))} 至 ${escapeHtml(localTimeText(range.end, offset))}；生成时间：${escapeHtml(localTimeText(nowIso(), offset))}</p>${commentarySection}<div class="summary"><div><span>当前积分</span><strong>${currentBalance}</strong></div><div><span>本期积分</span><strong>${netPoints >= 0 ? "+" : ""}${netPoints}</strong></div><div><span>任务通过</span><strong>${approved}</strong></div><div><span>成就解锁</span><strong>${achievements.length}</strong></div></div><h2>任务概览</h2>${tableHtml(["通过","待审","驳回"], [[approved, pending, rejected]])}<h2>分类完成</h2>${tableHtml(["分类","通过次数"], categoryCounts)}<h2>奖励记录</h2>${tableHtml(["奖励","状态","积分","申请时间"], rewards.map((item) => [item.title, item.status, item.cost_points, localTimeText(item.requested_at, offset)]))}<h2>表扬与批评</h2>${tableHtml(["类型","条款","积分","时间"], feedback.map((item) => [item.source_type === "praise" ? "表扬" : "批评", item.template_title || item.note || "", item.amount, localTimeText(item.created_at, offset)]))}<h2>成就解锁</h2>${tableHtml(["成就","解锁时间"], achievements.map((item) => [item.title, localTimeText(item.unlocked_at, offset)]))}</body></html>`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childWarehouse = path.match(/^\/children\/([^/]+)\/warehouse$/);
    if (childWarehouse && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(childWarehouse[1], a.id).first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        return ok((await env.DB.prepare(`SELECT rr.*, r.title, r.description, r.icon_type, r.icon_value, r.cost_points, r.redeem_weekdays
FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id
WHERE rr.child_id=? AND rr.parent_id=? AND rr.status='redeemed'
ORDER BY rr.requested_at DESC`).bind(child.id, a.id).all()).results);
    }
    const feedbackEvent = path.match(/^\/children\/([^/]+)\/feedback-events$/);
    if (feedbackEvent && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(feedbackEvent[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const shortDays = await settingNumber(env, "short_record_retention_days", 7);
        const cutoff = new Date(Date.now() - shortDays * 86400000).toISOString();
        const rows = (await env.DB.prepare(`SELECT pl.*, ft.title template_title, ft.kind template_kind
FROM point_ledger pl
LEFT JOIN feedback_templates ft ON ft.id=pl.source_id
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND pl.created_at>=?
ORDER BY pl.created_at DESC`)
            .bind(child.id, a.id, cutoff)
            .all()).results;
        const offset = await timezoneOffsetMinutes(env);
        return ok(rows.map((row) => ({ ...row, localCreatedAt: localTimeText(row.created_at, offset) })));
    }
    if (feedbackEvent && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(feedbackEvent[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const template = await env.DB.prepare("SELECT * FROM feedback_templates WHERE id=? AND parent_id=? AND is_active=1 AND deleted_at IS NULL")
            .bind(input.templateId, a.id)
            .first();
        if (!template)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        const ledgerId = id();
        const points = Math.abs(Number(template.points || 0));
        const amount = template.kind === "praise" ? points : -points;
        const label = template.kind === "praise" ? "表扬" : "批评";
        const note = template.description ? `${template.title}：${template.description}` : template.title;
        await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
            .bind(ledgerId, child.id, a.id, amount, template.kind, template.id, note)
            .run();
        await recalcAchievements(env, a.id, child.id);
        await notify(env, {
            recipientType: "child",
            recipientId: child.id,
            actorType: "user",
            actorId: a.id,
            title: `收到一条${label}`,
            body: `${note}，${amount >= 0 ? "增加" : "扣除"} ${points} 积分。`,
            eventType: template.kind,
            relatedType: "point_ledger",
            relatedId: ledgerId,
            requiresAck: true
        });
        return ok(true);
    }
    if (path === "/feedback-templates") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const kind = input.kind === "criticism" ? "criticism" : "praise";
            await env.DB.prepare("INSERT INTO feedback_templates (id, parent_id, kind, title, description, points, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id(), a.id, kind, input.title, input.description || "", Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1)
                .run();
            return ok(true);
        }
    }
    const feedbackPatch = path.match(/^\/feedback-templates\/([^/]+)$/);
    if (feedbackPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const kind = input.kind === "criticism" ? "criticism" : "praise";
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        await env.DB.prepare("UPDATE feedback_templates SET kind=?, title=?, description=?, points=?, icon_type=?, icon_value=?, is_active=?, updated_at=? WHERE id=?")
            .bind(kind, input.title, input.description || "", Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1, nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (feedbackPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        await env.DB.prepare("UPDATE feedback_templates SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/task-categories") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET") {
            return ok((await env.DB.prepare("SELECT * FROM task_categories WHERE is_active=1 AND ((is_system=1 AND id NOT IN (SELECT source_system_id FROM task_categories WHERE owner_id=? AND source_system_id IS NOT NULL)) OR owner_id=?) ORDER BY is_system DESC, created_at DESC").bind(a.id, a.id).all()).results);
        }
        const input = await body(request);
        if (method === "POST") {
            await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system) VALUES (?, ?, ?, ?, ?, 0)")
                .bind(id(), a.id, input.name, input.iconType || "emoji", input.iconValue || "⭐")
                .run();
            return ok(true);
        }
    }
    const categoryPatch = path.match(/^\/task-categories\/([^/]+)$/);
    if (categoryPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const category = await env.DB.prepare("SELECT * FROM task_categories WHERE id=? AND is_active=1 AND (owner_id=? OR is_system=1)")
            .bind(categoryPatch[1], a.id)
            .first();
        if (!category)
            return fail("NOT_FOUND", "任务分类不存在或不可编辑", 404);
        let targetId = category.id;
        if (category.is_system) {
            const existing = await env.DB.prepare("SELECT id FROM task_categories WHERE owner_id=? AND name=? AND is_system=0 AND is_active=1")
                .bind(a.id, category.name)
                .first();
            targetId = existing?.id || id();
            if (!existing) {
                await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system, source_system_id) VALUES (?, ?, ?, ?, ?, 0, ?)")
                    .bind(targetId, a.id, category.name, category.icon_type, category.icon_value, category.id)
                    .run();
            }
        }
        await env.DB.prepare("UPDATE task_categories SET name=?, icon_type=?, icon_value=? WHERE id=? AND owner_id=?")
            .bind(input.name, input.iconType || "emoji", input.iconValue || "⭐", targetId, a.id)
            .run();
        return ok(true);
    }
    if (categoryPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const category = await env.DB.prepare("SELECT * FROM task_categories WHERE id=? AND is_active=1 AND (owner_id=? OR is_system=1)")
            .bind(categoryPatch[1], a.id)
            .first();
        if (!category)
            return fail("NOT_FOUND", "任务分类不存在", 404);
        const deletedAt = nowIso();
        let targetId = category.id;
        if (category.is_system) {
            const existing = await env.DB.prepare("SELECT id FROM task_categories WHERE owner_id=? AND source_system_id=?")
                .bind(a.id, category.id)
                .first();
            targetId = existing?.id || id();
            if (existing) {
                await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE id=? AND owner_id=?")
                    .bind(targetId, a.id)
                    .run();
            }
            else {
                await env.DB.prepare("INSERT INTO task_categories (id, owner_id, name, icon_type, icon_value, is_system, is_active, source_system_id) VALUES (?, ?, ?, ?, ?, 0, 0, ?)")
                    .bind(targetId, a.id, category.name, category.icon_type, category.icon_value, category.id)
                    .run();
            }
        }
        else {
            await env.DB.prepare("UPDATE task_categories SET is_active=0 WHERE id=? AND owner_id=?")
                .bind(targetId, a.id)
                .run();
        }
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE parent_id=? AND category_id=? AND deleted_at IS NULL")
            .bind(deletedAt, deletedAt, a.id, category.id)
            .run();
        if (targetId !== category.id) {
            await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE parent_id=? AND category_id=? AND deleted_at IS NULL")
                .bind(deletedAt, deletedAt, a.id, targetId)
                .run();
        }
        return ok(true);
    }
    if (path === "/tasks") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "tasks", a.id));
        const input = await body(request);
        if (method === "POST") {
            const title = String(input.title || "").trim();
            const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
                || validateEnum(input.period || "daily", ["daily", "weekly", "monthly", "once"], "周期")
                || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型");
            if (err) return fail("BAD_REQUEST", err, 400);
            await validateCategoryOwnership(env, a.id, input.categoryId);
            const taskId = id();
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, a.id, input.categoryId, title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1)
                .run();
            await replaceAssignees(env, a.id, "task_assignees", "task_id", taskId, input.childIds || []);
            return ok(true);
        }
    }
    const taskPatch = path.match(/^\/tasks\/([^/]+)$/);
    if (taskPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        const title = String(input.title || "").trim();
        const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
            || validateEnum(input.period || "daily", ["daily", "weekly", "monthly", "once"], "周期")
            || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型");
        if (err) return fail("BAD_REQUEST", err, 400);
        await validateCategoryOwnership(env, a.id, input.categoryId);
        await env.DB.prepare("UPDATE tasks SET category_id=?, title=?, description=?, period=?, point_type=?, points=?, icon_type=?, icon_value=?, limit_count=?, enabled_weekdays=?, is_active=?, updated_at=? WHERE id=?")
            .bind(input.categoryId, title, input.description || "", input.period || "daily", "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1, nowIso(), taskPatch[1])
            .run();
        await replaceAssignees(env, a.id, "task_assignees", "task_id", taskPatch[1], input.childIds || []);
        return ok(true);
    }
    if (taskPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), taskPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/rewards") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok(await listWithAssignees(env, "rewards", a.id));
        const input = await body(request);
        if (method === "POST") {
            const title = String(input.title || "").trim();
            const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.costPoints, INPUT_RULES.costPoints, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
                || validateEnum(input.limitPeriod || "daily", ["none", "daily", "weekly", "monthly", "once"], "限制周期")
                || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型")
                || (input.stock !== undefined && input.stock !== null ? validateInput(input.stock, INPUT_RULES.stock, "库存") : null);
            if (err) return fail("BAD_REQUEST", err, 400);
            await ensureRewardOnceSchema(env);
            const rewardId = id();
            const requiredAchievementId = input.requiredAchievementId || input.required_achievement_id || "";
            if (requiredAchievementId) {
                const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
                    .bind(requiredAchievementId, a.id)
                    .first();
                if (!achievement)
                    return fail("NOT_FOUND", "成就称号不存在", 404);
            }
            await env.DB.prepare("INSERT INTO rewards (id, parent_id, title, description, cost_points, stock, limit_period, limit_count, redeem_weekdays, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(rewardId, a.id, title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, weekdayJson(input.redeemWeekdays || input.redeem_weekdays), input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1)
                .run();
            await replaceAssignees(env, a.id, "reward_assignees", "reward_id", rewardId, input.childIds || []);
            await replaceRewardPrerequisites(env, a.id, rewardId, input.prerequisites || []);
            await replaceRewardAchievementRequirement(env, a.id, rewardId, requiredAchievementId);
            return ok(true);
        }
    }
    const rewardPatch = path.match(/^\/rewards\/([^/]+)$/);
    if (rewardPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        await ensureRewardOnceSchema(env);
        const reward = await env.DB.prepare("SELECT id FROM rewards WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(rewardPatch[1], a.id)
            .first();
        if (!reward)
            return fail("NOT_FOUND", "奖励不存在", 404);
        const title = String(input.title || "").trim();
        const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.costPoints, INPUT_RULES.costPoints, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
            || validateEnum(input.limitPeriod || "daily", ["none", "daily", "weekly", "monthly", "once"], "限制周期")
            || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型")
            || (input.stock !== undefined && input.stock !== null ? validateInput(input.stock, INPUT_RULES.stock, "库存") : null);
        if (err) return fail("BAD_REQUEST", err, 400);
        const requiredAchievementId = input.requiredAchievementId || input.required_achievement_id || "";
        if (!(await replaceRewardAchievementRequirement(env, a.id, rewardPatch[1], requiredAchievementId)))
            return fail("NOT_FOUND", "成就称号不存在", 404);
        await env.DB.prepare("UPDATE rewards SET title=?, description=?, cost_points=?, stock=?, limit_period=?, limit_count=?, redeem_weekdays=?, icon_type=?, icon_value=?, is_active=?, updated_at=? WHERE id=?")
            .bind(title, input.description || "", Number(input.costPoints || 0), input.stock ?? null, input.limitPeriod || "daily", input.limitPeriod === "once" ? 1 : input.limitCount ?? 1, weekdayJson(input.redeemWeekdays || input.redeem_weekdays), input.iconType || "emoji", input.iconValue || "🎁", input.isActive === false ? 0 : 1, nowIso(), rewardPatch[1])
            .run();
        await replaceAssignees(env, a.id, "reward_assignees", "reward_id", rewardPatch[1], input.childIds || []);
        await replaceRewardPrerequisites(env, a.id, rewardPatch[1], input.prerequisites || []);
        return ok(true);
    }
    if (rewardPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        await ensureRewardOnceSchema(env);
        const reward = await env.DB.prepare("SELECT id FROM rewards WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(rewardPatch[1], a.id)
            .first();
        if (!reward)
            return fail("NOT_FOUND", "奖励不存在", 404);
        await env.DB.prepare("UPDATE rewards SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), rewardPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/achievements") {
        const a = requireRole(actor, ["parent"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM achievements WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const rule = normalizeAchievementInput(input);
            if (rule.targetTaskId) await validateTaskIds(env, a.id, [rule.targetTaskId]);
            if (rule.targetCategoryId) await validateCategoryOwnership(env, a.id, rule.targetCategoryId);
            await env.DB.prepare(`INSERT INTO achievements (
  id, parent_id, title, description, metric, threshold, icon_type, icon_value,
  rule_type, window_type, window_start, window_end, target_task_id, target_category_id, unlock_reward_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(id(), a.id, input.title, input.description || "", rule.metric, rule.threshold, input.iconType || "emoji", input.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, null)
                .run();
            return ok(true);
        }
    }
    const achievementPatch = path.match(/^\/achievements\/([^/]+)$/);
    if (achievementPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const achievement = await env.DB.prepare("SELECT id FROM achievements WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(achievementPatch[1], a.id)
            .first();
        if (!achievement)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        const rule = normalizeAchievementInput(input);
        if (rule.targetTaskId) await validateTaskIds(env, a.id, [rule.targetTaskId]);
        if (rule.targetCategoryId) await validateCategoryOwnership(env, a.id, rule.targetCategoryId);
        await env.DB.prepare(`UPDATE achievements
SET title=?, description=?, metric=?, threshold=?, icon_type=?, icon_value=?,
    rule_type=?, window_type=?, window_start=?, window_end=?, target_task_id=?, target_category_id=?, updated_at=?
WHERE id=?`)
            .bind(input.title, input.description || "", rule.metric, rule.threshold, input.iconType || "emoji", input.iconValue || "🏅", rule.ruleType, rule.windowType, rule.windowStart, rule.windowEnd, rule.targetTaskId, rule.targetCategoryId, nowIso(), achievementPatch[1])
            .run();
        return ok(true);
    }
    if (achievementPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        const result = await deleteAchievementWithExclusiveReward(env, a.id, achievementPatch[1]);
        if (!result)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        return ok(result);
    }
    const review = path.match(/^\/task-submissions\/([^/]+)\/review$/);
    if (review && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const sub = await env.DB.prepare("SELECT s.*, t.point_type, t.points FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND s.parent_id=? AND s.status='pending'")
            .bind(review[1], a.id)
            .first();
        if (!sub)
            return fail("NOT_FOUND", "待审核任务不存在", 404);
        const status = input.approved ? "approved" : "rejected";
        if (status === "approved") {
            const existing = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='task' AND source_id=?").bind(sub.id).first();
            if (existing)
                return fail("DUPLICATE_LEDGER", "该任务已审核通过，不能重复记账", 409);
        }
        const stmts = [env.DB.prepare("UPDATE task_submissions SET status=?, reviewed_at=?, review_note=? WHERE id=?").bind(status, nowIso(), input.note || "", sub.id)];
        if (status === "approved") {
            stmts.push(env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'task', ?, ?, ?)")
                .bind(id(), sub.child_id, a.id, signedPoints(sub.point_type, Number(sub.points)), sub.id, sub.period_key, "任务审核通过"));
        }
        stmts.push(env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type='user' AND recipient_id=? AND related_type='task_submission' AND related_id=? AND read_at IS NULL")
            .bind(nowIso(), a.id, sub.id));
        await env.DB.batch(stmts);
        if (status === "approved") {
            await recalcAchievements(env, a.id, sub.child_id);
        }
        await notify(env, {
            recipientType: "child",
            recipientId: sub.child_id,
            actorType: "user",
            actorId: a.id,
            title: status === "approved" ? "任务审核通过" : "任务被驳回",
            body: status === "approved" ? "家长已通过你的任务，积分已结算。" : input.note || "家长驳回了这次任务提交。",
            eventType: status === "approved" ? "task_approved" : "task_rejected",
            relatedType: "task_submission",
            relatedId: sub.id
        });
        return ok(true);
    }
    const redemptionAction = path.match(/^\/reward-redemptions\/([^/]+)\/(redeem|cancel)$/);
    if (redemptionAction && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const redemption = await env.DB.prepare("SELECT rr.*, r.cost_points, r.redeem_weekdays FROM reward_redemptions rr JOIN rewards r ON r.id=rr.reward_id WHERE rr.id=? AND rr.parent_id=? AND rr.status='pending'")
            .bind(redemptionAction[1], a.id)
            .first();
        if (!redemption)
            return fail("NOT_FOUND", "待处理兑换不存在", 404);
        if (redemptionAction[2] === "redeem") {
            const offset = await timezoneOffsetMinutes(env);
            if (!isWeekdayAllowed(redemption.redeem_weekdays, undefined, offset))
                return fail("REDEEM_WEEKDAY_BLOCKED", "今天不是该奖励允许核销的周几", 409);
            await env.DB.prepare("UPDATE reward_redemptions SET status='redeemed', redeemed_at=? WHERE id=?").bind(nowIso(), redemption.id).run();
        }
        else {
            const existingCancel = await env.DB.prepare("SELECT id FROM point_ledger WHERE source_type='reward_cancel' AND source_id=?").bind(redemption.id).first();
            if (existingCancel)
                return fail("DUPLICATE_LEDGER", "该兑换已取消，不能重复退分", 409);
            const cancelLedgerId = id();
            await env.DB.batch([
                env.DB.prepare("UPDATE reward_redemptions SET status='cancelled', cancelled_at=? WHERE id=?").bind(nowIso(), redemption.id),
                env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note) VALUES (?, ?, ?, ?, 'reward_cancel', ?, ?, ?)")
                    .bind(cancelLedgerId, redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "取消兑换退回")
            ]);
            await recalcAchievements(env, a.id, redemption.child_id);
        }
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: "user",
            actorId: a.id,
            title: redemptionAction[2] === "redeem" ? "奖励已核销" : "奖励兑换已取消",
            body: redemptionAction[2] === "redeem" ? "家长已核销你的奖励兑换。" : "家长取消了奖励兑换，积分已退回。",
            eventType: redemptionAction[2] === "redeem" ? "reward_redeemed" : "reward_cancelled",
            relatedType: "reward_redemption",
            relatedId: redemption.id
        });
        await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type='user' AND recipient_id=? AND related_type='reward_redemption' AND related_id=? AND read_at IS NULL")
            .bind(nowIso(), a.id, redemption.id)
            .run();
        return ok(true);
    }
    return null;
}
