import { setupTestEnv } from "../../../../utils/tests/test-env";

setupTestEnv();

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
import {
  AuthMapStore,
  AuthMapStoreToken,
  type StoredUser,
} from "../../../../auth/service/auth_store.service";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { registerAuthRateLimit } from "../../../../common/auth-rate-limit";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";

const seedUser = async (
  store: AuthMapStore,
  username: string,
  uuid: string,
  password: string,
  overrides: Partial<StoredUser> = {},
): Promise<StoredUser> => {
  const user: StoredUser = {
    uuid,
    username,
    passwordHash: await Bun.password.hash(password),
    role: "user",
    approved: true,
    banned: false,
    ...overrides,
  };
  await store.saveUser(user);
  return user;
};

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

    it("повторная регистрация не перезаписывает существующего пользователя", async () => {
      const before = await authStore.findByUsername("v1user");
      expect(before).toBeDefined();

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "v1user", password: "otherpass123" })
        .expect(409);

      const after = await authStore.findByUsername("v1user");
      expect(after?.uuid).toBe(before?.uuid);
      expect(after?.passwordHash).toBe(before?.passwordHash);
    });

    it("регистрация ника, отличающегося только регистром, даёт 409", async () => {
      const registered = await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "cireguser", password: "pass123" })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "CIRegUser", password: "pass123" })
        .expect(409);

      await authStore.__test__deleteUser(registered.body.username);
    });

    it("параллельная регистрация одного юзернейма: один 201, второй 409", async () => {
      const [first, second] = await Promise.all([
        supertest(app.getHttpServer())
          .post("/v1/common/auth/registration")
          .send({ username: "raceruser", password: "pass123" }),
        supertest(app.getHttpServer())
          .post("/v1/common/auth/registration")
          .send({ username: "raceruser", password: "pass123" }),
      ]);

      const statuses = [first.status, second.status].toSorted();
      expect(statuses).toEqual([201, 409]);

      const user = await authStore.findByUsername("raceruser");
      expect(user).toBeDefined();
      await authStore.__test__deleteUser("raceruser");
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

    it("возвращает 400 при username длиннее 64 символов (TASK-11)", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "a".repeat(65), password: "pass123" })
        .expect(400);
    });

    it("логин забаненного пользователя отклоняется", async () => {
      const user = await seedUser(authStore, "bannedlogin", "banned-login-uuid", "pass123");
      try {
        await authStore.saveUser({ ...user, banned: true });

        await supertest(app.getHttpServer())
          .post("/v1/common/auth/login")
          .send({ username: "bannedlogin", password: "pass123" })
          .expect(401);
      } finally {
        await authStore.saveUser({ ...user, banned: false });
      }
    });

    it("не раскрывает отсутствие пользователя: сообщение как при неверном пароле (TASK-10)", async () => {
      const wrongPassword = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "wrongpass" })
        .expect(401);

      const ghost = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "ghostuser", password: "wrongpass" })
        .expect(401);

      expect(ghost.body.message).toBe("Неверное имя пользователя или пароль");
      expect(ghost.body.message).toBe(wrongPassword.body.message);
    });

    it("не раскрывает бан: сообщение как при неверном пароле (TASK-10)", async () => {
      const user = await seedUser(authStore, "bannedlogin", "banned-login-uuid", "pass123");
      try {
        await authStore.saveUser({ ...user, banned: true });

        const res = await supertest(app.getHttpServer())
          .post("/v1/common/auth/login")
          .send({ username: "bannedlogin", password: "pass123" })
          .expect(401);

        expect(res.body.message).toBe("Неверное имя пользователя или пароль");
      } finally {
        await authStore.saveUser({ ...user, banned: false });
      }
    });

    it("не раскрывает неодобрение: сообщение как при неверном пароле (TASK-10)", async () => {
      const user = await seedUser(authStore, "unapprovedlogin", "unapproved-login-uuid", "pass123");
      try {
        await authStore.saveUser({ ...user, approved: false });

        const res = await supertest(app.getHttpServer())
          .post("/v1/common/auth/login")
          .send({ username: "unapprovedlogin", password: "pass123" })
          .expect(401);

        expect(res.body.message).toBe("Неверное имя пользователя или пароль");
      } finally {
        await authStore.saveUser({ ...user, approved: true });
      }
    });
  });

  describe("POST /v1/common/auth/refresh", () => {
    beforeAll(async () => {
      await seedUser(authStore, "refreshuser", "refresh-user-uuid", "pass123");
      await seedUser(authStore, "refresheracer", "refresh-racer-uuid", "pass123");
    });

    it("токены из регистрации не работают до одобрения", async () => {
      const registerRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/registration")
        .send({ username: "unapprovedreg", password: "pass123" })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: registerRes.body.tokens.refresh_token })
        .expect(401);
      expect(res.body.message).toBe("Нет доступа");

      await authStore.approveUser(registerRes.body.uuid);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: registerRes.body.tokens.refresh_token })
        .expect(201);
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

    it("параллельный refresh одного токена: ровно один 201 (TASK-9)", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "refresheracer", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      const [first, second] = await Promise.all([
        supertest(app.getHttpServer()).post("/v1/common/auth/refresh").send({ refresh_token }),
        supertest(app.getHttpServer()).post("/v1/common/auth/refresh").send({ refresh_token }),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 401]);

      const winner = first.status === 201 ? first : second;
      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token: winner.body.tokens.refresh_token })
        .expect(201);
    });
  });

  describe("POST /v1/common/auth/refresh при изменении статуса пользователя", () => {
    it("ошибка 401 после бана", async () => {
      const user = await seedUser(authStore, "banneduser", "banned-user-uuid", "pass123");

      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "banneduser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;
      await authStore.saveUser({ ...user, banned: true });

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    it("ошибка 401 после снятия approve", async () => {
      const user = await seedUser(authStore, "unapproveduser", "unapproved-user-uuid", "pass123");

      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "unapproveduser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;
      await authStore.saveUser({ ...user, approved: false });

      const res = await supertest(app.getHttpServer())
        .post("/v1/common/auth/refresh")
        .send({ refresh_token })
        .expect(401);

      expect(res.body.message).toBe("Нет доступа");
    });

    it("ошибка 401 после удаления пользователя", async () => {
      await seedUser(authStore, "replaceduser", "replaced-user-uuid", "pass123");

      const loginRes = await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "replaceduser", password: "pass123" })
        .expect(201);

      try {
        await authStore.__test__deleteUser("replaceduser");

        await supertest(app.getHttpServer())
          .post("/v1/common/auth/refresh")
          .send({ refresh_token: loginRes.body.tokens.refresh_token })
          .expect(401);
      } finally {
        await seedUser(authStore, "replaceduser", "replaced-user-uuid", "pass123");
      }
    });
  });

  describe("POST /v1/common/auth/invalidate", () => {
    beforeAll(async () => {
      await seedUser(authStore, "invalidator", "invalidator-uuid", "pass123");
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
      await seedUser(authStore, "passchanger", "passchanger-uuid", "oldpass123");
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
      await seedUser(authStoreInstance, "passchanger", "passchanger-uuid", "oldpass123");
    });

    it("вход с новым паролем после смены", async () => {
      await seedUser(authStore, "passchanger", "passchanger-uuid", "newpass456");

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "passchanger", password: "newpass456" })
        .expect(201);

      await seedUser(authStore, "passchanger", "passchanger-uuid", "oldpass123");
    });

    it("вход со старым паролем отклоняется", async () => {
      await seedUser(authStore, "passchanger", "passchanger-uuid", "newpass456");

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "passchanger", password: "oldpass123" })
        .expect(401);

      await seedUser(authStore, "passchanger", "passchanger-uuid", "oldpass123");
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
      await seedUser(authStore, "bannedpasschanger", "banned-passchanger-uuid", "bannedpass1", {
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

    it("401 для неодобренного пользователя", async () => {
      await seedUser(authStore, "unapprovedpasschanger", "unapproved-passchanger-uuid", "pass123", {
        approved: false,
      });

      const token = jwtService.sign({
        sub: "unapproved-passchanger-uuid",
        username: "unapprovedpasschanger",
        role: "user",
      });

      const res = await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ old_password: "pass123", new_password: "another789" })
        .expect(401);

      expect(res.body.message).toBe("Нет доступа");
    });
  });

  describe("PATCH /v1/common/auth/password rate limit", () => {
    beforeAll(async () => {
      await seedUser(authStore, "bruteforcer", "bruteforcer-uuid", "realpass1");
    });

    const buildBruteforcerToken = (): string =>
      jwtService.sign({ sub: "bruteforcer-uuid", username: "bruteforcer", role: "user" });

    it("429 после превышения лимита попыток подбора старого пароля", async () => {
      const token = buildBruteforcerToken();
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await supertest(app.getHttpServer())
          .patch("/v1/common/auth/password")
          .set("Authorization", `Bearer ${token}`)
          .send({ old_password: "x", new_password: "another789" });
        expect(res.status).toBe(400);
      }

      const res = await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ old_password: "wrongpass", new_password: "another789" })
        .expect(429);

      expect(res.body).toHaveProperty("statusCode", 429);
    });

    it("лимит не блокирует другие токены", async () => {
      await seedUser(authStore, "bruteforcer2", "bruteforcer2-uuid", "realpass1");

      const otherToken = jwtService.sign({
        sub: "bruteforcer2-uuid",
        username: "bruteforcer2",
        role: "user",
      });

      await supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ old_password: "wrongpass", new_password: "another789" })
        .expect(401);

      await supertest(app.getHttpServer())
        .post("/v1/common/auth/login")
        .send({ username: "v1user", password: "pass123" })
        .expect(201);
    });
  });
});
