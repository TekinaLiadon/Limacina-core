process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import type { Response as SuperagentResponse } from "superagent";
import { V1LauncherUpdateController } from "../update.controller";
import { V1LauncherConfigController } from "../config.controller";
import { V1LauncherFilesController } from "../files.controller";
import { LauncherService } from "../../../launcher/launcher.service";
import { FilesService } from "../../../files/files.service";

const DOWNLOAD_DIR = "public/linux/x86_64";
const TEST_ZIP = `${DOWNLOAD_DIR}/Limacina-9.9.9-linux-x86_64.zip`;

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

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /v1/launcher/update/version", () => {
    it("возвращает версию и список платформ", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/launcher/update/version")
        .expect(200);

      expect(typeof res.body.version).toBe("string");
      expect(Array.isArray(res.body.platforms)).toBe(true);
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
      writeFileSync(TEST_ZIP, zipContent);

      try {
        const res = await supertest(app.getHttpServer())
          .get("/v1/launcher/update/linux/x86_64/download")
          .parse(binaryParser)
          .expect(200);

        expect(res.headers["content-type"]).toBe("application/zip");
        expect(res.headers["content-disposition"]).toContain("Limacina-9.9.9");
        expect(res.body.toString()).toBe(zipContent);
      } finally {
        unlinkSync(TEST_ZIP);
      }
    });
  });

  describe("GET /v1/launcher/config", () => {
    it("возвращает конфиг лаунчера", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/launcher/config").expect(200);

      expect(typeof res.body.projectName).toBe("string");
      expect(typeof res.body.mcVersion).toBe("string");
      expect(typeof res.body.online).toBe("boolean");
    });
  });

  describe("Файлы лаунчера", () => {
    it("GET /v1/launcher/files/list возвращает список файлов", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/list").expect(200);

      expect(typeof res.body).toBe("object");
    });

    it("GET /v1/launcher/files/mods возвращает список модов", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/launcher/files/mods").expect(200);

      expect(typeof res.body).toBe("object");
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
