import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1LauncherUpdateController } from "../update.controller";
import { LauncherController } from "../../../launcher/launcher.controller";
import { LauncherService } from "../../../launcher/launcher.service";

const VERSION_FILE = "public/version.json";
const VERSION_BACKUP = "public/version.json.bak";
const PLATFORM_DIR = "public/linux/x86_64";
const OLD_DIR = join(PLATFORM_DIR, "old");
const MACOS_PLATFORM_DIR = "public/macos/arm64";
const MACOS_PARENT_DIR = "public/macos";

const CURRENT_VERSION = "9.8.7";
const ARCHIVED_VERSION = "9.8.6";
const CURRENT_ZIP = `Limacina-${CURRENT_VERSION}-linux-x86_64.zip`;
const ARCHIVED_ZIP = `Limacina-${ARCHIVED_VERSION}-linux-x86_64.zip`;
const MACOS_ZIP = `Limacina-${CURRENT_VERSION}-macos-arm64.zip`;

const CURRENT_ZIP_CONTENT = "latest-zip-content";
const ARCHIVED_ZIP_CONTENT = "archived-zip-content";
const MACOS_ZIP_CONTENT = "macos-zip-content";

describe("V1 launcher/update эндпоинты — версии и скачивание", (): void => {
  let app: INestApplication;
  const backedUpFiles: Array<{ path: string; backupPath: string }> = [];
  let oldDirCreatedByTest = false;
  let macosArm64Existed = false;
  let macosParentExisted = false;

  beforeAll(async () => {
    if (existsSync(VERSION_FILE)) {
      renameSync(VERSION_FILE, VERSION_BACKUP);
    }
    writeFileSync(VERSION_FILE, JSON.stringify({ version: CURRENT_VERSION }));

    mkdirSync(PLATFORM_DIR, { recursive: true });
    if (existsSync(OLD_DIR)) {
      for (const file of readdirSync(OLD_DIR)) {
        const filePath = join(OLD_DIR, file);
        const backupPath = `${filePath}.bak`;
        renameSync(filePath, backupPath);
        backedUpFiles.push({ path: filePath, backupPath });
      }
    } else {
      mkdirSync(OLD_DIR, { recursive: true });
      oldDirCreatedByTest = true;
    }
    for (const file of readdirSync(PLATFORM_DIR)) {
      if (!file.endsWith(".zip")) continue;
      const filePath = join(PLATFORM_DIR, file);
      const backupPath = `${filePath}.bak`;
      renameSync(filePath, backupPath);
      backedUpFiles.push({ path: filePath, backupPath });
    }

    writeFileSync(join(PLATFORM_DIR, CURRENT_ZIP), CURRENT_ZIP_CONTENT);
    writeFileSync(join(OLD_DIR, ARCHIVED_ZIP), ARCHIVED_ZIP_CONTENT);

    macosArm64Existed = existsSync(MACOS_PLATFORM_DIR);
    macosParentExisted = existsSync(MACOS_PARENT_DIR);
    mkdirSync(MACOS_PLATFORM_DIR, { recursive: true });
    writeFileSync(join(MACOS_PLATFORM_DIR, MACOS_ZIP), MACOS_ZIP_CONTENT);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [V1LauncherUpdateController, LauncherController],
      providers: [LauncherService],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();

    unlinkSync(join(PLATFORM_DIR, CURRENT_ZIP));
    unlinkSync(join(OLD_DIR, ARCHIVED_ZIP));
    unlinkSync(join(MACOS_PLATFORM_DIR, MACOS_ZIP));
    for (const { path, backupPath } of backedUpFiles) {
      if (existsSync(backupPath)) {
        renameSync(backupPath, path);
      }
    }
    if (oldDirCreatedByTest) {
      rmSync(OLD_DIR, { recursive: true });
    }
    if (!macosArm64Existed) {
      rmSync(MACOS_PLATFORM_DIR, { recursive: true });
    }
    if (!macosParentExisted) {
      rmSync(MACOS_PARENT_DIR, { recursive: true });
    }
    if (existsSync(VERSION_FILE)) {
      unlinkSync(VERSION_FILE);
    }
    if (existsSync(VERSION_BACKUP)) {
      renameSync(VERSION_BACKUP, VERSION_FILE);
    }
  });

  describe("GET /v1/launcher/update/version", () => {
    it("возвращает последнюю версию и список всех версий", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/version")
        .expect(200);

      expect(res.body.version).toBe(CURRENT_VERSION);
      expect(
        res.body.platforms.some(
          (p: { os: string; arch: string }) => p.os === "linux" && p.arch === "x86_64",
        ),
      ).toBe(true);

      expect(Array.isArray(res.body.versions)).toBe(true);
      const versions: string[] = res.body.versions.map((v: { version: string }) => v.version);
      expect(versions).toContain(CURRENT_VERSION);
      expect(versions).toContain(ARCHIVED_VERSION);

      const archivedEntry = res.body.versions.find(
        (v: { version: string }) => v.version === ARCHIVED_VERSION,
      );
      expect(archivedEntry.platforms).toEqual([{ os: "linux", arch: "x86_64" }]);
    });

    it("сортирует версии от новых к старым", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/version")
        .expect(200);

      const versions: string[] = res.body.versions.map((v: { version: string }) => v.version);
      const currentIdx = versions.indexOf(CURRENT_VERSION);
      const archivedIdx = versions.indexOf(ARCHIVED_VERSION);
      expect(currentIdx).toBeGreaterThan(-1);
      expect(archivedIdx).toBeGreaterThan(-1);
      expect(currentIdx).toBeLessThan(archivedIdx);
    });
  });

  describe("GET /v1/launcher/update/:os/:arch/download", () => {
    it("отдаёт последнюю версию без параметра version", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/linux/x86_64/download")
        .expect(200)
        .expect("Content-Type", "application/zip");

      expect(res.text).toBe(CURRENT_ZIP_CONTENT);
    });

    it("отдаёт архивную версию по ?version=", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/launcher/update/linux/x86_64/download?version=${ARCHIVED_VERSION}`)
        .expect(200)
        .expect("Content-Type", "application/zip");

      expect(res.text).toBe(ARCHIVED_ZIP_CONTENT);
    });

    it("отдаёт текущую версию по ?version= с текущим номером", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/launcher/update/linux/x86_64/download?version=${CURRENT_VERSION}`)
        .expect(200);

      expect(res.text).toBe(CURRENT_ZIP_CONTENT);
    });

    it("возвращает 404 для несуществующей версии", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/linux/x86_64/download?version=1.0.0")
        .expect(404);
    });

    it("возвращает 400 для невалидного формата версии", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/linux/x86_64/download?version=../../etc/passwd")
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it("возвращает 400 для неподдерживаемой платформы", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/win/arm/download?version=1.0.0")
        .expect(400);
    });

    it("возвращает 400 для неизвестной os", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/macos/x86_64/download")
        .expect(400);
    });

    it("возвращает 400 для неизвестного arch", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/linux/riscv/download")
        .expect(400);
    });

    it("возвращает 400 для неподдерживаемой связки os/arch", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/windows/aarch64/download")
        .expect(400);
    });

    it("отдаёт zip для macos/arm64", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/macos/arm64/download")
        .expect(200)
        .expect("Content-Type", "application/zip");

      expect(res.text).toBe(MACOS_ZIP_CONTENT);
    });

    it("возвращает 400 для macos/x86_64", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/launcher/update/macos/x86_64/download")
        .expect(400);
    });
  });

  describe("Легаси-контракт не меняется", () => {
    it("GET /launcher/version возвращает прежнюю форму без списка версий", async () => {
      const res = await supertest(app.getHttpServer()).get("/launcher/version").expect(200);

      expect(typeof res.body.version).toBe("string");
      expect(Array.isArray(res.body.platforms)).toBe(true);
      expect(res.body.versions).toBeUndefined();
    });

    it("GET /launcher/:os/:arch/download отдаёт последнюю версию без параметров", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/launcher/linux/x86_64/download")
        .expect(200);

      expect(res.text).toBe(CURRENT_ZIP_CONTENT);
    });
  });
});
