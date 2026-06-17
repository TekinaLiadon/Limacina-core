import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AuthController } from "../auth.controller";
import { AuthService } from "../service/auth.service";
import { AuthMapStore, AuthMapStoreToken } from "../service/auth_store.service";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule } from "@nestjs/jwt";
import supertest from "supertest";

describe("Auth эндпоинты", (): void => {
  let app: INestApplication;
  let registeredUuid: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: AuthMapStoreToken,
          useClass: AuthMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/registration", () => {
    it("успешная регистрация нового пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/auth/registration")
        .send({ username: "testuser", password: "pass123" })
        .expect(201);

      expect(res.body).toHaveProperty("tokens");
      expect(res.body).toHaveProperty("profile");
      expect(res.body.tokens).toHaveProperty("access_token");
      expect(res.body.tokens).toHaveProperty("refresh_token");
      expect(res.body.profile.username).toBe("testuser");
      expect(res.body.profile).toHaveProperty("uuid");
      expect(typeof res.body.profile.uuid).toBe("string");
      expect(res.body.profile.uuid.length).toBeGreaterThan(0);
      registeredUuid = res.body.profile.uuid;
    });

    it("ошибка при повторной регистрации", async () => {
      await supertest(app.getHttpServer())
        .post("/auth/registration")
        .send({ username: "testuser", password: "pass123" })
        .expect(401);
    });
  });

  describe("POST /auth/login", () => {
    it("успешный логин", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "testuser", password: "pass123" })
        .expect(201);

      expect(res.body).toHaveProperty("tokens");
      expect(res.body).toHaveProperty("profile");
      expect(res.body.profile.username).toBe("testuser");
      expect(res.body.profile.uuid).toBe(registeredUuid);
    });

    it("ошибка при неверном пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "testuser", password: "wrongpass" })
        .expect(401);
    });

    it("ошибка при несуществующем пользователе", async () => {
      await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "nonexistent", password: "pass123" })
        .expect(401);
    });
  });

  describe("POST /auth/refresh", () => {
    it("успешный рефреш токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "testuser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      const res = await supertest(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refresh_token })
        .expect(201);

      expect(res.body).toHaveProperty("tokens");
      expect(res.body).toHaveProperty("profile");
      expect(res.body.tokens.access_token).toBeTruthy();
      expect(res.body.tokens.refresh_token).not.toBe(refresh_token);
      expect(res.body.profile.uuid).toBe(registeredUuid);
    });

    it("ошибка при повторном использовании токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "testuser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      await supertest(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refresh_token })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refresh_token: "invalid-token" })
        .expect(401);
    });
  });

  describe("POST /auth/invalidate", () => {
    it("успешная инвалидация токена", async () => {
      const loginRes = await supertest(app.getHttpServer())
        .post("/auth/login")
        .send({ username: "testuser", password: "pass123" })
        .expect(201);

      const { refresh_token } = loginRes.body.tokens;

      await supertest(app.getHttpServer())
        .post("/auth/invalidate")
        .send({ refresh_token })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refresh_token })
        .expect(401);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/auth/invalidate")
        .send({ refresh_token: "invalid-token" })
        .expect(401);
    });
  });
});
