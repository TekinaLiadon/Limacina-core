import { setupTestEnv } from "../../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import fastifyMultipart from "@fastify/multipart";
import supertest from "supertest";
import { V1ContentController } from "../content.controller";
import {
  MAX_MODEL_BYTES,
  MAX_SKIN_BYTES,
  UserContentService,
} from "../../../../user-content/user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../../../user-content/user-content.store";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";
import { AllExceptionsFilter } from "../../../../common/all-exceptions.filter";
import { buildTestPng } from "../../../../utils/tests/test-png";

const TEST_UUID = "streamlimit-uuid-0001";
const BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const PLUGIN_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const pngBuffer = (totalBytes: number): Buffer => buildTestPng({ totalBytes });

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: "test-access-secret",
    });
  }

  validate(payload: { sub: string; username: string; role: string }) {
    return { uuid: payload.sub, username: payload.username, role: payload.role };
  }
}

describe("V1 common/content — лимиты и валидация загрузок", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let userToken: string;
  const uploadedFiles: string[] = [];

  const trackUploadedFile = (url: string): void => {
    uploadedFiles.push(url.replace(/^https?:\/\/[^/]+\//, "public/"));
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [V1ContentController],
      providers: [
        UserContentService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        TestJwtStrategy,
        {
          provide: UserContentMapStoreToken,
          useClass: UserContentMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES }));
    await app
      .getHttpAdapter()
      .getInstance()
      .register(fastifyMultipart, { limits: { fileSize: PLUGIN_FILE_SIZE_BYTES } });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    jwtService = moduleFixture.get(JwtService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    userToken = jwtService.sign({ sub: TEST_UUID, username: "streamlimit", role: "user" });
  });

  afterAll(async () => {
    const store = app.get(UserContentMapStoreToken);
    for (const type of ["skin", "cape", "model"] as const) {
      for (const item of await store.findByUserUuid(TEST_UUID, type)) {
        await store.deleteByIdAndCountRemaining(item.id, type);
      }
    }
    for (const filePath of uploadedFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
    await app.close();
  });

  const upload = async (path: string, file: Buffer, name: string) =>
    supertest(app.getHttpServer())
      .post(path)
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", file, name);

  describe("валидация моделей", (): void => {
    it("возвращает 400 для пустой модели", async (): Promise<void> => {
      const res = await upload("/v1/common/content/models", Buffer.alloc(0), "model.txt");
      expect(res.status).toBe(400);
    });

    it("возвращает 400 для двоичной модели", async (): Promise<void> => {
      const res = await upload(
        "/v1/common/content/models",
        Buffer.from([0x00, 0x01, 0x02, 0x1f]),
        "model.txt",
      );
      expect(res.status).toBe(400);
    });

    it("возвращает 400 для модели с невалидным UTF-8", async (): Promise<void> => {
      const res = await upload("/v1/common/content/models", Buffer.from([0xc3, 0x28]), "model.txt");
      expect(res.status).toBe(400);
    });

    it("возвращает 400 для модели сверх 256 КБ", async (): Promise<void> => {
      const res = await upload(
        "/v1/common/content/models",
        Buffer.alloc(MAX_MODEL_BYTES + 1, "a"),
        "model.txt",
      );
      expect(res.status).toBe(400);
    });

    it("загружает модель ровно 256 КБ и удаляет её", async (): Promise<void> => {
      const res = await upload(
        "/v1/common/content/models",
        Buffer.alloc(MAX_MODEL_BYTES, "a"),
        "model.txt",
      );
      expect(res.status).toBe(201);
      trackUploadedFile(res.body.url);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/models/${res.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe("валидация скинов", (): void => {
    it("возвращает 400 для пустого скина", async (): Promise<void> => {
      const res = await upload("/v1/common/content/skins", Buffer.alloc(0), "skin.png");
      expect(res.status).toBe(400);
    });

    it("загружает скин ровно 512 КБ и удаляет его", async (): Promise<void> => {
      const res = await upload("/v1/common/content/skins", pngBuffer(MAX_SKIN_BYTES), "skin.png");
      expect(res.status).toBe(201);
      trackUploadedFile(res.body.url);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${res.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe("стрим-лимит загрузки", (): void => {
    it("возвращает 413 для модели сверх 512 КБ, не буферизуя её целиком", async (): Promise<void> => {
      const res = await upload(
        "/v1/common/content/models",
        Buffer.alloc(MAX_MODEL_BYTES * 2 + 1, "a"),
        "model.txt",
      );
      expect(res.status).toBe(413);
    });

    it("возвращает 413 для скина сверх 1 МБ", async (): Promise<void> => {
      const res = await upload(
        "/v1/common/content/skins",
        pngBuffer(MAX_SKIN_BYTES * 2 + 1),
        "skin.png",
      );
      expect(res.status).toBe(413);
    });
  });
});
