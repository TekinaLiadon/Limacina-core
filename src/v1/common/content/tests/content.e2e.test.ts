process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import fastifyMultipart from "@fastify/multipart";
import supertest from "supertest";
import { V1ContentController } from "../content.controller";
import { UserContentService } from "../../../../user-content/user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../../../user-content/user-content.store";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";

const TEST_UUID = "v1user-uuid-0001";

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

describe("V1 common/content эндпоинты", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let userToken: string;
  let otherUserToken: string;
  let uploadedSkinId: number;
  const uploadedFiles: string[] = [];

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

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.getHttpAdapter().getInstance().register(fastifyMultipart);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    jwtService = moduleFixture.get(JwtService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    userToken = jwtService.sign({ sub: TEST_UUID, username: "v1user", role: "user" });
    otherUserToken = jwtService.sign({ sub: "other-uuid-0002", username: "other", role: "user" });
  });

  afterAll(async () => {
    for (const filePath of uploadedFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
    await app.close();
  });

  const trackUploadedFile = (url: string): void => {
    const filePath = url.replace(/^https?:\/\/[^/]+\//, "public/");
    uploadedFiles.push(filePath);
  };

  describe("POST /v1/common/content/skins", () => {
    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).post("/v1/common/content/skins").expect(401);
    });

    it("загружает скин", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", Buffer.from("fake-png-v1"), "skin.png")
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("url");
      uploadedSkinId = res.body.id;
      trackUploadedFile(res.body.url);
    });

    it("возвращает 400 если файл не загружен", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .field("dummy", "no-file")
        .expect(400);
    });
  });

  describe("GET /v1/common/content/skins/:uuid", () => {
    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get(`/v1/common/content/skins/${TEST_UUID}`).expect(401);
    });

    it("возвращает список скинов пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((s: { id: number }) => s.id === uploadedSkinId)).toBe(true);
    });
  });

  describe("DELETE /v1/common/content/skins/:id", () => {
    it("возвращает 403 при удалении чужого скина", async () => {
      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadedSkinId}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(403);
    });

    it("удаляет свой скин", async () => {
      const res = await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadedSkinId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("возвращает 400 если скин не найден", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/common/content/skins/999999")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(400);
    });
  });

  describe("Модели", () => {
    it("загружает и удаляет модель", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/models")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", Buffer.from("fake-model-v1"), "model.txt")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      const modelId = uploadRes.body.id;

      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/models/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(listRes.body.some((m: { id: number }) => m.id === modelId)).toBe(true);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/models/${modelId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });
});
