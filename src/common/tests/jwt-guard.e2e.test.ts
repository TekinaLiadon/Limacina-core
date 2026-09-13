import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import supertest from "supertest";
import { JwtStrategy } from "../jwt.strategy";
import { Jwt_authGuard } from "../jwt_auth.guard";
import { RolesGuard } from "../roles.guard";
import { Roles } from "../roles.decorator";
import { CurrentUser, type RequestUser } from "../current-user.decorator";
import {
  AuthMapStore,
  AuthMapStoreToken,
  type StoredUser,
} from "../../auth/service/auth_store.service";
import GlobalConfig from "../../config/global-config";
import { AppConfigToken } from "../../config/app-config.provider";

@Controller("v1/guard-probe")
class GuardProbeController {
  @Get("me")
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @Get("owner-zone")
  @Roles("owner")
  ownerZone(): { success: boolean } {
    return { success: true };
  }
}

const buildUser = (uuid: string, username: string, overrides: Partial<StoredUser>): StoredUser => ({
  uuid,
  username,
  passwordHash: "hash",
  role: "user",
  approved: true,
  banned: false,
  ...overrides,
});

describe("Jwt_authGuard — проверки статуса пользователя на HTTP-уровне", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let authStore: AuthMapStore;
  let userSeq = 0;
  const config = GlobalConfig.parseEnvOrExit();

  const signAccess = (payload: {
    sub: string;
    username: string;
    role: string;
    typ?: string;
  }): string => jwtService.sign({ typ: "access", ...payload });

  const seedUser = async (overrides: Partial<StoredUser> = {}): Promise<StoredUser> => {
    userSeq += 1;
    const user = buildUser(`guard-uuid-${userSeq}`, `guarduser${userSeq}`, overrides);
    await authStore.saveUser(user);
    return user;
  };

  beforeAll(async (): Promise<void> => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: config.JWT_ACCESS,
          signOptions: { expiresIn: 3600 },
        }),
      ],
      controllers: [GuardProbeController],
      providers: [
        JwtStrategy,
        { provide: AppConfigToken, useFactory: () => config },
        { provide: AuthMapStoreToken, useClass: AuthMapStore },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    jwtService = moduleFixture.get(JwtService);
    authStore = moduleFixture.get(AuthMapStoreToken);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it("запрос без токена — 401", async (): Promise<void> => {
    await supertest(app.getHttpServer()).get("/v1/guard-probe/me").expect(401);
  });

  it("валидный access-токен проходит гард и получает роль из стора", async (): Promise<void> => {
    const user = await seedUser({ role: "admin" });
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    const res = await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      uuid: user.uuid,
      username: user.username,
      role: "admin",
    });
  });

  it("забаненный пользователь — 401 «Нет доступа»", async (): Promise<void> => {
    const user = await seedUser({ banned: true });
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    const res = await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);

    expect(res.body.message).toBe("Нет доступа");
  });

  it("неодобренный пользователь — 401 «Нет доступа»", async (): Promise<void> => {
    const user = await seedUser({ approved: false });
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    const res = await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);

    expect(res.body.message).toBe("Нет доступа");
  });

  it("удалённый пользователь — 401", async (): Promise<void> => {
    const user = await seedUser();
    await authStore.deleteUser(user.uuid);
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("неизвестный пользователь — 401", async (): Promise<void> => {
    const token = signAccess({ sub: "nobody-uuid", username: "nobody", role: "user" });

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("sub токена, не совпадающий с uuid пользователя, — 401", async (): Promise<void> => {
    const user = await seedUser();
    const token = signAccess({ sub: "mismatch-uuid", username: user.username, role: "user" });

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("access-токен, выданный до смены пароля, — 401", async (): Promise<void> => {
    const user = await seedUser();
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    const accepted = await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(accepted.body.uuid).toBe(user.uuid);

    await Bun.sleep(1100);
    await authStore.replacePassword(user.uuid, "new-hash", new Date());

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("RolesGuard проверяет роль из стора, а не из payload токена", async (): Promise<void> => {
    const user = await seedUser({ role: "owner" });
    const token = signAccess({ sub: user.uuid, username: user.username, role: "user" });

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/owner-zone")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  it("понижение роли в сторе закрывает owner-зону, несмотря на роль в токене", async (): Promise<void> => {
    const user = await seedUser({ role: "user" });
    const token = signAccess({ sub: user.uuid, username: user.username, role: "owner" });

    await supertest(app.getHttpServer())
      .get("/v1/guard-probe/owner-zone")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
