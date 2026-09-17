import { setupTestEnv } from "../../../../utils/tests/test-env";
import { applyV1ApiPrefix } from "../../../../utils/tests/v1-prefix";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Test, type TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1AuthController } from "../auth.controller";
import { AuthService } from "../../../../auth/service/auth.service";
import { AuthMapStore, AuthStoreToken, type StoredUser } from "../../../../auth/service/auth_store";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { registerAuthRateLimit } from "../../../../common/auth-rate-limit";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";

const BUCKET_MAX = 3;

const seedUser = async (
  store: AuthMapStore,
  username: string,
  uuid: string,
  password: string,
): Promise<void> => {
  const user: StoredUser = {
    uuid,
    username,
    passwordHash: await Bun.password.hash(password),
    role: "user",
    approved: true,
    banned: false,
  };
  await store.saveUser(user);
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

describe("Auth rate limit: AND семантика username/token и IP-бакетов", (): void => {
  let app: INestApplication;
  let authStore: AuthMapStore;
  let jwtService: JwtService;

  beforeAll(async (): Promise<void> => {
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
        { provide: AuthStoreToken, useClass: AuthMapStore },
        TestJwtStrategy,
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter({ trustProxy: true }));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    const fastifyInstance = app.getHttpAdapter().getInstance() as FastifyInstance;
    await registerAuthRateLimit(fastifyInstance, {
      max: BUCKET_MAX,
      ipMax: BUCKET_MAX,
      timeWindow: 60_000,
    });
    applyV1ApiPrefix(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    authStore = moduleFixture.get<AuthMapStore>(AuthStoreToken);
    jwtService = moduleFixture.get(JwtService);
    await seedUser(authStore, "rluserc", "rluserc-uuid", "userpass1");
    await seedUser(authStore, "rlpass1", "rlpass1-uuid", "realpass1");
    await seedUser(authStore, "rlpass2", "rlpass2-uuid", "realpass2");
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  const loginAs = (username: string, ip: string, password = "wrongpass"): supertest.Test =>
    supertest(app.getHttpServer())
      .post("/v1/common/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ username, password });

  describe("POST /v1/common/auth/login", () => {
    it("username-бакет: 429 после max попыток по одному имени, IP-бакеты не при чём", async (): Promise<void> => {
      await loginAs("rlu1", "10.1.0.1").expect(401);
      await loginAs("rlu1", "10.1.0.1").expect(401);
      await loginAs("rlu1", "10.1.0.2").expect(401);
      await loginAs("rlu1", "10.1.0.2").expect(429);
    });

    it("IP-бакет блокирует и свежее имя пользователя с того же IP", async (): Promise<void> => {
      for (let attempt = 0; attempt < BUCKET_MAX; attempt++) {
        await loginAs("rlu3a", "10.1.1.1").expect(401);
      }
      await loginAs("rlu3b", "10.1.1.1").expect(429);
    });

    it("другой IP не затронут чужим IP-бакетом", async (): Promise<void> => {
      const res = await loginAs("rluserc", "10.1.2.3", "userpass1").expect(201);
      expect(res.body.username).toBe("rluserc");
    });
  });

  describe("PATCH /v1/common/auth/password", () => {
    const buildToken = (uuid: string, username: string, nonce: string): string =>
      jwtService.sign({ typ: "access", sub: uuid, username, role: "user", nonce });

    const patchPassword = (token: string, ip: string, oldPassword = "x"): supertest.Test =>
      supertest(app.getHttpServer())
        .patch("/v1/common/auth/password")
        .set("X-Forwarded-For", ip)
        .set("Authorization", `Bearer ${token}`)
        .send({ old_password: oldPassword, new_password: "another789" });

    it("token-бакет: 429 после max попыток подбора под одним токеном, IP-бакеты не при чём", async (): Promise<void> => {
      const token = buildToken("rlpass1-uuid", "rlpass1", "token-bucket");
      await patchPassword(token, "10.2.0.1").expect(400);
      await patchPassword(token, "10.2.0.1").expect(400);
      await patchPassword(token, "10.2.0.2").expect(400);

      const res = await patchPassword(token, "10.2.0.2").expect(429);
      expect(res.body.message).toContain("смены пароля");
    });

    it("IP-бакет блокирует и свежий токен с того же IP", async (): Promise<void> => {
      const hammerToken = buildToken("rlpass1-uuid", "rlpass1", "ip-hammer");
      for (let attempt = 0; attempt < BUCKET_MAX; attempt++) {
        await patchPassword(hammerToken, "10.2.1.1").expect(400);
      }

      const freshToken = buildToken("rlpass2-uuid", "rlpass2", "ip-fresh");
      const res = await patchPassword(freshToken, "10.2.1.1").expect(429);
      expect(res.body.message).toContain("смены пароля");
    });

    it("другой IP не затронут: запрос проходит лимит и получает бизнес-ответ", async (): Promise<void> => {
      const token = buildToken("rlpass2-uuid", "rlpass2", "other-ip");
      await patchPassword(token, "10.2.2.3", "wrongoldpass123").expect(401);
    });
  });
});
