process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1AuthController } from "../auth.controller";
import { AuthService } from "../../../../auth/service/auth.service";
import { AuthMapStore, AuthMapStoreToken } from "../../../../auth/service/auth_store.service";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { registerAuthRateLimit } from "../../../../common/auth-rate-limit";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";

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

describe("V1 common/auth эндпоинты", (): void => {
  let app: INestApplication;
  let registeredUuid: string;
  let authStore: AuthMapStore;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
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
        TestJwtStrategy,
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    const fastifyInstance = app.getHttpAdapter().getInstance() as FastifyInstance;
    await registerAuthRateLimit(fastifyInstance, {
      max: 10,
      timeWindow: 60000,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authStore = moduleFixture.get<AuthMapStore>(AuthMapStoreToken);
    jwtService = moduleFixture.get(JwtService);

    const registerRes = await supertest(app.getHttpServer())
      .post("/v1/common/auth/registration")
      .send({ username: "v1user", password: "pass123" })
      .expect(201);
    registeredUuid = registerRes.body.uuid;
    await authStore.approveUser(registeredUuid);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /v1/common/auth/registration", () => {
    it("успешная регистрация нового пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "brandnewuser", password: "pass123" })
        .expect(201);

      expect(res.body).toHaveProperty("tokens");
      expect(res.body.tokens).toHaveProperty("access_token");
      expect(res.body.tokens).toHaveProperty("refresh_token");
      expect(res.body.username).toBe("brandnewuser");
      expect(res.body.role).toBe("user");
    });

    it("ошибка при повторной регистрации", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "v1user", password: "pass123" })
        .expect(409);
    });

    it("возвращает 400 при пустом username", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "", password: "pass123" })
        .expect(400);
    });

    it("возвращает 400 при коротком пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "shortpassuser", password: "123" })
        .expect(400);
    });

    it("возвращает 400 при пустом пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "emptypassuser", password: "" })
        .expect(400);
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
        .send({ username: "loginuser", password: "pass123" })
        .expect(401);
    });

    it("возвращает 400 при пустом пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "loginuser", password: "" })
        .expect(400);
    });
  });

  describe("POST /v1/common/auth/refresh", () => {
    beforeAll(async () => {
      const passwordHash = await Bun.password.hash("pass123");
      await authStore.saveUser({
        uuid: "refresh-user-uuid",
        username: "refreshuser",
        passwordHash,
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
    });

    it("успешный рефреш токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "refreshuser", password: "pass123" })
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
        .send({ username: "refreshuser", password: "pass123" })
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
    beforeAll(async () => {
      const passwordHash = await Bun.password.hash("pass123");
      await authStore.saveUser({
        uuid: "invalidator-uuid",
        username: "invalidator",
        passwordHash,
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
    });

    it("успешная инвалидация токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "invalidator", password: "pass123" })
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
          .send({ username: "bruteforce-target", password: "wrongpass" })
          .expect(401);
      }

      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "bruteforce-target", password: "wrongpass" })
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

  describe("PATCH /v1/common/auth/password", () => {
    beforeAll(async () => {
      const passwordHash = await Bun.password.hash("oldpass123");
      await authStore.saveUser({
        uuid: "passchanger-uuid",
        username: "passchanger",
        passwordHash,
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
    });

    const buildPasschangerToken = (): string =>
      jwtService.sign({ sub: "passchanger-uuid", username: "passchanger", role: "user" });

    it("успешная смена пароля с перевыпуском токенов", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "passchanger", password: "oldpass123" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${buildPasschangerToken()}`)
        .send({ old_password: "oldpass123", new_password: "newpass456" })
        .expect(200);

      expect(res.body.tokens).toHaveProperty("access_token");
      expect(res.body.tokens).toHaveProperty("refresh_token");
      expect(res.body.username).toBe("passchanger");
      expect(res.body.tokens.refresh_token).not.toBe(loginRes.body.tokens.refresh_token);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: loginRes.body.tokens.refresh_token })
        .expect(401);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: res.body.tokens.refresh_token })
        .expect(201);

      const authStoreInstance = app.get(AuthMapStoreToken, { strict: false });
      await authStoreInstance.saveUser({
        uuid: "passchanger-uuid",
        username: "passchanger",
        passwordHash: await Bun.password.hash("oldpass123"),
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
    });

    it("вход с новым паролем после смены", async () => {
      const authStoreInstance = app.get(AuthMapStoreToken, { strict: false });
      const user = await authStoreInstance.findByUsername("passchanger");
      await authStoreInstance.saveUser({
        ...user!,
        passwordHash: await Bun.password.hash("newpass456"),
      });

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "passchanger", password: "newpass456" })
        .expect(201);

      await authStoreInstance.saveUser({
        ...user!,
        passwordHash: await Bun.password.hash("oldpass123"),
      });
    });

    it("вход со старым паролем отклоняется", async () => {
      const authStoreInstance = app.get(AuthMapStoreToken, { strict: false });
      const user = await authStoreInstance.findByUsername("passchanger");
      const originalHash = user!.passwordHash;
      await authStoreInstance.saveUser({
        ...user!,
        passwordHash: await Bun.password.hash("newpass456"),
      });

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "passchanger", password: "oldpass123" })
        .expect(401);

      await authStoreInstance.saveUser({ ...user!, passwordHash: originalHash });
    });

    it("401 при неверном старом пароле", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${buildPasschangerToken()}`)
        .send({ old_password: "wrongoldpass", new_password: "another789" })
        .expect(401);
    });

    it("401 без токена", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .send({ old_password: "newpass456", new_password: "another789" })
        .expect(401);
    });

    it("400 при коротком новом пароле", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${buildPasschangerToken()}`)
        .send({ old_password: "newpass456", new_password: "123" })
        .expect(400);
    });

    it("401 для заблокированного пользователя", async () => {
      const passwordHash = await Bun.password.hash("bannedpass1");
      await authStore.saveUser({
        uuid: "banned-passchanger-uuid",
        username: "bannedpasschanger",
        passwordHash,
        skin: null,
        role: "user",
        approved: true,
        banned: true,
      });

      const token = jwtService.sign({
        sub: "banned-passchanger-uuid",
        username: "bannedpasschanger",
        role: "user",
      });

      await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ old_password: "bannedpass1", new_password: "another789" })
        .expect(401);
    });
  });
});
