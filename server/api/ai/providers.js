import { isPrivateUrl } from "../utils.js";

export const AI_FETCH_TIMEOUT_MS = 15000;
export const AI_MAX_OUTPUT_LENGTH = 120;

export function truncateAiOutput(text) {
    if (!text) return "";
    return text.length > AI_MAX_OUTPUT_LENGTH ? text.slice(0, AI_MAX_OUTPUT_LENGTH) + "…" : text;
}

export function detectProvider(baseUrl) {
    if (!baseUrl) return "openai";
    const url = baseUrl.toLowerCase();
    if (url.includes("anthropic.com")) return "anthropic";
    return "openai";
}

const PROVIDERS = {
    openai: {
        chatEndpoint: "/chat/completions",
        chatHeaders: (apiKey) => ({ "content-type": "application/json", authorization: `Bearer ${apiKey}` }),
        buildChatBody: (model, messages, maxTokens) => JSON.stringify({ model, messages, max_tokens: maxTokens }),
        parseChatResponse: (data) => data?.choices?.[0]?.message?.content || "",
    },
    anthropic: {
        chatEndpoint: "/v1/messages",
        chatHeaders: (apiKey) => ({ "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
        buildChatBody: (model, messages, maxTokens) => JSON.stringify({ model, messages, max_tokens: maxTokens }),
        parseChatResponse: (data) => data?.content?.[0]?.text || "",
    },
};

function providerOrOpenAI(provider) {
    return PROVIDERS[provider] || PROVIDERS.openai;
}

async function tryListModels(url, headers) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(url, { headers, signal: controller.signal, redirect: "manual" });
        clearTimeout(timeoutId);
        if (!resp.ok) return null;
        const body = await resp.json().catch(() => ({}));
        let raw = [];
        if (Array.isArray(body.data)) raw = body.data;
        else if (Array.isArray(body.models)) raw = body.models;
        else if (Array.isArray(body)) raw = body;
        return raw
            .map((item) => (typeof item === "string" ? item : item?.id || item?.name || item?.model))
            .filter((v) => typeof v === "string" && v.trim())
            .map((v) => v.trim());
    }
    catch {
        clearTimeout(timeoutId);
        return null;
    }
}

export async function listModels(baseUrl, apiKey) {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
    const candidates = [`${baseUrl}/models`, `${baseUrl}/v1/models`];
    for (const url of candidates) {
        const result = await tryListModels(url, headers);
        if (result && result.length > 0) return result;
    }
    return [];
}

export async function callParentAiService(env, prompt, config, options = {}) {
    const baseUrl = config?.baseUrl || "";
    const apiKey = config?.apiKey || "";
    const model = config?.model || "";
    const maxTokens = options?.maxTokens ?? 300;
    const noTruncate = !!options?.noTruncate;
    if (!baseUrl || !apiKey || !model)
        return "";
    if (isPrivateUrl(baseUrl))
        return "";
    const providerName = options?.provider || detectProvider(baseUrl);
    const provider = providerOrOpenAI(providerName);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
        const endpoint = `${baseUrl.replace(/\/+$/, "")}${provider.chatEndpoint}`;
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: provider.chatHeaders(apiKey),
            body: provider.buildChatBody(model, [{ role: "user", content: prompt }], maxTokens),
            signal: controller.signal,
            redirect: "manual",
        });
        clearTimeout(timeoutId);
        if (resp.status === 0 || resp.type === "opaqueredirect") return "";
        if (!resp.ok) return "";
        const data = await resp.json();
        const text = provider.parseChatResponse(data);
        const cleaned = text.replace(/\s+/g, " ").trim().replace(/，+/g, "，").replace(/。+/g, "。");
        return noTruncate ? cleaned : truncateAiOutput(cleaned);
    }
    catch {
        return "";
    }
}

export async function callParentAiServiceForReport(env, prompt, config) {
    return callParentAiService(env, prompt, config, { maxTokens: 600, noTruncate: true });
}
