process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TechnicalController } from "../technical.controller";
import { TechnicalService } from "../technical.service";
import { AdminMapStore, AdminMapStoreToken } from "../../admin/admin.store";
import { AuthMapStore, AuthMapStoreToken } from "../../auth/service/auth_store.service";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable } from "@nestjs/common";
import { Jwt_authGuard } from "../../common/jwt_auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Reflector } from "@nestjs/core";
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

describe("Technical эндпоинты", (): void => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [TechnicalController],
      providers: [
        TechnicalService,
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

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /technical/init-owner", () => {
    it("создаёт владельца", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/technical/init-owner")
        .send({ username: "owner", password: "securepassword" })
        .expect(201);

      expect(res.body.username).toBe("owner");
      expect(res.body.uuid).toBeDefined();
    });

    it("возвращает 409 если владелец уже создан", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/technical/init-owner")
        .send({ username: "owner2", password: "securepassword" })
        .expect(409);

      expect(res.body.message).toContain("Владелец уже создан");
    });

    it("возвращает 409 если юзернейм занят", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/technical/init-owner")
        .send({ username: "owner", password: "anotherpassword" })
        .expect(409);

      expect(res.body.message).toBeDefined();
    });

    it("возвращает 400 при отсутствии обязательных полей", async () => {
      await supertest(app.getHttpServer())
        .post("/technical/init-owner")
        .send({ username: "only_name" })
        .expect(400);
    });

    it("возвращает 400 при коротком пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/technical/init-owner")
        .send({ username: "test", password: "123" })
        .expect(400);
    });
  });
});
