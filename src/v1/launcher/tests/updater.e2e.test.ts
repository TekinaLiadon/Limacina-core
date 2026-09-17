import { setupTestEnv } from "../../../utils/tests/test-env";
import { applyV1ApiPrefix } from "../../../utils/tests/v1-prefix";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, type INestApplication, NotFoundException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1LauncherUpdateController } from "../update.controller";
import { LauncherService } from "../../../launcher/launcher.service";
import { LauncherReleasesService } from "../../../launcher/launcher-releases.service";
import { AppConfigToken } from "../../../config/app-config.provider";
import GlobalConfig from "../../../config/global-config";
import type { UpdaterLatestDto } from "../../../launcher/dto/dto";

const RELEASES_ROOT = join("public", "releases");
const RELEASES_BACKUP = join("public", "releases.bak");

const BASE_URL = "http://localhost:3005";

const CURRENT_VERSION = "9.9.9";
const ARCHIVED_VERSION = "9.9.8";
const INCOMPLETE_VERSION = "9.9.7";

function artifactPath(version: string, fileName: string): string {
  return join(RELEASES_ROOT, version, fileName);
}

function writeFixture(version: string, fileName: string, content: string): void {
  mkdirSync(join(RELEASES_ROOT, version), { recursive: true });
  writeFileSync(artifactPath(version, fileName), content);
}

function writeSigFixture(version: string, fileName: string, content: string): void {
  writeFixture(version, `${fileName}.sig`, content);
}

function writeReleaseFixtures(): void {
  writeFixture(CURRENT_VERSION, "Limacina-9.9.9-windows-x86_64.exe", "installer-windows-content");
  writeSigFixture(CURRENT_VERSION, "Limacina-9.9.9-windows-x86_64.exe", "sig-windows-content\n");
  writeFixture(CURRENT_VERSION, "Limacina-9.9.9-darwin-aarch64.app.tar.gz", "app-tar-gz-content");
  writeSigFixture(
    CURRENT_VERSION,
    "Limacina-9.9.9-darwin-aarch64.app.tar.gz",
    "sig-darwin-content",
  );
  writeFixture(ARCHIVED_VERSION, "Limacina-9.9.8-linux-x86_64.AppImage", "appimage-content");
  writeSigFixture(ARCHIVED_VERSION, "Limacina-9.9.8-linux-x86_64.AppImage", "sig-linux-content");
  writeFixture(INCOMPLETE_VERSION, "Limacina-9.9.7-windows-x86_64.exe", "orphan-artifact");
}

