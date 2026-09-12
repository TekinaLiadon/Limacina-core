import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import type { Response as SuperagentResponse } from "superagent";
import { V1LauncherUpdateController } from "../update.controller";
import { V1LauncherConfigController } from "../config.controller";
import { V1LauncherFilesController } from "../files.controller";
import { LauncherService } from "../../../launcher/launcher.service";
import { FilesService, FILES_LIST_EXCLUDED_FOLDERS } from "../../../files/files.service";

const DOWNLOAD_DIR = "public/linux/x86_64";
const TEST_ZIP = `${DOWNLOAD_DIR}/Limacina-9.9.9-linux-x86_64.zip`;
const TEST_MOD_FILE = "public/launcher/mods/limacina-exclusion-test-mod.jar";
const TEST_MOD_KEY = "mods/limacina-exclusion-test-mod.jar";
const CONFIG_FILE = "config.toml";
const VERSION_FILE = "public/version.json";
const TEST_VERSION = "9.9.9";
const TEST_ZIP_NAME = `Limacina-${TEST_VERSION}-linux-x86_64.zip`;

const WATCHER_DEADLINE_MS = 4500;
const POLL_INTERVAL_MS = 100;
const MUTATION_SETTLE_MS = 400;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + WATCHER_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(POLL_INTERVAL_MS);
  }
};

const binaryParser = (
  res: SuperagentResponse,
  callback: (err: Error | null, body?: Buffer) => void,
): void => {
  res.setEncoding("binary");
  let data = "";
  res.on("data", (chunk: string) => {
    data += chunk;
  });
  res.on("end", () => {
    callback(null, Buffer.from(data, "binary"));
  });
};

