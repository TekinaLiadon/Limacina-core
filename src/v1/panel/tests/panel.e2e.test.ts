process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import fastifyMultipart from "@fastify/multipart";
import supertest from "supertest";
import { V1PanelUsersController } from "../users.controller";
import { V1PanelLogsController } from "../logs.controller";
import { V1PanelLauncherController } from "../launcher.controller";
import { V1PanelServerController } from "../server.controller";
import { AdminService } from "../../../admin/admin.service";
import { LogsService } from "../../../admin/logs.service";
import { LauncherUpdateService } from "../../../admin/launcher-update.service";
import { ConfigUpdateService } from "../../../admin/config-update.service";
import { TechnicalService } from "../../../technical/technical.service";
import { AdminMapStore, AdminMapStoreToken } from "../../../admin/admin.store";
import { AuthMapStore, AuthMapStoreToken } from "../../../auth/service/auth_store.service";
import GlobalConfig from "../../../config/global-config";
import { AppConfigToken } from "../../../config/app-config.provider";
import { Jwt_authGuard } from "../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../common/roles.guard";

const CONFIG_FILE = "config.toml";
const CONFIG_BACKUP = "config.toml.bak";
const VERSION_FILE = "public/version.json";
const VERSION_BACKUP = "public/version.json.bak";

function requestLine(id: string, url: string, remoteAddress: string, statusCode: number): string {
  return JSON.stringify({
    level: 30,
    time: 1,
    name: "Limacina",
    req: { id, method: "GET", url, remoteAddress, remotePort: 12345 },
    res: { statusCode, headers: {} },
    msg: "request completed",
    responseTime: 1,
  });
}

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

