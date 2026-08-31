import { DEFAULT_TIMEZONE_OFFSET_MINUTES, normalizeWeekdays, normalizeTaskSubmissionDeadline, isWeekdayAllowed, prerequisitePeriodKey, signedPoints, nextPeriodReset, reportWindowRange, periodKey } from "../../../src/lib/domain.js";
import { ok, fail, body, id, nowIso, requireRole, validateInput, INPUT_RULES, validateEnum, weekdayJson, replaceAssignees, validateChildIds, validateTaskIds, validateCategoryOwnership, usernameExists, hashPassword, verifyPassword, timezoneOffsetMinutes, timezoneLabel, settingNumber, localTimeText, escapeHtml, childUsageForPeriod, childUsageCountsForPeriods, childLatestTaskStatuses, rewardLockedByAchievement, unmetRewardPrerequisites, balance, balancesForChildren, recalcAchievements, notify, rewardPrerequisites, replaceRewardPrerequisites, replaceRewardAchievementRequirement, deleteAchievementWithExclusiveReward, listWithAssignees, normalizeAchievementInput, validateHttpsUrl, ensureRewardOnceSchema, ensureParentDelegatesSchema, actorAudit, ensureCriticismRemedySchema, settleExpiredCriticismFreezes, ensureRequiredTaskSchema, ensureChildScheduleSchema, schedulePlanHtmlToText, normalizeCompletionStandards, ensureTaskSetSchema, listTaskSets, taskSetEligibleChildIds, taskSetHasOpenProgress, settleTaskSetIfReady, REPORT_CONTENT_SECTION_KEYS, getParentReportContentSettings, saveParentReportContentSettings } from "../utils.js";
import { generateParentAiGreeting, getParentAiServiceConfig, generateReportCommentary, previousCompletedReportRange, collectReportComparison, aiConfigHash, aiReportConfigHash, ensureAiReportCommentaries, AI_FETCH_TIMEOUT_MS, listModels, enqueueCartoonReportJob, loadCartoonReportJob, publicCartoonJob, processCartoonReportJobs, enqueuePrintChecklistImageJob, loadPrintChecklistImageJob, publicPrintChecklistJob, processPrintChecklistImageJobs, enqueueScheduleImageJob, loadScheduleImageJob, publicScheduleImageJob, processScheduleImageJobs } from "../ai/index.js";

const PRINT_A4_STYLE = '@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2933;line-height:1.5}button{margin-bottom:16px}h1{margin:0 0 8px}h2{margin-top:24px;border-bottom:2px solid #111;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin-top:12px;page-break-inside:auto}th,td{border:1px solid #999;padding:7px;text-align:left;vertical-align:top}th{background:#f0f0f0}tr{break-inside:avoid}.print-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}.print-task-card{border:1px solid #a7b0c0;border-radius:6px;padding:8px;background:#f8fafc;break-inside:avoid;page-break-inside:avoid}.print-task-card strong{display:block}.print-task-card small{display:block;color:#64748b}.print-plan{border:1px solid #cbd5e1;border-radius:6px;padding:8px;min-height:36px;background:#fff}.print-plan :first-child{margin-top:0}.print-plan :last-child{margin-bottom:0}.schedule-print-slot{break-inside:avoid;page-break-inside:avoid;margin-top:14px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:18px 0}.summary div{border:1px solid #999;padding:10px}.summary strong{display:block;font-size:24px}.attention{background:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;margin:18px 0}.ai-commentary{background:#f0f4ff;border-left:4px solid #6366f1;padding:16px 20px;margin:18px 0;border-radius:4px}.ai-commentary h2{margin:0 0 8px;border:none;padding:0}.ai-commentary p{margin:4px 0;line-height:1.8;white-space:pre-line}.ai-commentary .note{font-size:12px;color:#888;margin-top:8px}@media print{button{display:none}body{margin:0}.summary{grid-template-columns:repeat(3,1fr)}table,.print-task-card,.schedule-print-slot{break-inside:avoid;page-break-inside:avoid}}';

const PERIOD_LABELS = { none: "不限周期", daily: "每日", weekly: "每周", monthly: "每月", once: "一次性" };
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const TASK_STATUS_LABELS = { approved: "通过", pending: "待审核", rejected: "未通过" };
const REWARD_STATUS_LABELS = { pending: "待核销", redeemed: "已核销", cancelled: "已取消" };
const periodText = (value) => PERIOD_LABELS[value] || String(value || "");
const weekdaysText = (value) => normalizeWeekdays(value).map((day) => WEEKDAY_LABELS[day]).join("、");
const signedText = (value) => `${Number(value || 0) > 0 ? "+" : ""}${Number(value || 0)}`;
const reportDateText = (value, offset) => localTimeText(value, offset).slice(0, 10);

function taskSubmissionDeadline(input, period) {
    const value = input.submissionDeadline;
    const deadline = normalizeTaskSubmissionDeadline(period, value);
    if (value !== null && value !== undefined && value !== "" && !deadline)
        return { error: "提交截止时间格式无效" };
    return { value: JSON.stringify(deadline) };
}

function scheduleTaskCardHtml(item) {
    const meta = escapeHtml(item.category_name || "未分类") + " · " + escapeHtml(periodText(item.period)) + "最多" + Number(item.limit_count || 1) + "次 · " + Number(item.points || 0) + "分" + (item.is_required ? " · 必做" + Number(item.required_count || 1) + "次" : "");
    const description = item.description ? '<small>' + escapeHtml(item.description) + '</small>' : '';
    return '<div class="print-task-card"><strong>' + escapeHtml(item.title) + '</strong><small>' + meta + '</small>' + description + '</div>';
}

function schedulePlanBlockHtml(slot) {
    return slot.plan_html ? '<div class="print-plan">' + slot.plan_html + '</div>' : '<div class="print-plan"><span style="color:#777">暂无计划</span></div>';
}

function schedulePlainText(slot) {
    return schedulePlanHtmlToText(slot.plan_html || "");
}

function completionStandards(row) {
    try {
        return normalizeCompletionStandards(JSON.parse(row.completion_standards_json || "[]"));
    } catch {
        return [];
    }
}

