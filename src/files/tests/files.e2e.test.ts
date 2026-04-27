import { afterAll, beforeAll, describe, it } from "bun:test";
import { FilesController } from "../files.controller";
import { FilesService } from "../files.service";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { FastifyAdapter } from "@nestjs/platform-fastify";
describe("Тесты эндпоинтов на получение файлов", (): void => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [FilesService],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("Игра создается", () => {
    return supertest(app.getHttpServer())
      .get("/files/list")
      .expect(201)
      .expect("Текущий список файлов");
  });
});
