import { Logger } from "@nestjs/common";

const logger = new Logger("Fetch");

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

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

    const contentLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      controller.abort();
      clearTimeout(timer);
      const message = `Размер ответа слишком большой: ${contentLength} байт (максимум ${MAX_RESPONSE_BYTES})`;
      if (!silent) logger.error({ url, method, size: contentLength }, message);
      return { ok: false, status: 0, data: null, error: message };
    }

    const contentType = res.headers.get("content-type") ?? "";
    let data: T | null = null;

    const rawBody = await readBody(res);
    if (rawBody !== null) {
      if (contentType.includes("application/json")) {
        data = JSON.parse(rawBody) as T;
      } else if (rawBody.length > 0) {
        data = rawBody as unknown as T;
      }
    }

    clearTimeout(timer);

    if (!res.ok) {
      const error =
        data && typeof data === "object" && "errorMessage" in data
          ? (data as { errorMessage: string }).errorMessage
          : `HTTP ${res.status}`;

      if (!silent)
        logger.error(
          { url, method, status: res.status, error },
          "HTTP-запрос завершился с ошибкой",
        );

      return { ok: false, status: res.status, data, error };
    }

    if (!silent) logger.debug({ url, method, status: res.status }, "HTTP-запрос выполнен");

    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Request timeout"
        : err instanceof Error
          ? err.message
          : "Unknown error";
    if (!silent) logger.error({ url, method, error: message }, "HTTP-запрос не выполнен");

    return { ok: false, status: 0, data: null, error: message };
  }
}

async function readBody(res: Response): Promise<string | null> {
  if (res.status === 204) return null;

  const reader = res.body?.getReader();
  if (!reader) {
    return res.text();
  }

  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(
          `Размер ответа слишком большой: ${received} байт (максимум ${MAX_RESPONSE_BYTES})`,
        );
      }
      chunks.push(value);
    }
  }

  return decoder.decode(concatChunks(chunks, received));
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