describe("V1 launcher эндпоинты", (): void => {
  let app: INestApplication;
  let filesService: FilesService;
  let hadVersionFile = false;
  let originalVersionContent = "";
  let hadConfigFile = false;
  let originalConfigContent = "";

  beforeAll(async () => {
    if (existsSync(VERSION_FILE)) {
      hadVersionFile = true;
      originalVersionContent = readFileSync(VERSION_FILE, "utf-8");
    }
    if (existsSync(CONFIG_FILE)) {
      hadConfigFile = true;
      originalConfigContent = readFileSync(CONFIG_FILE, "utf-8");
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        V1LauncherUpdateController,
        V1LauncherConfigController,
        V1LauncherFilesController,
      ],
      providers: [LauncherService, FilesService],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    filesService = app.get(FilesService);
  });

  afterAll(async () => {
    await app.close();

    if (hadVersionFile) {
      writeFileSync(VERSION_FILE, originalVersionContent);
    } else if (existsSync(VERSION_FILE)) {
      unlinkSync(VERSION_FILE);
    }
    if (hadConfigFile && !existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, originalConfigContent);
    }
  });

  describe("GET /v1/launcher/update/version", () => {
    it("возвращает версию и список платформ", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/version")
        .expect(200);

      expect(typeof res.body.version).toBe("string");
      expect(Array.isArray(res.body.platforms)).toBe(true);
    });

    it("использует 0.0.0, если version.json не соответствует форме (TASK-69)", async () => {
      await sleep(MUTATION_SETTLE_MS);
      writeFileSync(VERSION_FILE, JSON.stringify({ version: 123 }));

      try {
        let version = "";
        await waitFor(async () => {
          const res = await supertest(app.getHttpServer())
            .get("/v1/launcher/update/version")
            .expect(200);
          ({ version } = res.body);
          return version === "0.0.0";
        });

        expect(version).toBe("0.0.0");
      } finally {
        if (hadVersionFile) {
          writeFileSync(VERSION_FILE, originalVersionContent);
        } else if (existsSync(VERSION_FILE)) {
          unlinkSync(VERSION_FILE);
        }
      }
    });
  });

  describe("GET /v1/launcher/update/:os/:arch/download", () => {
    it("возвращает 400 для неподдерживаемой платформы", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/invalid/invalid/download")
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it("отдаёт zip-файл для поддерживаемой платформы", async () => {
      const zipContent = "fake-zip-content-v1";
      await sleep(MUTATION_SETTLE_MS);
      writeFileSync(TEST_ZIP, zipContent);
      writeFileSync(VERSION_FILE, JSON.stringify({ version: TEST_VERSION }));

      try {
        let status = 0;
        await waitFor(async () => {
          const res = await supertest(app.getHttpServer())
            .get("/v1/launcher/update/linux/x86_64/download")
            .parse(binaryParser);
          if (res.status === 200) {
            expect(res.headers["content-type"]).toBe("application/zip");
            expect(res.headers["content-disposition"]).toContain(TEST_ZIP_NAME);
            expect(res.body.toString()).toBe(zipContent);
          }
          ({ status } = res);
          return status === 200;
        });

        expect(status).toBe(200);
      } finally {
        unlinkSync(TEST_ZIP);
        if (hadVersionFile) {
          writeFileSync(VERSION_FILE, originalVersionContent);
        } else {
          unlinkSync(VERSION_FILE);
        }
      }
    });
  });

  describe("GET /v1/launcher/config", () => {
    const waitForConfig = async (expected: (body: Record<string, unknown>) => boolean) => {
      await waitFor(async () => {
        const res = await supertest(app.getHttpServer()).get("/v1/launcher/config");
        return res.status === 200 && expected(res.body);
      });
    };

    it("возвращает конфиг лаунчера", async () => {
      if (!existsSync(CONFIG_FILE)) {
        writeFileSync(CONFIG_FILE, originalConfigContent);
        await waitForConfig(() => true);
      }

      const res = await supertest(app.getHttpServer()).get("/v1/launcher/config").expect(200);

      expect(typeof res.body.projectName).toBe("string");
      expect(typeof res.body.mcVersion).toBe("string");
      expect(typeof res.body.online).toBe("boolean");
    });

    it("возвращает 404 если config.toml не найден", async () => {
      const backupContent = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf-8") : "";
      await sleep(MUTATION_SETTLE_MS);
      unlinkSync(CONFIG_FILE);

      try {
        let status = 200;
        await waitFor(async () => {
          const res = await supertest(app.getHttpServer()).get("/v1/launcher/config");
          ({ status } = res);
          return status === 404;
        });

        expect(status).toBe(404);
      } finally {
        if (backupContent) {
          writeFileSync(CONFIG_FILE, backupContent);
          await waitForConfig(() => true);
        }
      }
    });

    it("возвращает 404 при битом config.toml, а не 500 (TASK-68)", async () => {
      const backupContent = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf-8") : "";
      await sleep(MUTATION_SETTLE_MS);

      try {
        writeFileSync(CONFIG_FILE, "это не toml [");

        let status = 200;
        await waitFor(async () => {
          const res = await supertest(app.getHttpServer()).get("/v1/launcher/config");
          ({ status } = res);
          return status === 404;
        });

        expect(status).toBe(404);
      } finally {
        if (backupContent) {
          writeFileSync(CONFIG_FILE, backupContent);
          await waitForConfig(() => true);
        } else {
          unlinkSync(CONFIG_FILE);
        }
      }
    });

    it("подхватывает изменение config.toml без рестарта", async () => {
      const backupContent = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf-8") : "";
      await sleep(MUTATION_SETTLE_MS);

      try {
        writeFileSync(
          CONFIG_FILE,
          'projectName = "watcher-test"\nmcVersion = "1.20.1"\nmodLoader = "fabric"\nloaderVersion = "0.15.0"\njvmArgs = []\nminMemory = "2G"\nmaxMemory = "4G"\nonline = true\n',
        );

        await waitForConfig((body) => body["projectName"] === "watcher-test");
      } finally {
        if (backupContent) {
          writeFileSync(CONFIG_FILE, backupContent);
          await waitForConfig((body) => body["projectName"] !== "watcher-test");
        }
      }
    });
  });

  describe("Файлы лаунчера", () => {
    it("GET /v1/launcher/files/list возвращает список файлов", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/list").expect(200);

      expect(typeof res.body).toBe("object");
    });

    it("GET /v1/launcher/files/list не включает моды", async () => {
      writeFileSync(TEST_MOD_FILE, "fake-mod-content");
      try {
        filesService.launcherHash.set(TEST_MOD_KEY, "d41d8cd98f00b204e9800998ecf8427e");

        const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/list").expect(200);

        expect(Object.keys(res.body)).not.toContain(TEST_MOD_KEY);
      } finally {
        filesService.launcherHash.delete(TEST_MOD_KEY);
        unlinkSync(TEST_MOD_FILE);
      }
    });

    it("GET /v1/launcher/files/list не включает папки из FILES_LIST_EXCLUDED_FOLDERS", async () => {
      const excludedKey = "resourcepacks/limacina-exclusion-test-pack.zip";
      const backup = [...FILES_LIST_EXCLUDED_FOLDERS];
      try {
        FILES_LIST_EXCLUDED_FOLDERS.push("resourcepacks");
        filesService.launcherHash.set(excludedKey, "d41d8cd98f00b204e9800998ecf8427e");

        const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/list").expect(200);

        expect(Object.keys(res.body)).not.toContain(excludedKey);
      } finally {
        FILES_LIST_EXCLUDED_FOLDERS.length = 0;
        FILES_LIST_EXCLUDED_FOLDERS.push(...backup);
        filesService.launcherHash.delete(excludedKey);
      }
    });

    it("GET /v1/launcher/files/mods возвращает список модов", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/mods").expect(200);

      expect(typeof res.body).toBe("object");
    });

    it("GET /v1/launcher/files/mods возвращает только моды", async () => {
      writeFileSync(TEST_MOD_FILE, "fake-mod-content");
      try {
        filesService.launcherHash.set(TEST_MOD_KEY, "d41d8cd98f00b204e9800998ecf8427e");

        const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/mods").expect(200);

        expect(res.body[TEST_MOD_KEY]).toBe("d41d8cd98f00b204e9800998ecf8427e");
      } finally {
        filesService.launcherHash.delete(TEST_MOD_KEY);
        unlinkSync(TEST_MOD_FILE);
      }
    });

    it("getHash отдаёт sha1-хеш (40 hex)", async () => {
      writeFileSync(TEST_MOD_FILE, "fake-mod-content");
      try {
        const hash = await filesService.getHash(TEST_MOD_FILE);

        expect(hash).toMatch(/^[0-9a-f]{40}$/);
      } finally {
        unlinkSync(TEST_MOD_FILE);
      }
    });

    it("POST /v1/launcher/files/download отдаёт файл по указанному пути", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/launcher/files/download")
        .parse(binaryParser)
        .send({ url: "authlib-injector.jar" })
        .expect(200);

      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-disposition"]).toContain("authlib-injector.jar");
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("POST /v1/launcher/files/download отдаёт файл из вложенной директории", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/launcher/files/download")
        .parse(binaryParser)
        .send({ url: "mods/abnormals_core-1.16.5-3.3.1.jar" })
        .expect(200);

      expect(res.headers["content-disposition"]).toContain("abnormals_core");
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("POST /v1/launcher/files/download возвращает 404 для несуществующего файла", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/launcher/files/download")
        .send({ url: "missing-file.jar" })
        .expect(404);
    });

    it("блокирует выход за пределы папки launcher (path traversal)", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/launcher/files/download")
        .send({ url: "../../.env" })
        .expect(400);
    });

    it("блокирует абсолютный путь", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/launcher/files/download")
        .send({ url: "/etc/passwd" })
        .expect(400);
    });
  });
});
