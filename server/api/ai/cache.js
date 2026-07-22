import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, ensureColumn, oncePerDb } from "../utils.js";

export function aiConfigHash(config) {
    const hash = ["sha256", config.baseUrl || "", config.model || "", config.prompt || ""].join("|");
    const chars = [];
    let h = 0;
    for (let i = 0; i < hash.length; i++) {
        h = ((h << 5) - h) + hash.charCodeAt(i);
        h |= 0;
        chars.push((h >>> 0).toString(36).slice(-2));
    }
    return chars.slice(0, 8).join("");
}

export function aiReportConfigHash(config, periodType) {
    const promptKey = periodType === "monthly" ? "monthlyPrompt" : "reportPrompt";
    const hash = ["sha256", config.baseUrl || "", config.model || "", config[promptKey] || ""].join("|");
    const chars = [];
    let h = 0;
    for (let i = 0; i < hash.length; i++) {
        h = ((h << 5) - h) + hash.charCodeAt(i);
        h |= 0;
        chars.push((h >>> 0).toString(36).slice(-2));
    }
    return chars.slice(0, 8).join("");
}

export function aiImageConfigHash(config) {
    const hash = ["sha256", config.imageBaseUrl || "", config.imageModel || "", config.imagePrompt || "", config.imageSize || "", config.imageQuality || "", config.imageFormat || "", config.imageN || ""].join("|");
    const chars = [];
    let h = 0;
    for (let i = 0; i < hash.length; i++) {
        h = ((h << 5) - h) + hash.charCodeAt(i);
        h |= 0;
        chars.push((h >>> 0).toString(36).slice(-2));
    }
    return chars.slice(0, 8).join("");
}

export async function getParentAiServiceConfig(env, parentId) {
    try {
        await ensureParentAiServiceSettings(env);
        const row = await env.DB.prepare("SELECT base_url, api_key, model, prompt, report_prompt, monthly_prompt, image_base_url, image_api_key, image_model, image_prompt, image_size, image_quality, image_format, image_n, checklist_image_prompt, schedule_image_prompt, updated_at FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
        return {
            baseUrl: row?.base_url || "",
            apiKey: row?.api_key || "",
            model: row?.model || "",
            prompt: row?.prompt || "",
            reportPrompt: row?.report_prompt || "",
            monthlyPrompt: row?.monthly_prompt || "",
            imageBaseUrl: row?.image_base_url || "",
            imageApiKey: row?.image_api_key || "",
            imageModel: row?.image_model || "gpt-image-2",
            imagePrompt: row?.image_prompt || "",
            imageSize: row?.image_size || "1248x1760",
            imageQuality: row?.image_quality || "low",
            imageFormat: row?.image_format || "jpeg",
            imageN: Number(row?.image_n || 1),
            checklistImagePrompt: row?.checklist_image_prompt || "",
            scheduleImagePrompt: row?.schedule_image_prompt || "",
            hasKey: !!row?.api_key,
            hasImageKey: !!row?.image_api_key,
            updatedAt: row?.updated_at || "",
        };
    }
    catch {
        return { baseUrl: "", apiKey: "", model: "", prompt: "", reportPrompt: "", monthlyPrompt: "", imageBaseUrl: "", imageApiKey: "", imageModel: "gpt-image-2", imagePrompt: "", checklistImagePrompt: "", scheduleImagePrompt: "", imageSize: "1248x1760", imageQuality: "low", imageFormat: "jpeg", imageN: 1, hasKey: false, hasImageKey: false, updatedAt: "" };
    }
}

const greetingLimit = (text) => Array.from(String(text || "")).slice(0, 200).join("");

export async function loadAiGreetingSnapshot(env, child, offset) {
    if (!child?.ai_enabled)
        return { greeting: "", aiRefreshPending: false };
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
        return { greeting: "", aiRefreshPending: false };
    const configHash = aiConfigHash(config);
    const now = nowIso();
    const dayKey = periodKey("daily", now, offset);
    const cached = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? AND previous_week_key=? AND config_hash=?")
        .bind(child.id, dayKey, configHash)
        .first();
    if (cached?.greeting)
        return { greeting: greetingLimit(cached.greeting), aiRefreshPending: false };
    const stale = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? ORDER BY generated_at DESC LIMIT 1")
        .bind(child.id)
        .first();
    return { greeting: greetingLimit(stale?.greeting), aiRefreshPending: true };
}

async function ensureParentAiServiceSettingsNow(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parent_ai_service_settings (
  parent_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  report_prompt TEXT NOT NULL DEFAULT '',
  monthly_prompt TEXT NOT NULL DEFAULT '',
  image_base_url TEXT NOT NULL DEFAULT '',
  image_api_key TEXT NOT NULL DEFAULT '',
  image_model TEXT NOT NULL DEFAULT 'gpt-image-2',
  image_prompt TEXT NOT NULL DEFAULT '',
  image_size TEXT NOT NULL DEFAULT '1248x1760',
  image_quality TEXT NOT NULL DEFAULT 'low',
  image_format TEXT NOT NULL DEFAULT 'jpeg',
  image_n INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
)`).run();
    await ensureColumn(env, "parent_ai_service_settings", "report_prompt", "report_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "monthly_prompt", "monthly_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_base_url", "image_base_url TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_api_key", "image_api_key TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_model", "image_model TEXT NOT NULL DEFAULT 'gpt-image-2'");
    await ensureColumn(env, "parent_ai_service_settings", "image_prompt", "image_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "image_size", "image_size TEXT NOT NULL DEFAULT '1248x1760'");
    await ensureColumn(env, "parent_ai_service_settings", "image_quality", "image_quality TEXT NOT NULL DEFAULT 'low'");
    await ensureColumn(env, "parent_ai_service_settings", "image_format", "image_format TEXT NOT NULL DEFAULT 'jpeg'");
    await ensureColumn(env, "parent_ai_service_settings", "image_n", "image_n INTEGER NOT NULL DEFAULT 1");
    await ensureColumn(env, "parent_ai_service_settings", "checklist_image_prompt", "checklist_image_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "schedule_image_prompt", "schedule_image_prompt TEXT NOT NULL DEFAULT ''");
}
export function ensureParentAiServiceSettings(env) {
    return oncePerDb(env, "parent-ai-service-settings", () => ensureParentAiServiceSettingsNow(env));
}

async function ensureAiReportCommentariesNow(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_report_commentaries (
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES users(id),
  period_key TEXT NOT NULL,
  period_type TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  commentary TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, period_key, period_type, config_hash)
)`).run();
}
export function ensureAiReportCommentaries(env) {
    return oncePerDb(env, "ai-report-commentaries", () => ensureAiReportCommentariesNow(env));
}