function taskGrading(input) {
    const gradingMode = input.gradingMode === "completion" || input.grading_mode === "completion" ? "completion" : "fixed";
    const standards = gradingMode === "completion" ? normalizeCompletionStandards(input.completionStandards || input.completion_standards || []) : [];
    if (gradingMode === "completion" && !standards.length) return { error: "完成程度给分至少需要一个标准" };
    return { gradingMode, standards };
}
function taskRequiredRemedy(input, isRequired, requiredPenaltyPoints) {
    const enabled = isRequired && (input.requiredRemedyEnabled === true || input.required_remedy_enabled === 1 || input.required_remedy_enabled === "1");
    if (!enabled) return { enabled: 0, condition: "", points: 0, deadlineHours: 24 };
    const condition = String(input.requiredRemedyCondition ?? input.required_remedy_condition ?? "").trim();
    const points = Number(input.requiredRemedyPoints ?? input.required_remedy_points);
    const deadlineHours = Number(input.requiredRemedyDeadlineHours ?? input.required_remedy_deadline_hours);
    if (!condition) return { error: "请填写必做扣分补救条件" };
    if (!Number.isInteger(points) || points < 1 || points > requiredPenaltyPoints) return { error: "可挽回积分需在 1 到未达标扣分之间" };
    if (!Number.isInteger(deadlineHours) || deadlineHours < 1) return { error: "补救时限至少为 1 小时" };
    return { enabled: 1, condition, points, deadlineHours };
}
export async function handleParentRoutes(path, method, request, env, actor, url, ctx) {
    if (path === "/parent/report-settings" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        return ok(await getParentReportContentSettings(env, a.id));
    }
    if (path === "/parent/report-settings" && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        if (!input || typeof input !== "object" || Array.isArray(input))
            return fail("BAD_REQUEST", "报表内容设置格式无效");
        const current = await getParentReportContentSettings(env, a.id);
        for (const [type, sections] of Object.entries(input)) {
            if (!Object.prototype.hasOwnProperty.call(REPORT_CONTENT_SECTION_KEYS, type))
                return fail("BAD_REQUEST", "报表类型无效");
            if (!sections || typeof sections !== "object" || Array.isArray(sections))
                return fail("BAD_REQUEST", "报表章节格式无效");
            for (const [section, enabled] of Object.entries(sections)) {
                if (!REPORT_CONTENT_SECTION_KEYS[type].includes(section))
                    return fail("BAD_REQUEST", "报表章节无效");
                if (typeof enabled !== "boolean")
                    return fail("BAD_REQUEST", "报表章节开关必须为布尔值");
                current[type][section] = enabled;
            }
        }
        return ok(await saveParentReportContentSettings(env, a.id, current));
    }
    if (path === "/parent/profile" && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        const input = await body(request);
        const parent = await env.DB.prepare("SELECT * FROM users WHERE id=? AND role='parent' AND status='active' AND deleted_at IS NULL").bind(a.id).first();
        if (!parent)
            return fail("NOT_FOUND", "家长账号不存在", 404);
        const operatorLabel = input.operatorLabel !== undefined ? String(input.operatorLabel || "").trim().slice(0, 50) : parent.operator_label || "";
        const newPassword = String(input.newPassword || "");
        if (newPassword) {
            const currentPassword = String(input.currentPassword || "");
            if (!currentPassword)
                return fail("BAD_REQUEST", "请输入当前密码");
            if (!(await verifyPassword(currentPassword, parent.password_hash)))
                return fail("BAD_CREDENTIALS", "当前密码不正确", 401);
            const passwordHash = await hashPassword(newPassword);
            await env.DB.prepare("UPDATE users SET password_hash=?, operator_label=?, updated_at=? WHERE id=? AND role='parent'")
                .bind(passwordHash, operatorLabel, nowIso(), a.id).run();
            return ok(true);
        }
        await env.DB.prepare("UPDATE users SET operator_label=?, updated_at=? WHERE id=? AND role='parent'")
            .bind(operatorLabel, nowIso(), a.id).run();
        return ok(true);
    }
    if (path === "/parent/delegates" && method === "GET") {
        const a = requireRole(actor, ["parent"]);
        await ensureParentDelegatesSchema(env);
        return ok((await env.DB.prepare("SELECT id, username, display_name, operator_label, status, created_at, updated_at FROM parent_delegates WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC")
            .bind(a.id)
            .all()).results);
    }
    if (path === "/parent/delegates" && method === "POST") {
        const a = requireRole(actor, ["parent"]);
        await ensureParentDelegatesSchema(env);
        const input = await body(request);
        const username = String(input.username || "").trim();
        const displayName = String(input.displayName || input.display_name || username).trim();
        const password = String(input.password || "123456");
        const operatorLabel = String(input.operatorLabel || input.operator_label || displayName).trim().slice(0, 50);
        const err = validateInput(username, INPUT_RULES.username, "账号") || validateInput(displayName, INPUT_RULES.displayName, "显示名");
        if (err) return fail("BAD_REQUEST", err, 400);
        if (await usernameExists(env, username))
            return fail("USERNAME_EXISTS", "账号已存在，请换一个用户名", 409);
        await env.DB.prepare("INSERT INTO parent_delegates (id, parent_id, username, password_hash, display_name, operator_label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)")
            .bind(id(), a.id, username, await hashPassword(password), displayName || username, operatorLabel, nowIso(), nowIso())
            .run();
        return ok(true);
    }
    const delegatePatch = path.match(/^\/parent\/delegates\/([^/]+)$/);
    if (delegatePatch && method === "PATCH") {
        const a = requireRole(actor, ["parent"]);
        await ensureParentDelegatesSchema(env);
        const input = await body(request);
        const delegate = await env.DB.prepare("SELECT * FROM parent_delegates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(delegatePatch[1], a.id).first();
        if (!delegate)
            return fail("NOT_FOUND", "协同管理账号不存在", 404);
        const updates = [];
        const params = [];
        if (input.displayName !== undefined || input.display_name !== undefined) {
            const displayName = String(input.displayName ?? input.display_name ?? "").trim();
            const err = validateInput(displayName, INPUT_RULES.displayName, "显示名");
            if (err) return fail("BAD_REQUEST", err, 400);
            updates.push("display_name=?");
            params.push(displayName || delegate.username);
        }
        if (input.operatorLabel !== undefined || input.operator_label !== undefined) {
            updates.push("operator_label=?");
            params.push(String(input.operatorLabel ?? input.operator_label ?? "").trim().slice(0, 50));
        }
        if (input.status !== undefined) {
            const statusErr = validateEnum(input.status, ["active", "disabled"], "状态");
            if (statusErr) return fail("BAD_REQUEST", statusErr, 400);
            updates.push("status=?");
            params.push(input.status);
        }
        if (input.password) {
            updates.push("password_hash=?");
            params.push(await hashPassword(input.password));
        }
        if (!updates.length)
            return ok(true);
        params.push(nowIso(), delegatePatch[1], a.id);
        await env.DB.prepare(`UPDATE parent_delegates SET ${updates.join(", ")}, updated_at=? WHERE id=? AND parent_id=?`).bind(...params).run();
        return ok(true);
    }
    if (delegatePatch && method === "DELETE") {
        const a = requireRole(actor, ["parent"]);
        await ensureParentDelegatesSchema(env);
        await env.DB.prepare("UPDATE parent_delegates SET status='disabled', deleted_at=?, updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(nowIso(), nowIso(), delegatePatch[1], a.id)
            .run();
        return ok(true);
    }
    if (path === "/parent/ai-service" && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const config = await getParentAiServiceConfig(env, a.id);
        return ok({
            baseUrl: config.baseUrl,
            model: config.model,
            prompt: config.prompt,
            reportPrompt: config.reportPrompt,
            monthlyPrompt: config.monthlyPrompt,
            imageBaseUrl: config.imageBaseUrl,
            imageModel: config.imageModel,
            imagePrompt: config.imagePrompt,
            checklistImagePrompt: config.checklistImagePrompt,
            scheduleImagePrompt: config.scheduleImagePrompt,
            imageSize: config.imageSize,
            imageQuality: config.imageQuality,
            imageFormat: config.imageFormat,
            imageN: config.imageN,
            hasKey: config.hasKey,
            hasImageKey: config.hasImageKey,
            updatedAt: config.updatedAt
        });
    }
    if (path === "/parent/ai-service" && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const current = await getParentAiServiceConfig(env, a.id);
        const nextBaseUrl = input.baseUrl !== undefined ? String(input.baseUrl).trim().replace(/\/+$/, "") : current.baseUrl;
        const nextModel = input.model !== undefined ? String(input.model).trim() : current.model;
        const nextPrompt = input.prompt !== undefined ? String(input.prompt).trim() : current.prompt;
        const nextReportPrompt = input.reportPrompt !== undefined ? String(input.reportPrompt).trim() : (current.reportPrompt || "");
        const nextMonthlyPrompt = input.monthlyPrompt !== undefined ? String(input.monthlyPrompt).trim() : (current.monthlyPrompt || "");
        const nextImageBaseUrl = input.imageBaseUrl !== undefined ? String(input.imageBaseUrl).trim().replace(/\/+$/, "") : (current.imageBaseUrl || "");
        const nextImageModel = input.imageModel !== undefined ? String(input.imageModel).trim() : (current.imageModel || "gpt-image-2");
        const nextImagePrompt = input.imagePrompt !== undefined ? String(input.imagePrompt).trim() : (current.imagePrompt || "");
        const nextChecklistImagePrompt = input.checklistImagePrompt !== undefined ? String(input.checklistImagePrompt).trim() : (current.checklistImagePrompt || "");
        const nextScheduleImagePrompt = input.scheduleImagePrompt !== undefined ? String(input.scheduleImagePrompt).trim() : (current.scheduleImagePrompt || "");
        const nextImageSize = input.imageSize !== undefined ? String(input.imageSize).trim() : (current.imageSize || "1248x1760");
        const nextImageQuality = input.imageQuality !== undefined ? String(input.imageQuality).trim() : (current.imageQuality || "low");
        const nextImageFormat = input.imageFormat !== undefined ? String(input.imageFormat).trim() : (current.imageFormat || "jpeg");
        const rawImageN = input.imageN !== undefined ? Number(input.imageN) : Number(current.imageN || 1);
        const nextImageN = Number.isInteger(rawImageN) ? Math.min(10, Math.max(1, rawImageN)) : 1;
        if (!nextBaseUrl || !nextModel || !nextPrompt)
            return fail("BAD_REQUEST", "请完整填写 AI 服务配置");
        const urlErr = validateHttpsUrl(nextBaseUrl, "AI Base URL");
        if (urlErr)
            return fail("BAD_REQUEST", urlErr);
        if (nextImageBaseUrl) {
            const imageUrlErr = validateHttpsUrl(nextImageBaseUrl, "绘图 AI Base URL");
            if (imageUrlErr)
                return fail("BAD_REQUEST", imageUrlErr);
        }
        if (nextImageFormat && !["png", "jpeg", "webp"].includes(nextImageFormat))
            return fail("BAD_REQUEST", "图片格式须为 png、jpeg 或 webp");
        if (nextImageQuality && !["low", "medium", "high", "auto"].includes(nextImageQuality))
            return fail("BAD_REQUEST", "图片画质须为 low、medium、high 或 auto");
        const nextApiKey = input.apiKey !== undefined && String(input.apiKey).trim() ? String(input.apiKey).trim() : current.apiKey;
        const nextImageApiKey = input.imageApiKey !== undefined && String(input.imageApiKey).trim() ? String(input.imageApiKey).trim() : current.imageApiKey;
        const updatedAt = nowIso();
        await env.DB.prepare(`INSERT INTO parent_ai_service_settings (parent_id, base_url, api_key, model, prompt, report_prompt, monthly_prompt, image_base_url, image_api_key, image_model, image_prompt, checklist_image_prompt, schedule_image_prompt, image_size, image_quality, image_format, image_n, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(parent_id) DO UPDATE SET base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, prompt=excluded.prompt, report_prompt=excluded.report_prompt, monthly_prompt=excluded.monthly_prompt, image_base_url=excluded.image_base_url, image_api_key=excluded.image_api_key, image_model=excluded.image_model, image_prompt=excluded.image_prompt, checklist_image_prompt=excluded.checklist_image_prompt, schedule_image_prompt=excluded.schedule_image_prompt, image_size=excluded.image_size, image_quality=excluded.image_quality, image_format=excluded.image_format, image_n=excluded.image_n, updated_at=excluded.updated_at`)
            .bind(a.id, nextBaseUrl, nextApiKey, nextModel, nextPrompt, nextReportPrompt, nextMonthlyPrompt, nextImageBaseUrl, nextImageApiKey, nextImageModel, nextImagePrompt, nextChecklistImagePrompt, nextScheduleImagePrompt, nextImageSize, nextImageQuality, nextImageFormat, nextImageN, updatedAt)
            .run();
        return ok({ baseUrl: nextBaseUrl, model: nextModel, prompt: nextPrompt, reportPrompt: nextReportPrompt, monthlyPrompt: nextMonthlyPrompt, imageBaseUrl: nextImageBaseUrl, imageModel: nextImageModel, imagePrompt: nextImagePrompt, checklistImagePrompt: nextChecklistImagePrompt, scheduleImagePrompt: nextScheduleImagePrompt, imageSize: nextImageSize, imageQuality: nextImageQuality, imageFormat: nextImageFormat, imageN: nextImageN, hasKey: !!nextApiKey, hasImageKey: !!nextImageApiKey, updatedAt });
    }
    if (path === "/parent/ai-service/models" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
    if (path === "/parent/ai-service/preview" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const type = String(input.type || "");
        if (!["greeting", "weeklyReport", "monthlyReport"].includes(type))
            return fail("BAD_REQUEST", "无效的 AI 测试类型", 400);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(String(input.childId || ""), a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        if (!child.ai_enabled)
            return fail("BAD_REQUEST", "请先为该孩子启用 AI", 400);
        const config = await getParentAiServiceConfig(env, a.id);
        if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
            return fail("BAD_REQUEST", "请先完整保存 AI 服务配置", 400);
        const offset = await timezoneOffsetMinutes(env);
        let text = "";
        if (type === "greeting") {
            text = await generateParentAiGreeting(env, child, offset, true, { cache: false });
        } else {
            const period = type === "monthlyReport" ? "monthly" : "weekly";
            const range = previousCompletedReportRange(period, nowIso(), offset);
            text = await generateReportCommentary(env, child, period, range.label, offset, true, { cache: false, range });
        }
        return ok({ text });
    }
    if (path === "/parent/ai-service/preview/cache" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const type = String(input.type || "");
        if (!["greeting", "weeklyReport", "monthlyReport"].includes(type))
            return fail("BAD_REQUEST", "无效的 AI 测试类型", 400);
        const text = String(input.text || "").trim();
        if (!text)
            return fail("BAD_REQUEST", "缓存文本不能为空", 400);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(String(input.childId || ""), a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        if (!child.ai_enabled)
            return fail("BAD_REQUEST", "请先为该孩子启用 AI", 400);
        const config = await getParentAiServiceConfig(env, a.id);
        if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
            return fail("BAD_REQUEST", "请先完整保存 AI 服务配置", 400);
        const offset = await timezoneOffsetMinutes(env);
        const now = nowIso();
        if (type === "greeting") {
            const hash = aiConfigHash(config);
            const dayKey = periodKey("daily", now, offset);
            await env.DB.prepare("INSERT OR REPLACE INTO ai_child_greetings (child_id, previous_week_key, config_hash, greeting, generated_at) VALUES (?, ?, ?, ?, ?)")
                .bind(child.id, dayKey, hash, text, now)
                .run();
        } else {
            const period = type === "monthlyReport" ? "monthly" : "weekly";
            const hash = aiReportConfigHash(config, period);
            const range = previousCompletedReportRange(period, now, offset);
            await ensureAiReportCommentaries(env);
            await env.DB.prepare("INSERT OR REPLACE INTO ai_report_commentaries (child_id, parent_id, period_key, period_type, config_hash, commentary, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .bind(child.id, child.parent_id, range.label, period, hash, text, now)
                .run();
        }
        return ok({ ok: true });
    }
    if (path === "/parent/ai-service/cartoon-report" && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const period = String(input.period || "") === "monthly" ? "monthly" : String(input.period || "") === "weekly" ? "weekly" : "";
        if (!period)
            return fail("BAD_REQUEST", "无效的报表周期", 400);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name, ai_enabled, gender, birth_date FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(String(input.childId || ""), a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        if (!child.ai_enabled)
            return fail("BAD_REQUEST", "请先为该孩子启用 AI", 400);
        const config = await getParentAiServiceConfig(env, a.id);
        if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.imagePrompt)
            return fail("BAD_REQUEST", "请先完整保存卡通报告绘图配置", 400);
        const imageUrlErr = validateHttpsUrl(config.imageBaseUrl, "绘图 AI Base URL");
        if (imageUrlErr)
            return fail("BAD_REQUEST", imageUrlErr, 400);
        const offset = await timezoneOffsetMinutes(env);
        const range = previousCompletedReportRange(period, nowIso(), offset);
        const job = await enqueueCartoonReportJob(env, {
            parentId: a.id,
            childId: child.id,
            periodType: period,
            periodKey: range.label,
            resetFailed: !!input.retry,
            force: !!input.force
        });
        ctx?.waitUntil?.(processCartoonReportJobs(env, { maxJobs: 1 }));
        return ok(publicCartoonJob(job));
    }
    const cartoonReportJob = path.match(/^\/parent\/ai-service\/cartoon-report\/([^/]+)$/);
    if (cartoonReportJob && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const job = await loadCartoonReportJob(env, a.id, cartoonReportJob[1]);
        if (!job)
            return fail("NOT_FOUND", "卡通报告任务不存在", 404);
        return ok(publicCartoonJob(job));
    }
    if (path === "/children") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT id, username, display_name, status, ai_enabled, gender, birth_date, daily_review_enabled, daily_review_seconds FROM children WHERE parent_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(a.id).all()).results);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        if (input.dailyReviewEnabled !== undefined) {
            if (typeof input.dailyReviewEnabled !== "boolean")
                return fail("BAD_REQUEST", "昨日表现回顾开关必须为 true 或 false", 400);
            updates.push("daily_review_enabled=?");
            params.push(input.dailyReviewEnabled ? 1 : 0);
        }
        if (input.dailyReviewSeconds !== undefined) {
            const seconds = Number(input.dailyReviewSeconds);
            if (typeof input.dailyReviewSeconds !== "number" || !Number.isInteger(seconds) || seconds < 0 || seconds > 300)
                return fail("BAD_REQUEST", "昨日表现回顾阅读时间必须是 0 到 300 的整数秒", 400);
            updates.push("daily_review_seconds=?");
            params.push(seconds);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await env.DB.prepare("UPDATE children SET deleted_at=?, status='disabled', updated_at=? WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(nowIso(), nowIso(), childPatch[1], a.id)
            .run();
        return ok(true);
    }
    const childExport = path.match(/^\/children\/([^/]+)\/export-print$/);
    if (childExport && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await settleExpiredCriticismFreezes(env);
        await ensureRequiredTaskSchema(env);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childExport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const reportSections = await getParentReportContentSettings(env, a.id);
        const [tasks, rewards, feedbackTemplates] = await Promise.all([
            env.DB.prepare(`SELECT t.*, tc.name category_name FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL AND t.is_active=1
ORDER BY t.is_required DESC, tc.name, t.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare(`SELECT r.*,
  (SELECT GROUP_CONCAT(t.title || '×' || rp.required_count, '、') FROM reward_prerequisites rp JOIN tasks t ON t.id=rp.task_id WHERE rp.reward_id=r.id) prerequisites,
  (SELECT a2.title FROM achievements a2 WHERE a2.unlock_reward_id=r.id AND a2.is_active=1 AND a2.deleted_at IS NULL LIMIT 1) required_achievement
FROM rewards r
JOIN reward_assignees ra ON ra.reward_id=r.id
WHERE ra.child_id=? AND r.parent_id=? AND r.deleted_at IS NULL AND r.is_active=1
ORDER BY r.cost_points, r.created_at DESC`).bind(child.id, a.id).all(),
            env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY kind, created_at DESC").bind(a.id).all()
        ]);
        const taskSets = (await listTaskSets(env, a.id)).filter((set) => Number(set.is_active) !== 0 && set.eligibleChildIds.includes(child.id));
        const table = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        const taskRule = (item) => {
            const grading = item.grading_mode === "completion"
                ? completionStandards(item).map((rule) => `${rule.label}${rule.points}分`).join("；")
                : `固定${item.points}分`;
            const required = item.is_required ? `；必做${item.required_count || 1}次，未达标扣${item.required_penalty_points || 0}分` : "";
            const remedy = item.is_required && item.required_remedy_enabled ? `；补救：${item.required_remedy_condition || "按要求完成"}，可挽回${item.required_remedy_points || 0}分/${item.required_remedy_deadline_hours || 24}小时` : "";
            return `${periodText(item.period)}最多${item.limit_count || 1}次；${grading}${required}${remedy}`;
        };
        const rewardRule = (item) => [
            `${periodText(item.limit_period)}${item.limit_count ? `最多${item.limit_count}次` : ""}`,
            item.prerequisites ? `前置任务：${item.prerequisites}` : "",
            item.required_achievement ? `所需成就：${item.required_achievement}` : "",
        ].filter(Boolean).join("；");
        const groupedTaskIds = new Set(taskSets.flatMap((set) => set.taskIds));
        const setRows = taskSets.map((set) => [set.title, set.members.map((member) => member.title).join("、"), `${set.minPoints}${set.maxPoints !== set.minPoints ? `-${set.maxPoints}` : ""}分`, set.description || ""]);
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} 打印清单</title><style>${PRINT_A4_STYLE}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} 当前规则清单</h1><p>仅展示当前启用内容；导出时间：${escapeHtml(localTimeText(nowIso(), await timezoneOffsetMinutes(env)))}</p>${setRows.length ? `<h2>任务集</h2>${table(["任务集","子任务","每轮积分","说明"], setRows)}` : ""}<h2>任务目标</h2>${table(["任务","分类","规则与积分","可做星期","说明"], tasks.results.filter((item) => !groupedTaskIds.has(item.id)).map((item) => [item.title, item.category_name || "未分类", taskRule(item), weekdaysText(item.enabled_weekdays), item.description || ""]))}<h2>可兑换奖励</h2>${table(["奖励","所需积分","兑换规则","可兑换星期","说明"], rewards.results.map((item) => [item.title, item.cost_points, rewardRule(item), weekdaysText(item.redeem_weekdays), item.description || ""]))}<h2>行为约定</h2>${table(["类型","条款","积分","补救规则","说明"], feedbackTemplates.results.map((item) => [item.kind === "praise" ? "表扬" : "批评", item.title, `${item.kind === "praise" ? "+" : "-"}${Math.abs(Number(item.points || 0))}`, item.kind === "criticism" && item.is_remediable ? `${item.remedy_condition || "按要求补救"}；可挽回${item.remedy_points || 0}分；限时${item.remedy_deadline_hours || 24}小时` : "无", item.description || ""]))}</body></html>`;
        const visibleHtml = [
            [reportSections.checklist.taskSets, /<h2>任务集<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.checklist.tasks, /<h2>任务目标<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.checklist.rewards, /<h2>可兑换奖励<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.checklist.feedback, /<h2>行为约定<\/h2><table>[\s\S]*?<\/table>/]
        ].reduce((output, [included, pattern]) => included ? output : output.replace(pattern, ""), html);
        return new Response(visibleHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childPrintImage = path.match(/^\/children\/([^/]+)\/print-checklist-image$/);
    if (childPrintImage && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childPrintImage[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const config = await getParentAiServiceConfig(env, a.id);
        if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.checklistImagePrompt)
            return fail("BAD_REQUEST", "请先完整保存打印清单绘图配置", 400);
        const imageUrlErr = validateHttpsUrl(config.imageBaseUrl, "绘图 AI Base URL");
        if (imageUrlErr)
            return fail("BAD_REQUEST", imageUrlErr, 400);
        const job = await enqueuePrintChecklistImageJob(env, {
            parentId: a.id,
            childId: child.id,
            resetFailed: !!input.retry,
            force: !!input.force
        });
        ctx?.waitUntil?.(processPrintChecklistImageJobs(env, { maxJobs: 1 }));
        return ok(publicPrintChecklistJob(job));
    }
    const childPrintImageJob = path.match(/^\/children\/([^/]+)\/print-checklist-image\/([^/]+)$/);
    if (childPrintImageJob && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childPrintImageJob[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const job = await loadPrintChecklistImageJob(env, a.id, childPrintImageJob[2]);
        if (!job || job.child_id !== child.id)
            return fail("NOT_FOUND", "打印清单绘图任务不存在", 404);
        return ok(publicPrintChecklistJob(job));
    }
    const childSchedulePrint = path.match(/^\/children\/([^/]+)\/schedule-print$/);
    if (childSchedulePrint && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await Promise.all([ensureRequiredTaskSchema(env), ensureChildScheduleSchema(env)]);
        const child = await env.DB.prepare("SELECT id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childSchedulePrint[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const slots = (await env.DB.prepare("SELECT * FROM child_schedule_slots WHERE child_id=? ORDER BY sort_order, created_at")
            .bind(child.id).all()).results;
        const slotIds = slots.map((s) => s.id);
        let items = [];
        if (slotIds.length) {
            const placeholders = slotIds.map(() => "?").join(",");
            items = (await env.DB.prepare(`SELECT csi.*, t.title, t.points, t.period, t.limit_count, t.is_required, t.required_count, t.description, tc.name category_name
FROM child_schedule_items csi
JOIN tasks t ON t.id=csi.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE csi.slot_id IN (${placeholders}) AND csi.child_id=?
ORDER BY csi.sort_order, csi.created_at`).bind(...slotIds, child.id).all()).results;
        }
        const scheduledTaskIds = new Set(items.map((item) => item.task_id));
        const unscheduled = (await env.DB.prepare(`SELECT t.id, t.title, t.points, t.period, t.limit_count, t.description, tc.name category_name
FROM tasks t
JOIN task_assignees ta ON ta.task_id=t.id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE ta.child_id=? AND t.parent_id=? AND t.deleted_at IS NULL AND t.is_active=1
ORDER BY tc.name, t.created_at DESC`).bind(child.id, a.id).all()).results
            .filter((t) => !scheduledTaskIds.has(t.id));
        const offset = await timezoneOffsetMinutes(env);
        const fmtTime = (m) => {
            const h = Math.floor(m / 60);
            const min = m % 60;
            return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        };
        const slotBlocks = slots.map((slot) => {
            const slotItems = items.filter((item) => item.slot_id === slot.id);
            const taskCards = slotItems.length ? `<div class="print-card-grid">${slotItems.map(scheduleTaskCardHtml).join("")}</div>` : '<p style="color:#777">暂无可完成任务</p>';
            return `<section class="schedule-print-slot"><h2>${escapeHtml(fmtTime(slot.start_minutes))} - ${escapeHtml(fmtTime(slot.end_minutes))} ${escapeHtml(slot.title || "未命名时段")}</h2><h3>计划</h3>${schedulePlanBlockHtml(slot)}<h3>可完成任务</h3>${taskCards}</section>`;
        });
        const unscheduledHtml = unscheduled.length ? `<h2>未安排任务</h2><div class="print-card-grid">${unscheduled.map(scheduleTaskCardHtml).join("")}</div>` : "";
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} 当前日程模板</title><style>${PRINT_A4_STYLE}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} 当前日程模板</h1><p>这是当前每日安排模板，并非历史执行记录；导出时间：${escapeHtml(localTimeText(nowIso(), offset))}</p>${slots.length ? slotBlocks.join("") : "<p>暂无日程安排</p>"}${unscheduledHtml}</body></html>`;
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childScheduleImage = path.match(/^\/children\/([^/]+)\/schedule-image$/);
    if (childScheduleImage && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const child = await env.DB.prepare("SELECT id, parent_id, display_name FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childScheduleImage[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const config = await getParentAiServiceConfig(env, a.id);
        if (!config.imageBaseUrl || !config.imageApiKey || !config.imageModel || !config.scheduleImagePrompt)
            return fail("BAD_REQUEST", "请先完整保存日程表绘图配置", 400);
        const imageUrlErr = validateHttpsUrl(config.imageBaseUrl, "绘图 AI Base URL");
        if (imageUrlErr)
            return fail("BAD_REQUEST", imageUrlErr, 400);
        const job = await enqueueScheduleImageJob(env, {
            parentId: a.id,
            childId: child.id,
            resetFailed: !!input.retry,
            force: !!input.force
        });
        ctx?.waitUntil?.(processScheduleImageJobs(env, { maxJobs: 1 }));
        return ok(publicScheduleImageJob(job));
    }
    const childScheduleImageJob = path.match(/^\/children\/([^/]+)\/schedule-image\/([^/]+)$/);
    if (childScheduleImageJob && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const child = await env.DB.prepare("SELECT id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childScheduleImageJob[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const job = await loadScheduleImageJob(env, a.id, childScheduleImageJob[2]);
        if (!job || job.child_id !== child.id)
            return fail("NOT_FOUND", "日程表绘图任务不存在", 404);
        return ok(publicScheduleImageJob(job));
    }
    const childReport = path.match(/^\/children\/([^/]+)\/report$/);
    if (childReport && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await settleExpiredCriticismFreezes(env);
        const child = await env.DB.prepare("SELECT id, display_name, ai_enabled, gender, birth_date, parent_id FROM children WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(childReport[1], a.id)
            .first();
        if (!child)
            return fail("NOT_FOUND", "孩子账号不存在", 404);
        const offset = await timezoneOffsetMinutes(env);
        const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
        const reportSections = (await getParentReportContentSettings(env, a.id))[period];
        const anchor = url.searchParams.get("anchor");
        const range = anchor ? reportWindowRange(period, anchor, offset) : previousCompletedReportRange(period, nowIso(), offset);
        const periodKey = range.label;
        const reportData = await collectReportComparison(env, child, period, range, offset);
        const { ledger, tasks, rewards, feedback, achievements, requiredEvents, summary, previousSummary, pointBreakdown } = reportData;
        await ensureChildScheduleSchema(env);
        const scheduleSlots = (await env.DB.prepare("SELECT * FROM child_schedule_slots WHERE child_id=? ORDER BY sort_order, created_at").bind(child.id).all()).results;
        const scheduleItems = scheduleSlots.length
            ? (await env.DB.prepare(`SELECT csi.*, t.title, t.points, t.period, t.limit_count, t.is_required, t.required_count, t.description, tc.name category_name
FROM child_schedule_items csi
JOIN tasks t ON t.id=csi.task_id
LEFT JOIN task_categories tc ON tc.id=t.category_id
WHERE csi.child_id=? ORDER BY csi.sort_order, csi.created_at`).bind(child.id).all()).results
            : [];
        const fmtScheduleTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const scheduleSection = scheduleSlots.length ? `<h2>当前日程模板（参考）</h2><p>以下为当前每日安排，不代表本报告周期的历史执行记录。</p>${scheduleSlots.map((slot) => {
            const slotItems = scheduleItems.filter((item) => item.slot_id === slot.id);
            const taskCards = slotItems.length ? `<div class="print-card-grid">${slotItems.map(scheduleTaskCardHtml).join("")}</div>` : '<p style="color:#777">暂无可完成任务</p>';
            return `<section class="schedule-print-slot"><h3>${escapeHtml(fmtScheduleTime(slot.start_minutes))} - ${escapeHtml(fmtScheduleTime(slot.end_minutes))} ${escapeHtml(slot.title || "未命名时段")}</h3><h4>计划</h4>${schedulePlanBlockHtml(slot)}<h4>可完成任务</h4>${taskCards}</section>`;
        }).join("")}` : "";
        const tableHtml = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table>`;
        const reportTitle = period === "monthly" ? "月度报告" : "周度报告";
        const rateText = (value) => value === null || value === undefined ? "暂无已审核记录" : `${value}%`;
        const deltaText = (current, previous) => signedText(Number(current || 0) - Number(previous || 0));
        const actionItems = [];
        if (summary.pending) actionItems.push(`有 ${summary.pending} 项任务待审核，请先完成审核后再做最终复盘。`);
        for (const item of tasks.filter((row) => row.status === "rejected").slice(0, 5))
            actionItems.push(`关注任务「${item.title}」${item.review_note ? `：${item.review_note}` : "，明确下次完成标准。"}`);
        for (const item of requiredEvents.slice(0, 5))
            actionItems.push(`必做任务「${item.title}」实际 ${item.actual_count}/${item.required_count}${Number(item.penalty_points) > 0 ? `，记录扣分 ${item.penalty_points}` : "，已记录未扣分"}。`);
        if (!actionItems.length) actionItems.push("本期没有待审核、驳回或必做异常记录，可从表现最好的分类继续巩固。 ");
        const actionSection = `<div class="attention"><strong>待处理与改进</strong><ul>${actionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
        const rewardImpact = (item) => ledger.filter((row) => row.source_id === item.id && ["reward", "reward_cancel", "reward_refund"].includes(row.source_type)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const requiredStatus = (item) => {
            if (!Number(item.penalty_points)) return "已记录未扣分";
            const ledgerItem = ledger.find((row) => row.source_type === "task_required_penalty" && row.source_id === item.task_id && row.period_key === item.period_key);
            return ledgerItem?.freeze_status === "frozen" ? `未达标，冻结${item.penalty_points}分待补救` : `未达标，扣${item.penalty_points}分`;
        };
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
                    if (cached?.commentary)
                        commentary = cached.commentary;
                }
            } catch (error) {
                console.warn("AI report commentary skipped:", error?.message || error);
            }
        }
        const commentarySection = commentary ? `<div class="ai-commentary"><h2>AI 评语</h2><p>${escapeHtml(commentary)}</p><p class="note">* 评语由 AI 生成，仅供参考</p></div>` : "";
        const inclusiveEnd = new Date(new Date(range.end).getTime() - 1).toISOString();
        const comparisonRows = [
            ["任务通过", summary.approved, previousSummary.approved, deltaText(summary.approved, previousSummary.approved)],
            ["已审核通过率", rateText(summary.approvalRate), rateText(previousSummary.approvalRate), summary.approvalRate === null || previousSummary.approvalRate === null ? "—" : `${deltaText(summary.approvalRate, previousSummary.approvalRate)}个百分点`],
            ["净积分", signedText(summary.netPoints), signedText(previousSummary.netPoints), deltaText(summary.netPoints, previousSummary.netPoints)],
            ["表扬", summary.praiseCount, previousSummary.praiseCount, deltaText(summary.praiseCount, previousSummary.praiseCount)],
            ["批评", summary.criticismCount, previousSummary.criticismCount, deltaText(summary.criticismCount, previousSummary.criticismCount)],
            ["解锁成就", summary.achievementCount, previousSummary.achievementCount, deltaText(summary.achievementCount, previousSummary.achievementCount)],
        ];
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(child.display_name)} ${reportTitle}</title><style>${PRINT_A4_STYLE}</style></head><body><button onclick="window.print()">打印</button><h1>${escapeHtml(child.display_name)} ${reportTitle}</h1><p>周期：${escapeHtml(reportDateText(range.start, offset))} 至 ${escapeHtml(reportDateText(inclusiveEnd, offset))}；生成时间：${escapeHtml(localTimeText(nowIso(), offset))}</p><div class="summary"><div><span>当前积分</span><strong>${reportData.currentBalance}</strong></div><div><span>本期净积分</span><strong>${signedText(summary.netPoints)}</strong></div><div><span>已审核通过率</span><strong>${rateText(summary.approvalRate)}</strong></div><div><span>待审核</span><strong>${summary.pending}</strong></div><div><span>任务通过</span><strong>${summary.approved}</strong></div><div><span>成就解锁</span><strong>${summary.achievementCount}</strong></div></div>${actionSection}${commentarySection}<h2>与上一周期对比</h2>${tableHtml(["指标","本期","上期","变化"], comparisonRows)}<h2>任务明细</h2>${tableHtml(["任务","分类","状态","实际积分","审核意见","提交时间"], tasks.map((item) => [item.title, item.category_name || "未分类", TASK_STATUS_LABELS[item.status] || item.status, item.status === "approved" ? signedText(item.awardedPoints) : "—", item.review_note || item.awardNote || "", localTimeText(item.submitted_at, offset)]))}<h2>分类完成</h2>${tableHtml(["分类","通过次数"], reportData.categoryCounts)}<h2>积分来源</h2>${tableHtml(["来源","记录数","积分变化"], pointBreakdown.map((item) => [item.label, item.count, signedText(item.points)]))}${requiredEvents.length ? `<h2>必做任务异常</h2>${tableHtml(["任务","周期","实际/要求","结果"], requiredEvents.map((item) => [item.title, item.period_key, `${item.actual_count}/${item.required_count}`, requiredStatus(item)]))}` : ""}<h2>积分明细</h2>${tableHtml(["来源","内容","积分变化","时间"], ledger.map((item) => [item.sourceTypeLabel, item.sourceLabel, item.frozen_amount ? `冻结${item.frozen_amount}（账面${signedText(item.amount)}）` : signedText(item.amount), item.localCreatedAt]))}<h2>奖励记录</h2>${tableHtml(["奖励","状态","积分影响","申请时间"], rewards.map((item) => [item.title, REWARD_STATUS_LABELS[item.status] || item.status, signedText(rewardImpact(item)), localTimeText(item.requested_at, offset)]))}<h2>表扬与批评</h2>${tableHtml(["类型","条款","积分影响","状态","时间"], feedback.map((item) => [item.source_type === "praise" ? "表扬" : "批评", item.sourceLabel || item.note || "", item.frozen_amount ? `冻结${item.frozen_amount}` : signedText(item.amount), item.freeze_status === "frozen" ? "待补救" : item.freeze_status === "remedied" ? "已补救" : item.freeze_status === "settled" ? "已结算" : "已生效", item.localCreatedAt]))}<h2>成就解锁</h2>${tableHtml(["成就","解锁时间"], achievements.map((item) => [item.title, localTimeText(item.unlocked_at, offset)]))}${scheduleSection}</body></html>`;
        const visibleReportHtml = [
            [reportSections.actionItems, /<div class="attention">[\s\S]*?<\/div>/],
            [reportSections.aiCommentary, /<div class="ai-commentary">[\s\S]*?<\/div>/],
            [reportSections.comparison, /<h2>与上一周期对比<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.taskDetails, /<h2>任务明细<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.categorySummary, /<h2>分类完成<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.pointSources, /<h2>积分来源<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.requiredTaskExceptions, /<h2>必做任务异常<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.ledgerDetails, /<h2>积分明细<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.rewards, /<h2>奖励记录<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.feedback, /<h2>表扬与批评<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.achievements, /<h2>成就解锁<\/h2><table>[\s\S]*?<\/table>/],
            [reportSections.scheduleTemplate, /<h2>当前日程模板（参考）<\/h2>[\s\S]*?(?=<\/body>)/]
        ].reduce((output, [included, pattern]) => included ? output : output.replace(pattern, ""), html);
        return new Response(visibleReportHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const childWarehouse = path.match(/^\/children\/([^/]+)\/warehouse$/);
    if (childWarehouse && method === "GET") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
WHERE pl.child_id=? AND pl.parent_id=? AND pl.source_type IN ('praise','criticism') AND pl.revoked_at IS NULL AND datetime(pl.created_at)>=datetime(?)
ORDER BY datetime(pl.created_at) DESC, pl.created_at DESC, pl.id DESC`)
            .bind(child.id, a.id, cutoff)
            .all()).results;
        const offset = await timezoneOffsetMinutes(env);
        return ok(rows.map((row) => ({ ...row, localCreatedAt: localTimeText(row.created_at, offset) })));
    }
    if (feedbackEvent && method === "POST") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const audit = actorAudit(a);
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
        const isFrozenCriticism = template.kind === "criticism" && Number(template.is_remediable || 0) === 1;
        const frozenAmount = isFrozenCriticism ? points : 0;
        const amount = template.kind === "praise" ? points : isFrozenCriticism ? 0 : -points;
        const remedyPoints = isFrozenCriticism ? Math.max(0, Math.min(points, Number(template.remedy_points || 0))) : 0;
        const remedyDeadlineHours = isFrozenCriticism ? Math.max(1, Number(template.remedy_deadline_hours || 24)) : 0;
        const remedyDeadlineAt = isFrozenCriticism ? new Date(Date.now() + remedyDeadlineHours * 3600000).toISOString() : null;
        const now = nowIso();
        const label = template.kind === "praise" ? "表扬" : "批评";
        const note = template.description ? `${template.title}：${template.description}` : template.title;
        await env.DB.prepare(`INSERT INTO point_ledger
(id, child_id, parent_id, amount, source_type, source_id, period_key, note, actor_type, actor_id, actor_label_snapshot, effective_amount, frozen_amount, freeze_status, remedy_condition, remedy_points, remedy_deadline_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(ledgerId, child.id, a.id, amount, template.kind, template.id, note, audit.type, audit.id, audit.label, amount, frozenAmount, isFrozenCriticism ? "frozen" : "", isFrozenCriticism ? String(template.remedy_condition || "").trim() : "", remedyPoints, remedyDeadlineAt, now)
            .run();
        await recalcAchievements(env, a.id, child.id);
        await notify(env, {
            recipientType: "child",
            recipientId: child.id,
            actorType: audit.type,
            actorId: audit.id || a.id,
            actorLabel: audit.label,
            title: `收到一条${label}`,
            body: isFrozenCriticism ? `${note}，冻结 ${points} 积分。按要求补救后可挽回 ${remedyPoints} 积分。` : `${note}，${amount >= 0 ? "增加" : "扣除"} ${points} 积分。`,
            eventType: template.kind,
            relatedType: "point_ledger",
            relatedId: ledgerId,
            requiresAck: true,
            createdAt: now
        });
        return ok(true);
    }
    if (path === "/feedback-templates") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        if (method === "GET")
            return ok((await env.DB.prepare("SELECT * FROM feedback_templates WHERE parent_id=? AND deleted_at IS NULL ORDER BY kind, created_at DESC").bind(a.id).all()).results);
        const input = await body(request);
        if (method === "POST") {
            const kind = input.kind === "criticism" ? "criticism" : "praise";
            const title = String(input.title || "").trim();
            const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分");
            if (err) return fail("BAD_REQUEST", err, 400);
            const isRemediable = kind === "criticism" && input.isRemediable ? 1 : 0;
            const remedyPoints = Math.max(0, Math.min(Number(input.points || 0), Number(input.remedyPoints || 0)));
            const remedyDeadlineHours = Math.max(1, Number(input.remedyDeadlineHours || 24));
            await env.DB.prepare(`INSERT INTO feedback_templates
(id, parent_id, kind, title, description, points, icon_type, icon_value, is_active, is_remediable, remedy_condition, remedy_points, remedy_deadline_hours)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(id(), a.id, kind, title, input.description || "", Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1, isRemediable, isRemediable ? String(input.remedyCondition || "").trim() : "", isRemediable ? remedyPoints : 0, isRemediable ? remedyDeadlineHours : 24)
                .run();
            return ok(true);
        }
    }
    const feedbackPatch = path.match(/^\/feedback-templates\/([^/]+)$/);
    if (feedbackPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const kind = input.kind === "criticism" ? "criticism" : "praise";
        const title = String(input.title || "").trim();
        const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分");
        if (err) return fail("BAD_REQUEST", err, 400);
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        const isRemediable = kind === "criticism" && input.isRemediable ? 1 : 0;
        const remedyPoints = Math.max(0, Math.min(Number(input.points || 0), Number(input.remedyPoints || 0)));
        const remedyDeadlineHours = Math.max(1, Number(input.remedyDeadlineHours || 24));
        await env.DB.prepare("UPDATE feedback_templates SET kind=?, title=?, description=?, points=?, icon_type=?, icon_value=?, is_active=?, is_remediable=?, remedy_condition=?, remedy_points=?, remedy_deadline_hours=?, updated_at=? WHERE id=?")
            .bind(kind, title, input.description || "", Number(input.points || 0), input.iconType || "emoji", input.iconValue || (kind === "praise" ? "✨" : "⚠️"), input.isActive === false ? 0 : 1, isRemediable, isRemediable ? String(input.remedyCondition || "").trim() : "", isRemediable ? remedyPoints : 0, isRemediable ? remedyDeadlineHours : 24, nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (feedbackPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const found = await env.DB.prepare("SELECT id FROM feedback_templates WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(feedbackPatch[1], a.id).first();
        if (!found)
            return fail("NOT_FOUND", "表扬或批评条款不存在", 404);
        await env.DB.prepare("UPDATE feedback_templates SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), feedbackPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/task-categories") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
    if (path === "/task-sets") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await ensureTaskSetSchema(env);
        if (method === "GET") return ok(await listTaskSets(env, a.id));
        if (method === "POST") {
            const input = await body(request);
            const title = String(input.title || "").trim();
            const taskIds = [...new Set(Array.isArray(input.taskIds) ? input.taskIds.filter(Boolean) : [])];
            const error = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.description || "", INPUT_RULES.description, "说明") || validateEnum(input.iconType || "emoji", ["emoji"], "图标类型");
            if (error) return fail("BAD_REQUEST", error, 400);
            if (taskIds.length < 2) return fail("BAD_REQUEST", "任务集至少需要两个子任务", 400);
            const placeholders = taskIds.map(() => "?").join(",");
            const tasks = (await env.DB.prepare(`SELECT id FROM tasks WHERE parent_id=? AND id IN (${placeholders}) AND deleted_at IS NULL AND is_active=1 AND point_type='earn'`).bind(a.id, ...taskIds).all()).results;
            if (tasks.length !== taskIds.length) return fail("BAD_REQUEST", "子任务必须属于当前家庭、启用且为赚取积分任务", 400);
            const occupied = await env.DB.prepare(`SELECT task_id FROM task_set_members WHERE task_id IN (${placeholders})`).bind(...taskIds).all();
            if (occupied.results.length) return fail("CONFLICT", "子任务已属于其他任务集", 409);
            const eligible = await taskSetEligibleChildIds(env, a.id, taskIds);
            if (!eligible.length) return fail("BAD_REQUEST", "至少要有一名儿童同时拥有全部子任务", 400);
            const setId = id();
            await env.DB.transaction(async () => {
                await env.DB.prepare("INSERT INTO task_sets (id, parent_id, title, description, icon_type, icon_value, is_active) VALUES (?, ?, ?, ?, 'emoji', ?, ?)")
                    .bind(setId, a.id, title, input.description || "", input.iconValue || "🧩", input.isActive === false ? 0 : 1).run();
                for (let index = 0; index < taskIds.length; index++)
                    await env.DB.prepare("INSERT INTO task_set_members (task_set_id, task_id, sort_order) VALUES (?, ?, ?)").bind(setId, taskIds[index], index).run();
            });
            return ok({ id: setId });
        }
    }
    const taskSetPatch = path.match(/^\/task-sets\/([^/]+)$/);
    if (taskSetPatch && (method === "PATCH" || method === "DELETE")) {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        await ensureTaskSetSchema(env);
        const current = await env.DB.prepare("SELECT * FROM task_sets WHERE id=? AND parent_id=? AND deleted_at IS NULL").bind(taskSetPatch[1], a.id).first();
        if (!current) return fail("NOT_FOUND", "任务集不存在", 404);
        if (method === "DELETE") {
            if (await taskSetHasOpenProgress(env, current.id)) return fail("TASK_SET_IN_PROGRESS", "任务集有待审核或未结算进度，暂不能解散", 409);
            await env.DB.transaction(async () => {
                await env.DB.prepare("UPDATE task_sets SET deleted_at=?, is_active=0, updated_at=? WHERE id=?").bind(nowIso(), nowIso(), current.id).run();
                await env.DB.prepare("DELETE FROM task_set_members WHERE task_set_id=?").bind(current.id).run();
            });
            return ok(true);
        }
        const input = await body(request);
        const title = String(input.title || "").trim();
        const error = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.description || "", INPUT_RULES.description, "说明") || validateEnum(input.iconType || "emoji", ["emoji"], "图标类型");
        if (error) return fail("BAD_REQUEST", error, 400);
        const previousIds = (await env.DB.prepare("SELECT task_id FROM task_set_members WHERE task_set_id=? ORDER BY sort_order").bind(current.id).all()).results.map((row) => row.task_id);
        const taskIds = input.taskIds === undefined ? previousIds : [...new Set(Array.isArray(input.taskIds) ? input.taskIds.filter(Boolean) : [])];
        const structureChanged = taskIds.length !== previousIds.length || taskIds.some((taskId, index) => taskId !== previousIds[index]) || (input.isActive !== undefined && Number(current.is_active) !== (input.isActive === false ? 0 : 1));
        if (structureChanged && await taskSetHasOpenProgress(env, current.id)) return fail("TASK_SET_IN_PROGRESS", "任务集有待审核或未结算进度，只能修改标题、说明和图标", 409);
        if (taskIds.length < 2) return fail("BAD_REQUEST", "任务集至少需要两个子任务", 400);
        const placeholders = taskIds.map(() => "?").join(",");
        const tasks = (await env.DB.prepare(`SELECT id FROM tasks WHERE parent_id=? AND id IN (${placeholders}) AND deleted_at IS NULL AND is_active=1 AND point_type='earn'`).bind(a.id, ...taskIds).all()).results;
        if (tasks.length !== taskIds.length) return fail("BAD_REQUEST", "子任务必须属于当前家庭、启用且为赚取积分任务", 400);
        const occupied = await env.DB.prepare(`SELECT task_id FROM task_set_members WHERE task_id IN (${placeholders}) AND task_set_id<>?`).bind(...taskIds, current.id).all();
        if (occupied.results.length) return fail("CONFLICT", "子任务已属于其他任务集", 409);
        if (!(await taskSetEligibleChildIds(env, a.id, taskIds)).length) return fail("BAD_REQUEST", "至少要有一名儿童同时拥有全部子任务", 400);
        await env.DB.transaction(async () => {
            await env.DB.prepare("UPDATE task_sets SET title=?, description=?, icon_type='emoji', icon_value=?, is_active=?, updated_at=? WHERE id=?")
                .bind(title, input.description || "", input.iconValue || "🧩", input.isActive === false ? 0 : 1, nowIso(), current.id).run();
            if (structureChanged) {
                await env.DB.prepare("DELETE FROM task_set_members WHERE task_set_id=?").bind(current.id).run();
                for (let index = 0; index < taskIds.length; index++)
                    await env.DB.prepare("INSERT INTO task_set_members (task_set_id, task_id, sort_order) VALUES (?, ?, ?)").bind(current.id, taskIds[index], index).run();
            }
        });
        return ok(true);
    }
    if (path === "/tasks") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        if (method === "GET") {
            await Promise.all([ensureRequiredTaskSchema(env), ensureTaskSetSchema(env)]);
            return ok(await listWithAssignees(env, "tasks", a.id));
        }
        const input = await body(request);
        if (method === "POST") {
            const title = String(input.title || "").trim();
            const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
                || validateEnum(input.period || "daily", ["daily", "weekly", "monthly", "once"], "周期")
                || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型");
            if (err) return fail("BAD_REQUEST", err, 400);
            await validateCategoryOwnership(env, a.id, input.categoryId);
            await ensureRequiredTaskSchema(env);
            const taskId = id();
            const period = input.period || "daily";
            const deadline = taskSubmissionDeadline(input, period);
            if (deadline.error) return fail("BAD_REQUEST", deadline.error, 400);
            const isRequired = period !== "once" && input.isRequired ? 1 : 0;
            const requiredCount = isRequired ? Math.max(1, Number(input.requiredCount || 1)) : 0;
            const requiredPenaltyPoints = isRequired ? Math.max(0, Number(input.requiredPenaltyPoints || 0)) : 0;
            const requiredRemedy = taskRequiredRemedy(input, isRequired, requiredPenaltyPoints);
            if (requiredRemedy.error) return fail("BAD_REQUEST", requiredRemedy.error, 400);
            const grading = taskGrading(input);
            if (grading.error) return fail("BAD_REQUEST", grading.error, 400);
            await env.DB.prepare("INSERT INTO tasks (id, parent_id, category_id, title, description, period, point_type, points, icon_type, icon_value, limit_count, enabled_weekdays, is_active, is_required, required_count, required_penalty_points, required_remedy_enabled, required_remedy_condition, required_remedy_points, required_remedy_deadline_hours, grading_mode, completion_standards_json, submission_deadline_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(taskId, a.id, input.categoryId, title, input.description || "", period, "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1, isRequired, requiredCount, requiredPenaltyPoints, requiredRemedy.enabled, requiredRemedy.condition, requiredRemedy.points, requiredRemedy.deadlineHours, grading.gradingMode, JSON.stringify(grading.standards), deadline.value)
                .run();
            await replaceAssignees(env, a.id, "task_assignees", "task_id", taskId, input.childIds || []);
            return ok(true);
        }
    }
    const taskExemption = path.match(/^\/tasks\/([^/]+)\/required-penalty-exemptions$/);
    if (taskExemption && (method === "POST" || method === "DELETE")) {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        await ensureRequiredTaskSchema(env);
        const task = await env.DB.prepare("SELECT t.id, t.parent_id, t.period, t.required_count, t.title FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id AND ta.child_id=? JOIN children c ON c.id=ta.child_id AND c.parent_id=t.parent_id AND c.status='active' AND c.deleted_at IS NULL WHERE t.id=? AND t.parent_id=? AND t.is_required=1 AND t.required_count>0 AND t.is_active=1 AND t.deleted_at IS NULL")
            .bind(input.childId, taskExemption[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "可豁免的必做任务不存在", 404);
        const at = nowIso();
        const periodKeyValue = periodKey(task.period, at, await timezoneOffsetMinutes(env));
        const existing = await env.DB.prepare("SELECT id FROM task_required_penalties WHERE task_id=? AND child_id=? AND period_key=?")
            .bind(task.id, input.childId, periodKeyValue)
            .first();
        if (method === "DELETE") {
            if (!existing)
                return fail("NOT_FOUND", "本周期未豁免", 404);
            const exemption = await env.DB.prepare("SELECT id FROM task_required_penalties WHERE id=? AND parent_id=? AND penalty_points=0")
                .bind(existing.id, a.id)
                .first();
            if (!exemption)
                return fail("ALREADY_SETTLED", "本周期已结算，不能撤销豁免", 409);
            await env.DB.prepare("DELETE FROM task_required_penalties WHERE id=?")
                .bind(exemption.id)
                .run();
            return ok(true);
        }
        if (existing)
            return fail("ALREADY_SETTLED", "该任务本周期已结算或已豁免", 409);
        await env.DB.prepare("INSERT INTO task_required_penalties (id, task_id, child_id, parent_id, period_key, required_count, actual_count, penalty_points, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)")
            .bind(id(), task.id, input.childId, a.id, periodKeyValue, task.required_count, at)
            .run();
        return ok(true);
    }
    const deadlineExemption = path.match(/^\/tasks\/([^/]+)\/submission-deadline-exemptions$/);
    if (deadlineExemption && (method === "POST" || method === "DELETE")) {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        await ensureRequiredTaskSchema(env);
        const task = await env.DB.prepare("SELECT t.* FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id AND ta.child_id=? JOIN children c ON c.id=ta.child_id AND c.parent_id=t.parent_id AND c.status='active' AND c.deleted_at IS NULL WHERE t.id=? AND t.parent_id=? AND t.is_active=1 AND t.deleted_at IS NULL")
            .bind(input.childId, deadlineExemption[1], a.id)
            .first();
        if (!task || !normalizeTaskSubmissionDeadline(task.period, task.submission_deadline_json))
            return fail("NOT_FOUND", "可解除截止时间的任务不存在", 404);
        const periodKeyValue = periodKey(task.period, nowIso(), await timezoneOffsetMinutes(env));
        if (method === "DELETE") {
            const removed = await env.DB.prepare("DELETE FROM task_submission_deadline_exemptions WHERE task_id=? AND child_id=? AND parent_id=? AND period_key=?")
                .bind(task.id, input.childId, a.id, periodKeyValue)
                .run();
            if (!(removed.meta?.changes || 0))
                return fail("NOT_FOUND", "本周期未解除提交截止时间", 404);
            return ok(true);
        }
        const existing = await env.DB.prepare("SELECT 1 FROM task_submission_deadline_exemptions WHERE task_id=? AND child_id=? AND parent_id=? AND period_key=?")
            .bind(task.id, input.childId, a.id, periodKeyValue)
            .first();
        if (existing)
            return fail("ALREADY_SETTLED", "该任务本周期提交截止时间已解除", 409);
        await env.DB.prepare("INSERT INTO task_submission_deadline_exemptions (task_id, child_id, parent_id, period_key) VALUES (?, ?, ?, ?)")
            .bind(task.id, input.childId, a.id, periodKeyValue)
            .run();
        return ok(true);
    }
    const taskPatch = path.match(/^\/tasks\/([^/]+)$/);
    if (taskPatch && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const input = await body(request);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        const taskSetMember = await env.DB.prepare("SELECT task_set_id FROM task_set_members WHERE task_id=?").bind(taskPatch[1]).first();
        if (taskSetMember && await taskSetHasOpenProgress(env, taskSetMember.task_set_id)) {
            const currentChildIds = (await env.DB.prepare("SELECT child_id FROM task_assignees WHERE task_id=? ORDER BY child_id").bind(taskPatch[1]).all()).results.map((row) => row.child_id);
            const nextChildIds = [...new Set(Array.isArray(input.childIds) ? input.childIds : [])].sort();
            if (currentChildIds.join(",") !== nextChildIds.join(",") || input.isActive === false)
                return fail("TASK_SET_IN_PROGRESS", "任务集有进行中进度，暂不能改变子任务分配或停用子任务", 409);
        }
        const title = String(input.title || "").trim();
        const err = validateInput(title, INPUT_RULES.title, "标题") || validateInput(input.points, INPUT_RULES.points, "积分") || validateInput(input.limitCount, INPUT_RULES.limitCount, "次数限制")
            || validateEnum(input.period || "daily", ["daily", "weekly", "monthly", "once"], "周期")
            || validateEnum(input.iconType || "emoji", ["emoji", "gallery_image"], "图标类型");
        if (err) return fail("BAD_REQUEST", err, 400);
        await validateCategoryOwnership(env, a.id, input.categoryId);
        await ensureRequiredTaskSchema(env);
        const period = input.period || "daily";
        const deadline = taskSubmissionDeadline(input, period);
        if (deadline.error) return fail("BAD_REQUEST", deadline.error, 400);
        const isRequired = period !== "once" && input.isRequired ? 1 : 0;
        const requiredCount = isRequired ? Math.max(1, Number(input.requiredCount || 1)) : 0;
        const requiredPenaltyPoints = isRequired ? Math.max(0, Number(input.requiredPenaltyPoints || 0)) : 0;
        const requiredRemedy = taskRequiredRemedy(input, isRequired, requiredPenaltyPoints);
        if (requiredRemedy.error) return fail("BAD_REQUEST", requiredRemedy.error, 400);
        const grading = taskGrading(input);
        if (grading.error) return fail("BAD_REQUEST", grading.error, 400);
        await env.DB.prepare("UPDATE tasks SET category_id=?, title=?, description=?, period=?, point_type=?, points=?, icon_type=?, icon_value=?, limit_count=?, enabled_weekdays=?, is_active=?, is_required=?, required_count=?, required_penalty_points=?, required_remedy_enabled=?, required_remedy_condition=?, required_remedy_points=?, required_remedy_deadline_hours=?, grading_mode=?, completion_standards_json=?, submission_deadline_json=?, updated_at=? WHERE id=?")
            .bind(input.categoryId, title, input.description || "", period, "earn", Number(input.points || 0), input.iconType || "emoji", input.iconValue || "✅", Math.max(1, Number(input.limitCount || 1)), weekdayJson(input.enabledWeekdays || input.enabled_weekdays), input.isActive === false ? 0 : 1, isRequired, requiredCount, requiredPenaltyPoints, requiredRemedy.enabled, requiredRemedy.condition, requiredRemedy.points, requiredRemedy.deadlineHours, grading.gradingMode, JSON.stringify(grading.standards), deadline.value, nowIso(), taskPatch[1])
            .run();
        await replaceAssignees(env, a.id, "task_assignees", "task_id", taskPatch[1], input.childIds || []);
        return ok(true);
    }
    if (taskPatch && method === "DELETE") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND parent_id=? AND deleted_at IS NULL")
            .bind(taskPatch[1], a.id)
            .first();
        if (!task)
            return fail("NOT_FOUND", "任务不存在", 404);
        const taskSetMember = await env.DB.prepare("SELECT task_set_id FROM task_set_members WHERE task_id=?").bind(taskPatch[1]).first();
        if (taskSetMember && await taskSetHasOpenProgress(env, taskSetMember.task_set_id))
            return fail("TASK_SET_IN_PROGRESS", "任务集有进行中进度，暂不能删除子任务", 409);
        if (taskSetMember)
            return fail("TASK_SET_MEMBER", "请先在任务集中移除此子任务，再删除任务", 409);
        await env.DB.prepare("UPDATE tasks SET deleted_at=?, is_active=0, updated_at=? WHERE id=?")
            .bind(nowIso(), nowIso(), taskPatch[1])
            .run();
        return ok(true);
    }
    if (path === "/rewards") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
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
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const result = await deleteAchievementWithExclusiveReward(env, a.id, achievementPatch[1]);
        if (!result)
            return fail("NOT_FOUND", "成就称号不存在", 404);
        return ok(result);
    }
    const review = path.match(/^\/task-submissions\/([^/]+)\/review$/);
    if (review && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const audit = actorAudit(a);
        const input = await body(request);
        const sub = await env.DB.prepare("SELECT s.*, t.title, t.point_type, t.points, t.grading_mode, t.completion_standards_json FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND s.parent_id=? AND s.status='pending'")
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
        const standards = status === "approved" && sub.grading_mode === "completion" ? completionStandards(sub) : [];
        const selectedStandard = standards.find((item) => item.label === String(input.completionLabel || input.completion_label || ""));
        if (status === "approved" && sub.grading_mode === "completion" && !selectedStandard)
            return fail("BAD_REQUEST", "该任务需要在家长待办中选择完成程度标准", 400);
        const awardedPoints = selectedStandard ? selectedStandard.points : Number(sub.points);
        const reviewNote = selectedStandard ? `任务审核通过：${selectedStandard.label}` : "任务审核通过";
        let settlement = null;
        await env.DB.transaction(async () => {
            await env.DB.prepare("UPDATE task_submissions SET status=?, reviewed_at=?, review_note=?, approved_points=? WHERE id=?")
                .bind(status, nowIso(), input.note || "", status === "approved" ? awardedPoints : null, sub.id).run();
            if (status === "approved") {
                if (sub.task_set_id) {
                    settlement = await settleTaskSetIfReady(env, { ...sub, parent_id: a.id }, audit);
                } else {
                    await env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, actor_type, actor_id, actor_label_snapshot) VALUES (?, ?, ?, ?, 'task', ?, ?, ?, ?, ?, ?)")
                        .bind(id(), sub.child_id, a.id, signedPoints(sub.point_type, awardedPoints), sub.id, sub.period_key, reviewNote, audit.type, audit.id, audit.label).run();
                }
                await env.DB.prepare(`INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, actor_type, actor_id, actor_label_snapshot)
SELECT ?, p.child_id, p.parent_id, p.penalty_points, 'task_required_penalty', p.task_id, p.period_key, '跨周期审核通过，退回必做扣分', ?, ?, ?
FROM task_required_penalties p
WHERE p.task_id=? AND p.child_id=? AND p.parent_id=? AND p.period_key=? AND p.penalty_points>0
  AND (SELECT COUNT(*) FROM task_submissions WHERE task_id=p.task_id AND child_id=p.child_id AND parent_id=p.parent_id AND period_key=p.period_key AND status='approved') >= p.required_count
  AND NOT EXISTS (SELECT 1 FROM point_ledger WHERE child_id=p.child_id AND parent_id=p.parent_id AND source_type='task_required_penalty' AND source_id=p.task_id AND period_key=p.period_key AND amount>0)`)
                    .bind(id(), audit.type, audit.id, audit.label, sub.task_id, sub.child_id, a.id, sub.period_key).run();
            }
            await env.DB.prepare("UPDATE notifications SET read_at=? WHERE recipient_type='user' AND recipient_id=? AND related_type='task_submission' AND related_id=? AND read_at IS NULL")
                .bind(nowIso(), a.id, sub.id).run();
        });
        if (status === "approved") {
            await recalcAchievements(env, a.id, sub.child_id);
        }
        const taskSetResult = settlement?.taskSet ? settlement : null;
        await notify(env, {
            recipientType: "child",
            recipientId: sub.child_id,
            actorType: audit.type,
            actorId: audit.id || a.id,
            actorLabel: audit.label,
            title: status === "approved" ? taskSetResult?.settled ? "任务集已完成" : "任务审核通过" : "任务被驳回",
            body: status === "approved"
                ? taskSetResult ? (taskSetResult.settled ? `任务集「${taskSetResult.taskSet.title}」已完成，获得 ${taskSetResult.totalPoints} 积分。` : `「${sub.title || "子任务"}」已通过，任务集「${taskSetResult.taskSet.title}」进度 ${taskSetResult.progress.approved}/${taskSetResult.progress.total}，暂未单独加分。`)
                    : (selectedStandard ? `家长已按「${selectedStandard.label}」通过你的任务，积分已结算。` : "家长已通过你的任务，积分已结算。")
                : input.note || "家长驳回了这次任务提交。",
            eventType: status === "approved" ? taskSetResult?.settled ? "task_set_completed" : "task_approved" : "task_rejected",
            relatedType: taskSetResult?.settled ? "task_set_settlement" : "task_submission",
            relatedId: taskSetResult?.settled ? taskSetResult.settlementId : sub.id
        });
        return ok({ settled: !!taskSetResult?.settled, totalPoints: taskSetResult?.totalPoints || 0, progress: taskSetResult?.progress || null });
    }
    const redemptionAction = path.match(/^\/reward-redemptions\/([^/]+)\/(redeem|cancel)$/);
    if (redemptionAction && method === "PATCH") {
        const a = requireRole(actor, ["parent", "parent_delegate"]);
        const audit = actorAudit(a);
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
                env.DB.prepare("INSERT INTO point_ledger (id, child_id, parent_id, amount, source_type, source_id, period_key, note, actor_type, actor_id, actor_label_snapshot) VALUES (?, ?, ?, ?, 'reward_cancel', ?, ?, ?, ?, ?, ?)")
                    .bind(cancelLedgerId, redemption.child_id, a.id, Number(redemption.cost_points), redemption.id, redemption.period_key, "取消兑换退回", audit.type, audit.id, audit.label)
            ]);
            await recalcAchievements(env, a.id, redemption.child_id);
        }
        await notify(env, {
            recipientType: "child",
            recipientId: redemption.child_id,
            actorType: audit.type,
            actorId: audit.id || a.id,
            actorLabel: audit.label,
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
