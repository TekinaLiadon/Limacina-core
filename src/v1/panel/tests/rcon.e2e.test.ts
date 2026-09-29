import { setupTestEnv } from "../../../utils/tests/test-env";
import { applyV1ApiPrefix } from "../../../utils/tests/v1-prefix";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import supertest from "supertest";
import { V1PanelRconController } from "../rcon.controller";
import {
  RCON_STATUS_CACHE_KEY,
  RconClientToken,
  RconService,
  createRconClient,
} from "../../../rcon/rcon.service";
import {
  RCON_AUTH,
  RCON_AUTH_RESPONSE,
  RCON_EXECCOMMAND,
  RCON_RESPONSE_VALUE,
} from "../../../rcon/source-rcon-client";
import {
  rconRespond,
  startFakeRconServer,
  type FakeRconServer,
  type RconHandler,
} from "../../../rcon/tests/fake-rcon-server";
import GlobalConfig from "../../../config/global-config";
import { AppConfigToken } from "../../../config/app-config.provider";
import { CacheStoreToken, type ICacheStore } from "../../../cache/cache_store";
import { CacheMapStore } from "../../../memory/cache_map_store";
import { MemoryDb } from "../../../memory/memory-db";
import { Jwt_authGuard } from "../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../common/roles.guard";

const PASSWORD = "test-rcon-password";
const UNKNOWN_COMMAND = "notacommand";

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

function echoHandler(password: string, received: string[]): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      const authBody = packet.body === password ? "" : "Wrong password";
      rconRespond(socket, RCON_AUTH_RESPONSE, authBody, packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND) {
      received.push(packet.body);
      const output =
        packet.body === UNKNOWN_COMMAND
          ? "Unknown or incomplete command, see /help"
          : `Сервер: ${packet.body}`;
      rconRespond(socket, RCON_RESPONSE_VALUE, output, packet.id);
      return;
    }
    if (packet.type === RCON_RESPONSE_VALUE) {
      rconRespond(socket, RCON_RESPONSE_VALUE, packet.body, packet.id);
    }
  };
}

