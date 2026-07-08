process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AdminController } from "../admin.controller";
import { AdminService } from "../admin.service";
import { LogsService } from "../logs.service";
import { LauncherUpdateService } from "../launcher-update.service";
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
});
