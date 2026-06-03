export async function api<T>(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {};
  if (options.method && options.method !== "GET" && options.method !== "HEAD") {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> || {}) }
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("app:unauthorized"));
    throw new Error("登录已过期");
  }
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "请求失败");
  return payload.data as T;
}
