import { isPrivateUrl } from "../utils.js";

export const AI_FETCH_TIMEOUT_MS = 120000;
export const AI_MAX_OUTPUT_LENGTH = 120;

export class AiProviderError extends Error {
    constructor(message, { status = 0, code = "AI_PROVIDER_ERROR", retryable = true } = {}) {
        super(message);
        this.name = "AiProviderError";
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

export function truncateAiOutput(text) {
    if (!text) return "";
    return text.length > AI_MAX_OUTPUT_LENGTH ? text.slice(0, AI_MAX_OUTPUT_LENGTH) + "…" : text;
}

export function stripAiThinking(text) {
    if (!text) return "";
    let value = String(text);
    value = value.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
    value = value.replace(/<think\b[^>]*>[\s\S]*$/gi, "");
    value = value.replace(/<\/think>/gi, "");
    return value;
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
    const throwOnError = !!options?.throwOnError;
    const maxEmptyRetries = options?.maxEmptyRetries ?? 3;
    if (!baseUrl || !apiKey || !model)
        return "";
    if (isPrivateUrl(baseUrl))
        return "";
    const providerName = options?.provider || detectProvider(baseUrl);
    const provider = providerOrOpenAI(providerName);
    for (let attempt = 0; attempt <= maxEmptyRetries; attempt++) {
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
            if (!resp.ok) {
                if (throwOnError) {
                    throw new AiProviderError(`AI service request failed with ${resp.status}`, {
                        status: resp.status,
                        code: resp.status === 429 ? "AI_RATE_LIMITED" : "AI_SERVICE_ERROR",
                        retryable: resp.status === 429 || resp.status >= 500
                    });
                }
                return "";
            }
            const data = await resp.json();
            const text = stripAiThinking(provider.parseChatResponse(data));
            const cleaned = text.replace(/\s+/g, " ").trim().replace(/，+/g, "，").replace(/。+/g, "。");
            const result = noTruncate ? cleaned : truncateAiOutput(cleaned);
            if (result)
                return result;
            if (attempt < maxEmptyRetries)
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            else
                return "";
        }
        catch (error) {
            if (throwOnError) {
                if (error instanceof AiProviderError) throw error;
                throw new AiProviderError(error?.name === "AbortError" ? "AI service request timed out" : "AI service request failed", {
                    code: error?.name === "AbortError" ? "AI_TIMEOUT" : "AI_NETWORK_ERROR",
                    retryable: true
                });
            }
            return "";
        }
    }
    return "";
}

export async function callParentAiServiceForReport(env, prompt, config) {
    return callParentAiService(env, prompt, config, { maxTokens: 600, noTruncate: true });
}

function imageDataUrl(format, value) {
    const cleanFormat = ["png", "jpeg", "webp"].includes(format) ? format : "jpeg";
    return `data:image/${cleanFormat};base64,${value}`;
}

function parseImageResponse(data, format) {
    const first = Array.isArray(data?.data) ? data.data[0] : null;
    const raw = first?.url || first?.b64_json || data?.url || data?.b64_json || data?.choices?.[0]?.message?.content || "";
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
    const urlMatch = value.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) return urlMatch[0];
    const base64Match = value.match(/(?:data:image\/[a-z]+;base64,)?([A-Za-z0-9+/=]{80,})/);
    if (base64Match) {
        if (value.startsWith("data:image/")) return value;
        return imageDataUrl(format, base64Match[1]);
    }
    return "";
}

export async function callParentImageService(env, prompt, config) {
    const baseUrl = config?.imageBaseUrl || "";
    const apiKey = config?.imageApiKey || "";
    const model = config?.imageModel || "gpt-image-2";
    const format = config?.imageFormat || "jpeg";
    if (!baseUrl || !apiKey || !model || !prompt) {
        throw new AiProviderError("Image AI config is incomplete", { code: "AI_CONFIG_INCOMPLETE", retryable: false });
    }
    if (isPrivateUrl(baseUrl)) {
        throw new AiProviderError("Image AI base URL is not allowed", { code: "AI_PRIVATE_URL", retryable: false });
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
    try {
        const endpoint = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json",
                authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                prompt,
                n: config?.imageN || 1,
                size: config?.imageSize || "1248x1760",
                quality: config?.imageQuality || "low",
                format
            }),
            signal: controller.signal,
            redirect: "manual",
        });
        clearTimeout(timeoutId);
        if (resp.status === 0 || resp.type === "opaqueredirect") {
            throw new AiProviderError("Image AI redirects are not allowed", { status: resp.status, code: "AI_SERVICE_ERROR", retryable: false });
        }
        if (!resp.ok) {
            throw new AiProviderError(`Image AI request failed with ${resp.status}`, {
                status: resp.status,
                code: resp.status === 429 ? "AI_RATE_LIMITED" : "AI_SERVICE_ERROR",
                retryable: resp.status === 429 || resp.status >= 500
            });
        }
        const data = await resp.json().catch(() => ({}));
        const imageUrl = parseImageResponse(data, format);
        if (!imageUrl) {
            throw new AiProviderError("Image AI response did not include an image", { code: "AI_EMPTY_IMAGE", retryable: false });
        }
        return imageUrl;
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError(error?.name === "AbortError" ? "Image AI request timed out" : "Image AI request failed", {
            code: error?.name === "AbortError" ? "AI_TIMEOUT" : "AI_NETWORK_ERROR",
            retryable: true
        });
    }
}
