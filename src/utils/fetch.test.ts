import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { limaFetch } from "./fetch";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

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
    return new Promise((resolve) =>
      setTimeout(() => resolve(new Response("slow", { status: 200 })), 5000),
    );
  }

  return new Response("Unknown", { status: 404 });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: handleRequest });
  baseUrl = `http://localhost:${server.port}`;
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
    const res = await limaFetch("http://localhost:19999/nonexistent", {
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
});
