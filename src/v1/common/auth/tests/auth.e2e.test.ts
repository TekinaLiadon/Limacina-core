process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { JwtModule } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1AuthController } from "../auth.controller";
import { AuthService } from "../../../../auth/service/auth.service";
import { AuthMapStore, AuthMapStoreToken } from "../../../../auth/service/auth_store.service";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { registerAuthRateLimit } from "../../../../common/auth-rate-limit";

describe("V1 common/auth эндпоинты", (): void => {
  let app: INestApplication;
  let registeredUuid: string;
  let authStore: AuthMapStore;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [V1AuthController],
      providers: [
        AuthService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        {
          provide: AuthMapStoreToken,
          useClass: AuthMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    const fastifyInstance = app.getHttpAdapter().getInstance() as FastifyInstance;
    await registerAuthRateLimit(fastifyInstance, {
      max: 10,
      timeWindow: 60000,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authStore = moduleFixture.get<AuthMapStore>(AuthMapStoreToken);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /v1/common/auth/registration", () => {
    it("успешная регистрация нового пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      expect(res.body).toHaveProperty("tokens");
      expect(res.body.tokens).toHaveProperty("access_token");
      expect(res.body.tokens).toHaveProperty("refresh_token");
      expect(res.body.username).toBe("v1user");
      expect(res.body.role).toBe("user");
      registeredUuid = res.body.uuid;

      await authStore.approveUser(registeredUuid);
    });

    it("ошибка при повторной регистрации", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "v1user", password: "pass123" })
        .expect(401);
    });
  });

  describe("POST /v1/common/auth/login", () => {
    it("успешный логин", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      expect(res.body.username).toBe("v1user");
      expect(res.body.uuid).toBe(registeredUuid);
      expect(res.body.tokens).toHaveProperty("access_token");
    });

    it("ошибка при неверном пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "wrongpass" })
        .expect(401);
    });
  });

  describe("POST /v1/common/auth/refresh", () => {
    it("успешный рефреш токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(201);

      expect(res.body.tokens).toHaveProperty("access_token");
      expect(res.body.tokens.refresh_token).not.toBe(refresh_token);
    });

    it("ошибка при повторном использовании токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: "invalid-token" })
        .expect(401);
    });
  });

  describe("POST /v1/common/auth/refresh при изменении статуса пользователя", () => {
    it("ошибка 401 после бана", async () => {
      const passwordHash = await Bun.password.hash("pass123");
      await authStore.saveUser({
        uuid: "banned-user-uuid",
        username: "banneduser",
        passwordHash,
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });

      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "banneduser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;
      const user = await authStore.findByUsername("banneduser");
      await authStore.saveUser({ ...user!, banned: true });

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });
  });

  describe("POST /v1/common/auth/invalidate", () => {
    it("успешная инвалидация токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/invalidate")
        .send({ refresh_token })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/invalidate")
        .send({ refresh_token: "invalid-token" })
        .expect(401);
    });
  });

  describe("POST /v1/common/auth/login rate limit", () => {
    it("429 после превышения лимита попыток на username", async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        await supertest(app.getHttpServer())
          .post("/v1/common/auth/login")
          .send({ username: "bruteforce-target", password: "wrong" })
          .expect(401);
      }

      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "bruteforce-target", password: "wrong" })
        .expect(429);

      expect(res.body).toHaveProperty("statusCode", 429);
    });

    it("лимит не блокирует других пользователей", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);

      expect(res.body.username).toBe("v1user");
    });
  });
});