describe("V1 panel эндпоинты", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let adminToken: string;
  let ownerToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [
        V1PanelUsersController,
        V1PanelLogsController,
        V1PanelLauncherController,
        V1PanelServerController,
      ],
      providers: [
        AdminService,
        LogsService,
        LauncherUpdateService,
        ConfigUpdateService,
        TechnicalService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        TestJwtStrategy,
        {
          provide: AdminMapStoreToken,
          useClass: AdminMapStore,
        },
        {
          provide: AuthMapStoreToken,
          useClass: AuthMapStore,
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

    adminToken = jwtService.sign({ sub: "admin-uuid", username: "admin", role: "admin" });
    ownerToken = jwtService.sign({ sub: "owner-uuid", username: "owner", role: "owner" });
    userToken = jwtService.sign({ sub: "user-uuid", username: "user", role: "user" });

    const storeInstance = moduleFixture.get(AdminMapStoreToken);
    await storeInstance.saveUser({
      uuid: "admin-uuid",
      username: "admin",
      role: "admin",
      approved: true,
      banned: false,
    });
    await storeInstance.saveUser({
      uuid: "user-uuid",
      username: "user",
      role: "user",
      approved: false,
      banned: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /v1/panel/users/init-owner", () => {
    it("создаёт владельца без токена (публичный бутстрап)", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/panel/users/init-owner")
        .send({ username: "owner", password: "securepassword" })
        .expect(201);

      expect(res.body.username).toBe("owner");
      expect(res.body.uuid).toBeDefined();
    });

    it("возвращает 409 если владелец уже создан", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/panel/users/init-owner")
        .send({ username: "owner2", password: "securepassword" })
        .expect(409);

      expect(res.body.message).toContain("Владелец уже создан");
    });

    it("возвращает 400 при коротком пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/users/init-owner")
        .send({ username: "test", password: "123" })
        .expect(400);
    });
  });

  describe("GET /v1/panel/users", () => {
    beforeAll(async () => {
      const store = app.get(AdminMapStoreToken, { strict: false });
      await store.saveUser({
        uuid: "alice-uuid",
        username: "alice",
        role: "user",
        approved: true,
        banned: false,
      });
      await store.saveUser({
        uuid: "bob-uuid",
        username: "bob",
        role: "user",
        approved: false,
        banned: false,
      });
      await store.saveUser({
        uuid: "carol-uuid",
        username: "carol",
        role: "user",
        approved: true,
        banned: false,
      });
    });

    it("возвращает пользователей с пагинацией", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual([
        "admin",
        "alice",
        "bob",
        "carol",
        "owner",
        "user",
      ]);
      expect(res.body.total).toBe(6);
      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(0);
      expect(res.body.items[0]).toHaveProperty("uuid");
      expect(res.body.items[0]).toHaveProperty("role");
      expect(res.body.items[0]).toHaveProperty("approved");
      expect(res.body.items[0]).toHaveProperty("banned");
    });

    it("фильтрует неодобренных через approved=false", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?approved=false")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(["bob", "user"]);
      expect(res.body.total).toBe(2);
      expect(res.body.items.every((u: { approved: boolean }) => u.approved === false)).toBe(true);
    });

    it("фильтрует одобренных через approved=true", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?approved=true")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.items.every((u: { approved: boolean }) => u.approved === true)).toBe(true);
    });

    it("ищет по username с начала имени без учёта регистра", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?username=ALI")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(["alice"]);
      expect(res.body.total).toBe(1);
    });

    it("не ищет по подстроке в середине юзернейма", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?username=li")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it("комбинирует поиск по username с фильтром approved", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?username=o&approved=true")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(["owner"]);
      expect(res.body.total).toBe(1);
    });

    it("пагинрует через limit и offset", async () => {
      const firstPage = await supertest(app.getHttpServer())
        .get("/v1/panel/users?limit=2")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(firstPage.body.items.map((u: { username: string }) => u.username)).toEqual([
        "admin",
        "alice",
      ]);
      expect(firstPage.body.total).toBe(6);
      expect(firstPage.body.limit).toBe(2);

      const secondPage = await supertest(app.getHttpServer())
        .get("/v1/panel/users?limit=2&offset=2")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(secondPage.body.items.map((u: { username: string }) => u.username)).toEqual([
        "bob",
        "carol",
      ]);
      expect(secondPage.body.offset).toBe(2);
      expect(secondPage.body.total).toBe(6);
    });

    it("возвращает пустую страницу при offset за пределами списка", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?offset=100")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(6);
    });

    it("возвращает 400 при невалидном approved", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users?approved=maybe")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при limit вне диапазона", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users?limit=0")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);

      await supertest(app.getHttpServer())
        .get("/v1/panel/users?limit=101")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при отрицательном offset", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users?offset=-1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при пустом username", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users?username=")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get("/v1/panel/users").expect(401);
    });

    it("не отдаёт удалённый эндпоинт unapproved", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/unapproved")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe("PATCH /v1/panel/users/approve", () => {
    it("одобряет пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", approved: true })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users?approved=false")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.some((u: { username: string }) => u.username === "user")).toBe(false);
    });
  });

  describe("PATCH /v1/panel/users/ban", () => {
    it("банит и разбанивает пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", banned: true })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const target = res.body.items.find((u: { username: string }) => u.username === "user");
      expect(target.banned).toBe(true);

      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", banned: false })
        .expect(200);
    });
  });

  describe("PATCH /v1/panel/users/role", () => {
    it("изменяет роль пользователя", async () => {
      const store = app.get(AdminMapStoreToken, { strict: false });
      await store.saveUser({
        uuid: "roleuser-uuid",
        username: "roleuser",
        role: "user",
        approved: true,
        banned: false,
      });

      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/role")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "roleuser", role: "moderator" })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const target = res.body.items.find((u: { username: string }) => u.username === "roleuser");
      expect(target.role).toBe("moderator");
    });

    it("возвращает 400 при недопустимой роли", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/role")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "roleuser", role: "superadmin" })
        .expect(400);
    });
  });

  describe("PATCH /v1/panel/users/password", () => {
    beforeAll(async () => {
      const authStore = app.get(AuthMapStoreToken, { strict: false });
      await authStore.saveUser({
        uuid: "user-uuid",
        username: "user",
        passwordHash: await Bun.password.hash("useroldpass"),
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
    });

    it("владелец задаёт новый пароль без знания старого", async () => {
      const authStore = app.get(AuthMapStoreToken, { strict: false });
      await authStore.saveRefresh("password-test-jti", {
        userId: "user-uuid",
        username: "user",
      });

      const res = await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "user", password: "ownernewpass" })
        .expect(200);

      expect(res.body.success).toBe(true);

      const stored = await authStore.findByUsername("user");
      expect(await Bun.password.verify("ownernewpass", stored!.passwordHash)).toBe(true);
      expect(await Bun.password.verify("useroldpass", stored!.passwordHash)).toBe(false);
      expect(await authStore.findRefresh("password-test-jti")).toBeUndefined();
    });

    it("возвращает 403 для админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", password: "adminsetpass" })
        .expect(403);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ username: "user", password: "usersetpass" })
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .send({ username: "user", password: "anypass123" })
        .expect(401);
    });

    it("возвращает 404 для несуществующего пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "nonexistent", password: "anypass123" })
        .expect(404);
    });

    it("возвращает 403 при попытке изменить пароль владельца", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "owner", password: "anypass123" })
        .expect(403);
    });

    it("возвращает 400 при коротком пароле", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/password")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "user", password: "123" })
        .expect(400);
    });
  });

  describe("DELETE /v1/panel/users/:username", () => {
    beforeAll(async () => {
      const store = app.get(AdminMapStoreToken, { strict: false });
      await store.saveUser({
        uuid: "secondadmin-uuid",
        username: "secondadmin",
        role: "admin",
        approved: true,
        banned: false,
      });
      await store.saveUser({
        uuid: "modtarget-uuid",
        username: "modtarget",
        role: "moderator",
        approved: true,
        banned: false,
      });
    });

    it("удаляет пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .delete("/v1/panel/users/roleuser")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe("roleuser");
    });

    it("возвращает 404 для несуществующего пользователя", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/panel/users/nonexistent")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("возвращает 403 при удалении другого админа админом", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/panel/users/secondadmin")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("возвращает 403 при удалении владельца админом", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/panel/users/owner")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("админ может удалить пользователя с ролью ниже", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/panel/users/modtarget")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const store = app.get(AdminMapStoreToken, { strict: false });
      await store.restoreUser("modtarget");
    });
  });

  describe("GET /v1/panel/users/deleted", () => {
    beforeAll(async () => {
      const store = app.get(AdminMapStoreToken, { strict: false });
      for (const username of ["dana", "dave", "derek"]) {
        await store.saveUser({
          uuid: `${username}-uuid`,
          username,
          role: "user",
          approved: true,
          banned: false,
        });
        await store.deleteUser(username);
      }
    });

    it("возвращает удалённых пользователей с пагинацией для владельца", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual([
        "dana",
        "dave",
        "derek",
        "roleuser",
      ]);
      expect(res.body.total).toBe(4);
      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(0);
      expect(res.body.items[0]).toHaveProperty("role");
      expect(res.body.items[0]).toHaveProperty("approved");
      expect(res.body.items[0]).toHaveProperty("banned");
      expect(res.body.items[0]).toHaveProperty("deletedAt");
    });

    it("пагинрует через limit и offset", async () => {
      const firstPage = await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?limit=2")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(firstPage.body.items.map((u: { username: string }) => u.username)).toEqual([
        "dana",
        "dave",
      ]);
      expect(firstPage.body.total).toBe(4);

      const secondPage = await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?limit=2&offset=2")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(secondPage.body.items.map((u: { username: string }) => u.username)).toEqual([
        "derek",
        "roleuser",
      ]);
      expect(secondPage.body.offset).toBe(2);
      expect(secondPage.body.total).toBe(4);
    });

    it("ищет по username с начала имени без учёта регистра", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?username=DA")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(["dana", "dave"]);
      expect(res.body.total).toBe(2);
    });

    it("не ищет по подстроке в середине юзернейма", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?username=ana")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it("возвращает 403 для админа", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get("/v1/panel/users/deleted").expect(401);
    });

    it("возвращает 400 при limit вне диапазона", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?limit=0")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(400);

      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?limit=101")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(400);
    });

    it("возвращает 400 при отрицательном offset", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?offset=-1")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(400);
    });

    it("возвращает 400 при пустом username", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/users/deleted?username=")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(400);
    });
  });

  describe("PATCH /v1/panel/users/:username/restore", () => {
    beforeAll(async () => {
      const store = app.get(AdminMapStoreToken, { strict: false });
      const targets: Array<[string, string]> = [
        ["deletedadmin", "admin"],
        ["deletedowner", "owner"],
        ["deletedmod", "moderator"],
      ];
      for (const [username, role] of targets) {
        await store.saveUser({
          uuid: `${username}-uuid`,
          username,
          role,
          approved: true,
          banned: false,
        });
        await store.deleteUser(username);
      }
    });

    it("восстанавливает удалённого пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .patch("/v1/panel/users/roleuser/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe("roleuser");
    });

    it("возвращает 403 при восстановлении удалённого админа админом", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/deletedadmin/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("возвращает 403 при восстановлении удалённого владельца админом", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/deletedowner/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("админ может восстановить удалённого модератора", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/deletedmod/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });

    it("владелец может восстановить удалённого админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/deletedadmin/restore")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);
    });

    it("возвращает 404 для несуществующего удалённого пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/users/nonexistent/restore")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe("POST /v1/panel/server/restart", () => {
    it("принимает команду и отправляет сигнал остановки", async () => {
      const technicalService = app.get(TechnicalService);
      let shutdownSignalled = false;
      technicalService.sendShutdownSignal = () => {
        shutdownSignalled = true;
      };

      const res = await supertest(app.getHttpServer())
        .post("/v1/panel/server/restart")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      await Bun.sleep(500);
      expect(shutdownSignalled).toBe(true);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/restart")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).post("/v1/panel/server/restart").expect(401);
    });
  });

  describe("GET /v1/panel/logs", () => {
    const FILTER_DATE = "2099-06-15";
    const FILTER_LOG_FILE = join(process.cwd(), "logs", `${FILTER_DATE}.log`);

    beforeAll(() => {
      mkdirSync(join(process.cwd(), "logs"), { recursive: true });
      writeFileSync(
        FILTER_LOG_FILE,
        [
          JSON.stringify({
            level: 30,
            time: 1,
            name: "Limacina",
            context: "App",
            msg: "Идет запуск...",
          }),
          requestLine("req-1", "/v1/common/auth/login", "127.0.0.1", 200),
          requestLine("req-2", "/v1/common/auth/registration", "192.168.1.10", 400),
          requestLine("req-3", "/v1/panel/logs", "10.0.0.5", 500),
          "not-a-json-line",
        ].join("\n"),
      );
    });

    afterAll(() => {
      rmSync(FILTER_LOG_FILE, { force: true });
    });

    it("возвращает логи за сегодня", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${today}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("date", today);
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.lines)).toBe(true);
    });

    it("не возвращает строки без кода статуса", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.lines.length).toBe(3);
      const statusCodes = res.body.lines.map((line: string) => JSON.parse(line).res.statusCode);
      expect(statusCodes).toEqual([200, 400, 500]);
    });

    it("фильтрует по статус-коду", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&statusCode=400`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(JSON.parse(res.body.lines[0]).res.statusCode).toBe(400);
    });

    it("фильтрует по url как по подстроке без учёта регистра", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&url=/COMMON/auth`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      const urls = res.body.lines.map((line: string) => JSON.parse(line).req.url);
      expect(urls).toEqual(["/v1/common/auth/login", "/v1/common/auth/registration"]);
    });

    it("фильтрует по ip как по подстроке", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&ip=192.168.`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(JSON.parse(res.body.lines[0]).req.remoteAddress).toBe("192.168.1.10");
    });

    it("комбинирует фильтры", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&statusCode=200&url=login&ip=127.0.0.1`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(JSON.parse(res.body.lines[0]).req.url).toBe("/v1/common/auth/login");
    });

    it("возвращает 400 при статус-коде вне диапазона", async () => {
      await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&statusCode=99`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при нечисловом статус-коде", async () => {
      await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&statusCode=abc`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при пустом фильтре url", async () => {
      await supertest(app.getHttpServer())
        .get(`/v1/panel/logs?date=${FILTER_DATE}&url=`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при неверном формате даты", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/logs?date=not-a-date")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/logs")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe("GET /v1/panel/logs/dates", () => {
    it("возвращает список доступных дат", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/logs/dates")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("PATCH /v1/panel/launcher/config", () => {
    beforeAll(() => {
      if (existsSync(CONFIG_FILE)) {
        renameSync(CONFIG_FILE, CONFIG_BACKUP);
      }
    });

    afterAll(() => {
      if (existsSync(CONFIG_FILE)) {
        unlinkSync(CONFIG_FILE);
      }
      if (existsSync(CONFIG_BACKUP)) {
        renameSync(CONFIG_BACKUP, CONFIG_FILE);
      }
    });

    const validConfig = {
      projectName: "V1TestProject",
      mcVersion: "1.21.1",
      modLoader: "neoforge",
      loaderVersion: "21.1.0",
      jvmArgs: ["-XX:+UseG1GC"],
      minMemory: "-Xms512M",
      maxMemory: "-Xmx2048M",
      online: true,
    };

    it("создаёт конфиг (единственная точка записи)", async () => {
      const res = await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(validConfig)
        .expect(200);

      expect(res.body.projectName).toBe("V1TestProject");

      const content = readFileSync(CONFIG_FILE, "utf-8");
      expect(content).toContain("V1TestProject");
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher/config")
        .set("Authorization", `Bearer ${userToken}`)
        .send(validConfig)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher/config")
        .send(validConfig)
        .expect(401);
    });
  });

  describe("PATCH /v1/panel/launcher", () => {
    beforeAll(() => {
      renameSync(VERSION_FILE, VERSION_BACKUP);
    });

    afterAll(() => {
      if (existsSync(VERSION_FILE)) {
        unlinkSync(VERSION_FILE);
      }
      renameSync(VERSION_BACKUP, VERSION_FILE);
    });

    it("возвращает 400 при невалидной версии", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("version", "bad-version")
        .expect(400);
    });

    it("возвращает 400 при неизвестном имени файлового поля", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("version", "9.9.9")
        .attach("linux_x64", Buffer.from("zip-content"), "launcher.zip")
        .expect(400);
    });

    it("обновляет версию лаунчера", async () => {
      const res = await supertest(app.getHttpServer())
        .patch("/v1/panel/launcher")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("version", "9.9.9")
        .expect(200);

      expect(res.body.version).toBe("9.9.9");
      expect(res.body.updated).toEqual([]);

      const data = JSON.parse(readFileSync(VERSION_FILE, "utf-8")) as { version: string };
      expect(data.version).toBe("9.9.9");
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).patch("/v1/panel/launcher").expect(401);
    });
  });
});
