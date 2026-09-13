import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "path";
import type { INestApplication } from "@nestjs/common";
import { bootstrap } from "./main";
import { setupTestEnv } from "./utils/tests/test-env";

setupTestEnv();
delete process.env["CORS_ORIGINS"];
process.env["PORT"] = "0";

const staticFixtureName = "bootstrap-e2e-fixture.txt";
const staticFixtureBody = "bootstrap-e2e";

const originOf = async (app: INestApplication): Promise<string> => {
  const url = new URL(await app.getUrl());
  url.hostname = "127.0.0.1";
  return url.toString().replace(/\/$/, "");
};

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await bootstrap();
  baseUrl = await originOf(app);
});

afterAll(async () => {
  await app?.close();
});

describe("Bootstrap реального AppModule", () => {
  it("openapi.json отвечает схемой при каждом запросе", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${baseUrl}/openapi.json`);
      expect(response.status).toBe(200);
      const document = (await response.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      expect(document.openapi).toStartWith("3.");
      expect(Object.keys(document.paths).length).toBeGreaterThan(0);
      expect(Object.keys(document.paths)).toContain("/v1/common/auth/login");
    }
  });

  it("docs отдаёт Scalar UI", async () => {
    const response = await fetch(`${baseUrl}/docs`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Scalar");
  });

  it("корень отвечает метаданными Yggdrasil", async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    const metadata = (await response.json()) as { skinDomains: string[] };
    expect(metadata.skinDomains).toContain("localhost");
  });

  it("статика public/ отдаётся", async () => {
    const publicCopy = join(process.cwd(), "public", staticFixtureName);
    writeFileSync(publicCopy, staticFixtureBody);

    try {
      const response = await fetch(`${baseUrl}/${staticFixtureName}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(staticFixtureBody);
    } finally {
      rmSync(publicCopy, { force: true });
    }
  });

  it("panel SPA отдаёт fallback по наличию index.html", async () => {
    const response = await fetch(`${baseUrl}/panel/missing-route`);
    const hasIndex = existsSync(join(process.cwd(), "public", "panel", "index.html"));

    if (hasIndex) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith("text/html");
    } else {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  it("CORS по умолчанию закрыт", async () => {
    const response = await fetch(`${baseUrl}/openapi.json`, {
      headers: { Origin: "http://evil.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("graceful shutdown закрывает сервер", async () => {
    const stopping = await bootstrap();
    const stopUrl = await originOf(stopping);

    await stopping.close();

    const probe = await fetch(`${stopUrl}/openapi.json`).then(
      (response) => response.status,
      (error) => String(error),
    );
    expect(probe).not.toBe(200);
  });
});

describe("Bootstrap с CORS_ORIGINS", () => {
  let corsApp: INestApplication;
  let corsUrl: string;

  beforeAll(async () => {
    process.env["CORS_ORIGINS"] = "http://allowed.example.com";
    corsApp = await bootstrap();
    corsUrl = await originOf(corsApp);
  });

  afterAll(async () => {
    await corsApp?.close();
    delete process.env["CORS_ORIGINS"];
  });

  it("разрешённый origin получает access-control-allow-origin", async () => {
    const response = await fetch(`${corsUrl}/openapi.json`, {
      headers: { Origin: "http://allowed.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://allowed.example.com");
  });

  it("чужой origin остаётся без CORS-заголовка", async () => {
    const response = await fetch(`${corsUrl}/openapi.json`, {
      headers: { Origin: "http://evil.example.com" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