describe("V1 launcher/update эндпоинты апдейтера (latest.json)", (): void => {
  let app: INestApplication;
  let releasesRootExisted = false;

  beforeAll(async (): Promise<void> => {
    releasesRootExisted = existsSync(RELEASES_ROOT);
    if (releasesRootExisted) {
      renameSync(RELEASES_ROOT, RELEASES_BACKUP);
    }
    mkdirSync(RELEASES_ROOT, { recursive: true });

    writeReleaseFixtures();
    mkdirSync(join(RELEASES_ROOT, "not-a-version"), { recursive: true });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [V1LauncherUpdateController],
      providers: [
        LauncherService,
        LauncherReleasesService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    applyV1ApiPrefix(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll((): void => {
    rmSync(RELEASES_ROOT, { recursive: true, force: true });
    if (releasesRootExisted) {
      renameSync(RELEASES_BACKUP, RELEASES_ROOT);
    }
  });

  describe("GET /v1/launcher/update/latest", () => {
    it("без параметра отдаёт latest.json старшей версии с подписями и статическими url", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .expect(200);

      const body = res.body as UpdaterLatestDto;
      expect(body.version).toBe(CURRENT_VERSION);
      expect(Number.isNaN(Date.parse(body.pub_date))).toBe(false);
      expect(Object.keys(body.platforms).toSorted()).toEqual(["darwin-aarch64", "windows-x86_64"]);

      const windows = body.platforms["windows-x86_64"]!;
      expect(windows.url).toBe(`${BASE_URL}/releases/9.9.9/Limacina-9.9.9-windows-x86_64.exe`);
      expect(windows.signature).toBe("sig-windows-content\n");

      const darwin = body.platforms["darwin-aarch64"]!;
      expect(darwin.url).toBe(
        `${BASE_URL}/releases/9.9.9/Limacina-9.9.9-darwin-aarch64.app.tar.gz`,
      );
      expect(darwin.signature).toBe("sig-darwin-content");
    });

    it("?version= отдаёт latest.json прошлой версии (откат)", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: ARCHIVED_VERSION })
        .expect(200);

      const body = res.body as UpdaterLatestDto;
      expect(body.version).toBe(ARCHIVED_VERSION);
      expect(Object.keys(body.platforms)).toEqual(["linux-x86_64"]);
      expect(body.platforms["linux-x86_64"]!.url).toBe(
        `${BASE_URL}/releases/9.9.8/Limacina-9.9.8-linux-x86_64.AppImage`,
      );
    });

    it("?version= с текущей версией работает", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: CURRENT_VERSION })
        .expect(200);

      expect((res.body as UpdaterLatestDto).version).toBe(CURRENT_VERSION);
    });

    it("пустой ?version= отдаёт актуальный релиз, а не 400", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: "" })
        .expect(200);

      expect((res.body as UpdaterLatestDto).version).toBe(CURRENT_VERSION);
    });

    it("возвращает 404 для версии без полной пары артефакт+подпись", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: INCOMPLETE_VERSION })
        .expect(404);
    });

    it("возвращает 404 для несуществующей версии", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: "5.5.5" })
        .expect(404);
    });

    it("возвращает 400 для невалидного формата версии", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest")
        .query({ version: "../../etc/passwd" })
        .expect(400);
    });
  });

  describe("GET /v1/launcher/update/latest.json (алиасы URL старых сборок лаунчера)", (): void => {
    it("latest.json без версии отдаёт latest.json старшей версии, как /latest", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/latest.json")
        .expect(200);

      const body = res.body as UpdaterLatestDto;
      expect(body.version).toBe(CURRENT_VERSION);
      expect(Object.keys(body.platforms).toSorted()).toEqual(["darwin-aarch64", "windows-x86_64"]);
      expect(body.platforms["windows-x86_64"]!.signature).toBe("sig-windows-content\n");
    });

    it(":version/latest.json отдаёт latest.json указанной версии (откат)", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/launcher/update/${ARCHIVED_VERSION}/latest.json`)
        .expect(200);

      const body = res.body as UpdaterLatestDto;
      expect(body.version).toBe(ARCHIVED_VERSION);
      expect(body.platforms["linux-x86_64"]!.url).toBe(
        `${BASE_URL}/releases/9.9.8/Limacina-9.9.8-linux-x86_64.AppImage`,
      );
    });

    it(":version/latest.json для несуществующей версии даёт 404", async () => {
      await supertest(app.getHttpServer()).get("/v1/launcher/update/5.5.5/latest.json").expect(404);
    });

    it(":version/latest.json для невалидной версии даёт 400", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/not-a-version/latest.json")
        .expect(400);
    });
  });

  describe("GET /v1/launcher/update/releases", () => {
    it("отдаёт только релизы с полными парами, от новых к старым", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/releases")
        .expect(200);

      const versions: string[] = res.body.releases.map(
        (release: { version: string }) => release.version,
      );
      expect(versions).toContain(CURRENT_VERSION);
      expect(versions).toContain(ARCHIVED_VERSION);
      expect(versions).not.toContain(INCOMPLETE_VERSION);
      expect(versions.indexOf(CURRENT_VERSION)).toBeLessThan(versions.indexOf(ARCHIVED_VERSION));

      const current = res.body.releases.find(
        (release: { version: string }) => release.version === CURRENT_VERSION,
      );
      expect(current.platforms).toEqual(["darwin-aarch64", "windows-x86_64"]);
      expect(Number.isNaN(Date.parse(current.pubDate))).toBe(false);
    });
  });

  describe("LauncherReleasesService — граничные случаи без релизов", () => {
    let service: LauncherReleasesService;
    let rootRenamed = false;

    beforeAll((): void => {
      if (existsSync(RELEASES_ROOT)) {
        renameSync(RELEASES_ROOT, RELEASES_BACKUP);
        rootRenamed = true;
      }
      service = new LauncherReleasesService(GlobalConfig.parseEnvOrExit());
    });

    afterAll((): void => {
      if (rootRenamed) {
        renameSync(RELEASES_BACKUP, RELEASES_ROOT);
      }
    });

    it("listReleases без каталога релизов возвращает пустой список", () => {
      expect(service.listReleases()).toEqual({ releases: [] });
    });

    it("getLatest без каталога релизов и без параметра даёт 404", () => {
      expect(() => service.getLatest()).toThrow(NotFoundException);
    });

    it("getLatest для отсутствующей версии даёт 404", () => {
      expect(() => service.getLatest("1.2.3")).toThrow(NotFoundException);
    });

    it("getLatest для невалидной версии даёт 400", () => {
      expect(() => service.getLatest("not-a-version")).toThrow(BadRequestException);
    });
  });
});
