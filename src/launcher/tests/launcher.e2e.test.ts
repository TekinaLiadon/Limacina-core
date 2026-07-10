import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { renameSync } from "node:fs";
import { LauncherController } from "../launcher.controller";
import { LauncherService } from "../launcher.service";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";

const CONFIG_FILE = "config.toml";
const CONFIG_BACKUP = "config.toml.bak";

describe("Тесты эндпоинтов лаунчера", (): void => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LauncherController],
      providers: [LauncherService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("Получение версии лаунчера", async () => {
    const res = await supertest(app.getHttpServer()).get("/launcher/version").expect(200);

    expect(typeof res.body).toBe("object");
    expect(typeof res.body.version).toBe("string");
    expect(Array.isArray(res.body.platforms)).toBe(true);
  });

  it("Неподдерживаемая платформа возвращает 400", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/launcher/invalid/invalid/download")
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });

  it("Получение конфига лаунчера", async () => {
    const res = await supertest(app.getHttpServer()).get("/launcher/config").expect(200);

    expect(typeof res.body).toBe("object");
    expect(typeof res.body.projectName).toBe("string");
    expect(typeof res.body.mcVersion).toBe("string");
    expect(typeof res.body.modLoader).toBe("string");
    expect(typeof res.body.loaderVersion).toBe("string");
    expect(Array.isArray(res.body.jvmArgs)).toBe(true);
    expect(typeof res.body.minMemory).toBe("string");
    expect(typeof res.body.maxMemory).toBe("string");
    expect(typeof res.body.online).toBe("boolean");
  });

  it("Возвращает 404 если config.toml не найден", async () => {
    renameSync(CONFIG_FILE, CONFIG_BACKUP);

    try {
      const res = await supertest(app.getHttpServer()).get("/launcher/config").expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toContain("config.toml");
    } finally {
      renameSync(CONFIG_BACKUP, CONFIG_FILE);
    }
  });
});
