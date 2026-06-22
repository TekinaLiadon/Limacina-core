import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FilesController } from "../files.controller";
import { FilesService } from "../files.service";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";

describe("Тесты эндпоинтов на получение файлов", (): void => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [FilesService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("Получение списка файлов лаунчера", async () => {
    const res = await supertest(app.getHttpServer()).get("/files/list").expect(200);

    expect(typeof res.body).toBe("object");
  });

  it("Получение списка модов", async () => {
    const res = await supertest(app.getHttpServer()).get("/files/mods").expect(200);

    expect(typeof res.body).toBe("object");
  });
});
