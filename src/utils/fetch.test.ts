import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { limaFetch } from "./fetch";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

const MEGABYTE = 1024 * 1024;

function handleRequest(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/get") {
    return Response.json({ hello: "world" });
  }

  if (url.pathname === "/404") {
    return new Response("Not found", { status: 404 });
  }

  if (url.pathname === "/post") {
    return req.json().then((body) => Response.json({ json: body }));
  }

  if (url.pathname === "/slow") {
    return new Promise((resolve) => {
      setTimeout(() => resolve(new Response("slow", { status: 200 })), 5000);
    });
  }

  if (url.pathname === "/huge-body") {
    return new Response(new Uint8Array(11 * MEGABYTE), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url.pathname === "/huge-chunked") {
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 15; i++) {
          controller.enqueue(new Uint8Array(MEGABYTE).fill(0x61));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/plain" } });
  }

  if (url.pathname === "/slow-body") {
    const encoder = new TextEncoder();
    let interval: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("partial"));
        interval = setInterval(() => controller.enqueue(encoder.encode(".")), 20);
      },
      cancel() {
        if (interval) clearInterval(interval);
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/plain" } });
  }

  return new Response("Unknown", { status: 404 });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: handleRequest });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop();
});

describe("yggFetch", () => {
  it("возвращает ok=true и данные при успешном GET", async () => {
    const res = await limaFetch<{ hello: string }>(`${baseUrl}/get`, { silent: true });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hello: "world" });
  });

  it("возвращает ok=false при 404", async () => {
    const res = await limaFetch(`${baseUrl}/404`, { silent: true });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("возвращает ok=false при сетевой ошибке", async () => {
    const res = await limaFetch("http://127.0.0.1:19999/nonexistent", {
      timeout: 1000,
      silent: true,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("корректно отправляет POST с JSON body", async () => {
    const res = await limaFetch<{ json: Record<string, unknown> }>(`${baseUrl}/post`, {
      method: "POST",
      body: { test: "value" },
      silent: true,
    });

    expect(res.ok).toBe(true);
    expect(res.data?.json).toEqual({ test: "value" });
  });

  it("корректно обрабатывает timeout", async () => {
    const res = await limaFetch(`${baseUrl}/slow`, { timeout: 100, silent: true });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Request timeout");
  });

  it("отклоняет ответ с content-length больше лимита", async () => {
    const res = await limaFetch(`${baseUrl}/huge-body`, { silent: true });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toContain("слишком большой");
  });

  it("очищает таймер таймаута при отказе по content-length", async () => {
    const original = globalThis.clearTimeout;
    let cleared = 0;
    globalThis.clearTimeout = ((id: Parameters<typeof original>[0]) => {
      cleared += 1;
      return original(id);
    }) as typeof clearTimeout;

    try {
      const res = await limaFetch(`${baseUrl}/huge-body`, { silent: true });

      expect(res.ok).toBe(false);
      expect(cleared).toBeGreaterThan(0);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  it("отклоняет chunked-ответ, превысивший лимит при чтении", async () => {
    const res = await limaFetch(`${baseUrl}/huge-chunked`, { silent: true });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toContain("слишком большой");
  });

  it("таймаут покрывает чтение зависшего тела, а не только заголовки", async () => {
    const res = await limaFetch(`${baseUrl}/slow-body`, { timeout: 150, silent: true });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Request timeout");
  });
});
