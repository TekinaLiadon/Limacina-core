import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { LauncherController } from "../launcher.controller";
import { LauncherService } from "../launcher.service";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";

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
    expect(typeof res.body.config).toBe("string");
    expect(res.body.config.length).toBeGreaterThan(0);
  });
});
