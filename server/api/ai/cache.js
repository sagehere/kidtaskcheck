import { periodKey, reportWindowRange } from "../../../src/lib/domain.js";
import { nowIso, ensureColumn } from "../utils.js";

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

export async function getParentAiServiceConfig(env, parentId) {
    try {
        await ensureParentAiServiceSettings(env);
        const row = await env.DB.prepare("SELECT base_url, api_key, model, prompt, report_prompt, monthly_prompt, updated_at FROM parent_ai_service_settings WHERE parent_id=?").bind(parentId).first();
        return {
            baseUrl: row?.base_url || "",
            apiKey: row?.api_key || "",
            model: row?.model || "",
            prompt: row?.prompt || "",
            reportPrompt: row?.report_prompt || "",
            monthlyPrompt: row?.monthly_prompt || "",
            hasKey: !!row?.api_key,
            updatedAt: row?.updated_at || "",
        };
    }
    catch {
        return { baseUrl: "", apiKey: "", model: "", prompt: "", reportPrompt: "", monthlyPrompt: "", hasKey: false, updatedAt: "" };
    }
}

export async function loadAiGreetingSnapshot(env, child, offset) {
    if (!child?.ai_enabled)
        return { greeting: "", aiRefreshPending: false };
    const config = await getParentAiServiceConfig(env, child.parent_id);
    if (!config.baseUrl || !config.apiKey || !config.model || !config.prompt)
        return { greeting: "", aiRefreshPending: false };
    const configHash = aiConfigHash(config);
    const now = nowIso();
    const range = reportWindowRange("weekly", now, offset);
    const weekKey = periodKey("weekly", range.start, offset);
    const cached = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? AND previous_week_key=? AND config_hash=?")
        .bind(child.id, weekKey, configHash)
        .first();
    if (cached?.greeting)
        return { greeting: cached.greeting, aiRefreshPending: false };
    const stale = await env.DB.prepare("SELECT greeting FROM ai_child_greetings WHERE child_id=? ORDER BY generated_at DESC LIMIT 1")
        .bind(child.id)
        .first();
    return { greeting: stale?.greeting || "", aiRefreshPending: true };
}

export async function ensureParentAiServiceSettings(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS parent_ai_service_settings (
  parent_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  report_prompt TEXT NOT NULL DEFAULT '',
  monthly_prompt TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
)`).run();
    await ensureColumn(env, "parent_ai_service_settings", "report_prompt", "report_prompt TEXT NOT NULL DEFAULT ''");
    await ensureColumn(env, "parent_ai_service_settings", "monthly_prompt", "monthly_prompt TEXT NOT NULL DEFAULT ''");
}

export async function ensureAiReportCommentaries(env) {
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
