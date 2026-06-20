export interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  silent?: boolean;
}

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function limaFetch<T>(url: string, options?: FetchOptions): Promise<FetchResult<T>> {
  const {
    method = "GET",
    body,
    headers: extraHeaders,
    timeout = 10_000,
    silent = false,
  } = options ?? {};
  const headers: Record<string, string> = {
    ...extraHeaders,
  };

  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body !== undefined) init.body = JSON.stringify(body);

  try {
    const res = await fetch(url, init);

    clearTimeout(timer);

    const contentType = res.headers.get("content-type") ?? "";
    let data: T | null = null;

    if (contentType.includes("application/json")) {
      data = (await res.json()) as T;
    } else if (res.status !== 204) {
      const text = await res.text();
      if (text.length > 0) {
        data = text as unknown as T;
      }
    }

    if (!res.ok) {
      const error =
        data && typeof data === "object" && "errorMessage" in data
          ? (data as { errorMessage: string }).errorMessage
          : `HTTP ${res.status}`;

      if (!silent) console.warn("[Fetch]", { url, method, status: res.status, error });

      return { ok: false, status: res.status, data, error };
    }

    if (!silent) console.debug("[Fetch]", { url, method, status: res.status });

    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Request timeout"
        : err instanceof Error
          ? err.message
          : "Unknown error";
    if (!silent) console.error("[Fetch]", { url, method, error: message });

    return { ok: false, status: 0, data: null, error: message };
  }
}