async function createRconApp(): Promise<INestApplication> {
  const db = new MemoryDb();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      PassportModule,
      JwtModule.register({ secret: "test-access-secret", signOptions: { expiresIn: 31536000 } }),
    ],
    controllers: [V1PanelRconController],
    providers: [
      RconService,
      TestJwtStrategy,
      { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
      { provide: CacheStoreToken, useFactory: () => new CacheMapStore(db) },
      {
        provide: RconClientToken,
        useFactory: () => createRconClient(GlobalConfig.parseEnvOrExit()),
      },
    ],
  }).compile();

  const rconApp = moduleFixture.createNestApplication(new FastifyAdapter());
  rconApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const reflector = rconApp.get(Reflector);
  rconApp.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
  applyV1ApiPrefix(rconApp);
  await rconApp.init();
  await rconApp.getHttpAdapter().getInstance().ready();
  return rconApp;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("V1 panel/server/rcon — RCON-прокси игрового сервера", (): void => {
  let app: INestApplication;
  let wrongPasswordApp: INestApplication;
  let unconfiguredApp: INestApplication;
  let fakeServer: FakeRconServer;
  let jwtService: JwtService;
  let ownerToken: string;
  let adminToken: string;
  let userToken: string;
  let receivedCommands: string[];

  beforeAll(async () => {
    const saved: Record<string, string | undefined> = {
      RCON_HOST: process.env["RCON_HOST"],
      RCON_PORT: process.env["RCON_PORT"],
      RCON_PASSWORD: process.env["RCON_PASSWORD"],
    };

    receivedCommands = [];
    fakeServer = await startFakeRconServer(echoHandler(PASSWORD, receivedCommands));

    try {
      process.env["RCON_HOST"] = "127.0.0.1";
      process.env["RCON_PORT"] = String(fakeServer.port);
      process.env["RCON_PASSWORD"] = PASSWORD;
      app = await createRconApp();

      process.env["RCON_PASSWORD"] = "wrong-password";
      wrongPasswordApp = await createRconApp();

      delete process.env["RCON_HOST"];
      delete process.env["RCON_PASSWORD"];
      unconfiguredApp = await createRconApp();
    } finally {
      restoreEnv(saved);
    }

    jwtService = app.get(JwtService);
    ownerToken = jwtService.sign({
      typ: "access",
      sub: "owner-uuid",
      username: "owner",
      role: "owner",
    });
    adminToken = jwtService.sign({
      typ: "access",
      sub: "admin-uuid",
      username: "admin",
      role: "admin",
    });
    userToken = jwtService.sign({
      typ: "access",
      sub: "user-uuid",
      username: "user",
      role: "user",
    });
  });

  afterAll(async () => {
    await app?.close();
    await wrongPasswordApp?.close();
    await unconfiguredApp?.close();
    await fakeServer?.close();
  });

  describe("GET /v1/panel/server/rcon", () => {
    it("401 без токена", async () => {
      await supertest(app.getHttpServer()).get("/v1/panel/server/rcon").expect(401);
    });

    it("403 для администратора", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });

    it("403 для обычного пользователя", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);
    });

    it("200 и enabled:true для owner — реальный коннект и авторизация", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.enabled).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    });

    it("повторный запрос отдаётся из кеша без нового соединения", async () => {
      const cache = app.get<ICacheStore>(CacheStoreToken, { strict: false });
      await cache.delete(RCON_STATUS_CACHE_KEY);
      await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      const connectionsBefore = fakeServer.connections();
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.enabled).toBe(true);
      expect(fakeServer.connections()).toBe(connectionsBefore);
    });

    it("после инвалидации кеша статус проверяется снова", async () => {
      const cache = app.get<ICacheStore>(CacheStoreToken, { strict: false });
      await cache.delete(RCON_STATUS_CACHE_KEY);
      const connectionsBefore = fakeServer.connections();

      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.enabled).toBe(true);
      expect(fakeServer.connections()).toBeGreaterThan(connectionsBefore);
    });

    it("enabled:false при неверном пароле RCON", async () => {
      const res = await supertest(wrongPasswordApp.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.enabled).toBe(false);
    });

    it("enabled:false когда RCON не настроен", async () => {
      const res = await supertest(unconfiguredApp.getHttpServer())
        .get("/v1/panel/server/rcon")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.enabled).toBe(false);
    });
  });

  describe("GET /v1/panel/server/rcon/commands", () => {
    it("200 и статический список команд", async () => {
      const res = await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon/commands")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);

      expect(Array.isArray(res.body.commands)).toBe(true);
      expect(res.body.commands).toContain("say");
      expect(res.body.commands).toContain("stop");
    });

    it("403 для администратора", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/panel/server/rcon/commands")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe("POST /v1/panel/server/rcon/execute", () => {
    it("200 и вывод команды для owner", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "say Hello world" })
        .expect(200);

      expect(res.body.output).toBe("Сервер: say Hello world");
      expect(receivedCommands).toContain("say Hello world");
    });

    it("команда триммится и уходит без ведущего слеша", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "  /say Slashed  " })
        .expect(200);

      expect(receivedCommands).toContain("say Slashed");
    });

    it("текст ошибки Minecraft возвращается в output, а не 5xx", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: UNKNOWN_COMMAND })
        .expect(200);

      expect(res.body.output).toContain("Unknown or incomplete command");
    });

    it("400 для пустой команды", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "" })
        .expect(400);
    });

    it("400 для команды из одних слешей", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "//" })
        .expect(400);
    });

    it("400 при отсутствии поля command", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({})
        .expect(400);
    });

    it("400 при слишком длинной команде", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "a".repeat(300) })
        .expect(400);
    });

    it("401 без токена и 403 для администратора", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .send({ command: "say hi" })
        .expect(401);

      await supertest(app.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ command: "say hi" })
        .expect(403);
    });

    it("503 при неверном пароле RCON — сообщение не раскрывает пароль", async () => {
      const res = await supertest(wrongPasswordApp.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "say hi" })
        .expect(503);

      expect(res.body.message).toContain("пароль");
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    });

    it("503 когда RCON не настроен", async () => {
      const res = await supertest(unconfiguredApp.getHttpServer())
        .post("/v1/panel/server/rcon/execute")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ command: "say hi" })
        .expect(503);

      expect(res.body.message).toContain("RCON не настроен");
    });
  });
});
