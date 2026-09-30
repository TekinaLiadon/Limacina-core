import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, sep } from "path";
import type { INestApplication } from "@nestjs/common";
import { bootstrap } from "./main";
import { UPLOAD_TMP_DIR } from "./launcher/launcher-files";
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

  it("API-маршруты живут под /v1, Yggdrasil — в корне", async () => {
    const v1Response = await fetch(`${baseUrl}/v1/common/status`);
    expect(v1Response.status).not.toBe(404);

    const yggdrasilResponse = await fetch(`${baseUrl}/sessionserver/session/minecraft/hasJoined`);
    expect(yggdrasilResponse.status).not.toBe(404);
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

  it("точечные файлы и служебные каталоги не раздаются статикой", async () => {
    const releasesRoot = join(process.cwd(), "public", "releases");
    const stagingDir = join(releasesRoot, ".staging-e2e");
    const backupName = `.old-9.9.9-e2e-${randomUUID()}`;
    const backupDir = join(releasesRoot, backupName);
    const releasesRootExisted = existsSync(releasesRoot);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "artifact.exe"), "unpublished-payload");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "artifact.exe"), "backup-payload");
    const platformDir = join(process.cwd(), "public", "linux", "x86_64");
    const replacedZip = join(platformDir, ".Limacina-9.9.9-linux-x86_64.zip.replaced");
    const platformDirExisted = existsSync(platformDir);
    writeFileSync(replacedZip, "replaced-payload");
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    const uploadLeftover = join(UPLOAD_TMP_DIR, "leftover.exe");
    writeFileSync(uploadLeftover, "upload-payload");
    const uploadTmpUrlPath = UPLOAD_TMP_DIR.split(sep).join("/");

    try {
      const staging = await fetch(`${baseUrl}/releases/.staging-e2e/artifact.exe`);
      expect(staging.status).toBe(404);

      const backup = await fetch(`${baseUrl}/releases/${backupName}/artifact.exe`);
      expect(backup.status).toBe(404);

      const lock = await fetch(`${baseUrl}/releases/.lock-9.9.9-e2e`);
      expect(lock.status).toBe(404);

      const replaced = await fetch(
        `${baseUrl}/linux/x86_64/.Limacina-9.9.9-linux-x86_64.zip.replaced`,
      );
      expect(replaced.status).toBe(404);

      const uploadTmpStatic = await fetch(`${baseUrl}/${uploadTmpUrlPath}/leftover.exe`);
      expect(uploadTmpStatic.status).toBe(404);

      const publicDotfile = await fetch(`${baseUrl}/.upload-tmp/leftover.exe`);
      expect(publicDotfile.status).toBe(404);

      const panelDotfile = await fetch(`${baseUrl}/panel/.env`);
      expect(panelDotfile.status).toBe(404);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
      rmSync(backupDir, { recursive: true, force: true });
      rmSync(replacedZip, { force: true });
      rmSync(uploadLeftover, { force: true });
      rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
      if (!platformDirExisted) {
        rmSync(join(process.cwd(), "public", "linux"), { recursive: true, force: true });
      }
      if (!releasesRootExisted) {
        rmSync(releasesRoot, { recursive: true, force: true });
      }
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
