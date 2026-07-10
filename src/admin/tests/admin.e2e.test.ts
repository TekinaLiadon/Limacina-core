process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { AdminController } from "../admin.controller";
import { AdminService } from "../admin.service";
import { LogsService } from "../logs.service";
import { LauncherUpdateService } from "../launcher-update.service";
import { ConfigUpdateService } from "../config-update.service";
import { AdminMapStore, AdminMapStoreToken } from "../admin.store";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable } from "@nestjs/common";
import { Jwt_authGuard } from "../../common/jwt_auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import supertest from "supertest";

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

describe("Admin эндпоинты", (): void => {
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
      controllers: [AdminController],
      providers: [
        AdminService,
        LogsService,
        LauncherUpdateService,
        ConfigUpdateService,
        TestJwtStrategy,
        {
          provide: AdminMapStoreToken,
          useClass: AdminMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    jwtService = moduleFixture.get(JwtService);
    await app.init();

    adminToken = jwtService.sign({ sub: "admin-uuid", username: "admin", role: "admin" });
    ownerToken = jwtService.sign({ sub: "owner-uuid", username: "owner", role: "owner" });
    userToken = jwtService.sign({ sub: "user-uuid", username: "user", role: "user" });

    const store = moduleFixture.get(AdminMapStoreToken);
    await store.saveUser({
      uuid: "admin-uuid",
      username: "admin",
      passwordHash: "hash",
      skin: null,
      role: "admin",
      approved: true,
      banned: false,
    });
    await store.saveUser({
      uuid: "owner-uuid",
      username: "owner",
      passwordHash: "hash",
      skin: null,
      role: "owner",
      approved: true,
      banned: false,
    });
    await store.saveUser({
      uuid: "user-uuid",
      username: "user",
      passwordHash: "hash",
      skin: null,
      role: "user",
      approved: false,
      banned: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /admin/unapproved", () => {
    it("возвращает неодобренных пользователей для админа", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/admin/unapproved")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some((u: { username: string }) => u.username === "user")).toBe(true);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/unapproved")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get("/admin/unapproved").expect(401);
    });

    it("возвращает 400 при лимите вне диапазона 10-50", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/unapproved?limit=100")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 400 при лимите меньше 10", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/unapproved?limit=5")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe("GET /admin/users", () => {
    it("возвращает список пользователей для админа", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty("username");
      expect(res.body[0]).toHaveProperty("role");
      expect(res.body[0]).toHaveProperty("approved");
      expect(res.body[0]).toHaveProperty("banned");
    });

    it("ограничивает количество по лимиту", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/admin/users?limit=1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.length).toBe(1);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get("/admin/users").expect(401);
    });
  });

  describe("PATCH /admin/approve", () => {
    it("одобряет пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", approved: true })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/admin/unapproved")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.some((u: { username: string }) => u.username === "user")).toBe(false);
    });

    it("возвращает 404 для несуществующего пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "nonexistent", approved: true })
        .expect(404);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/approve")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ username: "user", approved: false })
        .expect(403);
    });
  });

  describe("PATCH /admin/ban", () => {
    it("банит пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", banned: true })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const user = res.body.find((u: { username: string }) => u.username === "user");
      expect(user.banned).toBe(true);
    });

    it("разбанивает пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "user", banned: false })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const user = res.body.find((u: { username: string }) => u.username === "user");
      expect(user.banned).toBe(false);
    });

    it("возвращает 404 для несуществующего пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "nonexistent", banned: true })
        .expect(404);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ username: "user", banned: true })
        .expect(403);
    });
  });

  describe("GET /admin/logs", () => {
    it("возвращает логи за дату", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await supertest(app.getHttpServer())
        .get(`/admin/logs?date=${today}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("date", today);
      expect(res.body).toHaveProperty("offset", 0);
      expect(res.body).toHaveProperty("limit", 100);
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.lines)).toBe(true);
    });

    it("возвращает 400 при неверном формате даты", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/logs?date=not-a-date")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("возвращает 403 для не-админа", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await supertest(app.getHttpServer())
        .get(`/admin/logs?date=${today}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await supertest(app.getHttpServer()).get(`/admin/logs?date=${today}`).expect(401);
    });
  });

  describe("GET /admin/logs/dates", () => {
    it("возвращает список доступных дат", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/admin/logs/dates")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/logs/dates")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe("PATCH /admin/config", () => {
    const CONFIG_FILE = "config.toml";
    const CONFIG_BACKUP = "config.toml.bak";

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
      projectName: "TestProject",
      mcVersion: "1.21.1",
      modLoader: "neoforge",
      loaderVersion: "21.1.0",
      jvmArgs: ["-XX:+UseG1GC"],
      minMemory: "-Xms512M",
      maxMemory: "-Xmx2048M",
      online: true,
    };

    it("создаёт конфиг для админа", async () => {
      const res = await supertest(app.getHttpServer())
        .patch("/admin/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(validConfig)
        .expect(200);

      expect(res.body.projectName).toBe("TestProject");
      expect(res.body.mcVersion).toBe("1.21.1");

      const content = readFileSync(CONFIG_FILE, "utf-8");
      expect(content).toContain("TestProject");
    });

    it("обновляет существующий конфиг", async () => {
      const updated = { ...validConfig, projectName: "UpdatedProject" };

      const res = await supertest(app.getHttpServer())
        .patch("/admin/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(updated)
        .expect(200);

      expect(res.body.projectName).toBe("UpdatedProject");
    });

    it("возвращает 400 при отсутствии обязательных полей", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ projectName: "OnlyName" })
        .expect(400);
    });

    it("возвращает 400 при невалидных данных", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ...validConfig, online: "not-a-bool" })
        .expect(400);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/config")
        .set("Authorization", `Bearer ${userToken}`)
        .send(validConfig)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).patch("/admin/config").send(validConfig).expect(401);
    });
  });

  describe("DELETE /admin/users/:username", () => {
    it("удаляет пользователя для админа", async () => {
      const res = await supertest(app.getHttpServer())
        .delete("/admin/users/user")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe("user");

      const users = await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(users.body.some((u: { username: string }) => u.username === "user")).toBe(false);
    });

    it("возвращает 404 для несуществующего пользователя", async () => {
      await supertest(app.getHttpServer())
        .delete("/admin/users/nonexistent")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .delete("/admin/users/admin")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).delete("/admin/users/admin").expect(401);
    });
  });

  describe("GET /admin/users/deleted", () => {
    it("возвращает список удалённых пользователей для админа", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/admin/users/deleted")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((u: { username: string }) => u.username === "user")).toBe(true);
      expect(res.body[0]).toHaveProperty("deletedAt");
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/users/deleted")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe("PATCH /admin/users/:username/restore", () => {
    it("восстанавливает удалённого пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .patch("/admin/users/user/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.username).toBe("user");

      const users = await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(users.body.some((u: { username: string }) => u.username === "user")).toBe(true);
    });

    it("возвращает 404 для несуществующего удалённого пользователя", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/users/nonexistent/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("возвращает 403 для не-админа", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/users/user/restore")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).patch("/admin/users/user/restore").expect(401);
    });
  });

  describe("Owner роль", () => {
    it("owner имеет доступ к админским эндпоинтам", async () => {
      await supertest(app.getHttpServer())
        .get("/admin/users")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);
    });

    it("owner может одобрять пользователей", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/approve")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "user", approved: true })
        .expect(200);
    });

    it("admin не может забанить owner", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "owner", banned: true })
        .expect(403);
    });

    it("admin не может изменить роль owner", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/role")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "owner", role: "user" })
        .expect(403);
    });

    it("admin не может удалить owner", async () => {
      await supertest(app.getHttpServer())
        .delete("/admin/users/owner")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("admin не может изменить одобрение owner", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "owner", approved: false })
        .expect(403);
    });

    it("owner может забанить admin", async () => {
      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "admin", banned: true })
        .expect(200);

      await supertest(app.getHttpServer())
        .patch("/admin/ban")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ username: "admin", banned: false })
        .expect(200);
    });

    it("owner может удалить admin", async () => {
      await supertest(app.getHttpServer())
        .delete("/admin/users/admin")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      await supertest(app.getHttpServer())
        .patch("/admin/users/admin/restore")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);
    });
  });
});
