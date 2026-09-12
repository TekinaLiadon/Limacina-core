import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createHmac } from "node:crypto";
import { type INestApplication, ValidationPipe } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { YggdrasilController } from "../yggdrasil.controller";
import { YggdrasilService } from "../service/yggdrasil.service";
import {
  YggdrasilMapStore,
  YggdrasilStoreToken,
  YggdrasilTokenStoreToken,
  YggdrasilSessionStoreToken,
  type YggdrasilProfile,
  type YggdrasilSeedUser,
} from "../service/yggdrasil_store";
import { YggdrasilMapTokenStore, YggdrasilMapSessionStore } from "../../memory/yggdrasil-map.store";
import { MemoryModule } from "../../memory/memory.module";
import { MemoryDb } from "../../memory/memory-db";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../user-content/user-content.store";
import GlobalConfig from "../../config/global-config";
import { AppConfigToken } from "../../config/app-config.provider";
import { registerAuthRateLimit } from "../../common/auth-rate-limit";

const TEST_USERNAME = "testplayer";
const TEST_UUID = "a1b2c3d4e5f67890abcdef1234567890";
const TEST_USER_UUID = "11111111111111111111111111111111";
const TEST_PASSWORD = "pass123";
const ATTACKER_USERNAME = "attacker";
const ATTACKER_UUID = "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
const ATTACKER_USER_UUID = "22222222222222222222222222222222";
const BANNED_USERNAME = "bannedplayer";
const BANNED_USER_UUID = "33333333333333333333333333333333";
const BANNED_PROFILE_UUID = "e5f6a7b8c9d4e5f6a7b8c9d4e5f6a7b8";
const PENDING_USERNAME = "pendingplayer";
const PENDING_USER_UUID = "44444444444444444444444444444444";
const BIND_USERNAME = "profilebinder";
const BIND_USER_UUID = "55555555555555555555555555555555";
const BIND_PROFILE_UUID = "d4e5f6a7b8c9d4e5f6a7b8c9d4e5f6a7";
const BIND_SECOND_PROFILE_UUID = "f6a7b8c9d4e5f6a7b8c9d4e5f6a7b8c9";
const BIND_SECOND_PROFILE_NAME = "profilebinder2";
const SIGNOUT_LIMIT_USERNAME = "signoutlimiter";
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const buildPngBase64 = (body: string): string => {
  const bytes = new Uint8Array([...PNG_SIGNATURE, ...new Uint8Array(Buffer.from(body))]);
  return Buffer.from(bytes.buffer).toString("base64");
};

describe("Yggdrasil эндпоинты", () => {
  let app: INestApplication;
  let store: YggdrasilMapStore;
  let tokenStore: YggdrasilMapTokenStore;
  let contentStore: UserContentMapStore;
  let jwtAccessSecret: string;
  const uploadedTextures: string[] = [];

  beforeAll(async () => {
    const appConfig = GlobalConfig.parseEnvOrExit();
    jwtAccessSecret = appConfig.JWT_ACCESS;
    const passwordHash = await Bun.password.hash(TEST_PASSWORD);
    const seedUsers: YggdrasilSeedUser[] = [
      { username: TEST_USERNAME, uuid: TEST_USER_UUID, passwordHash },
      { username: ATTACKER_USERNAME, uuid: ATTACKER_USER_UUID, passwordHash },
      { username: BANNED_USERNAME, uuid: BANNED_USER_UUID, passwordHash, banned: true },
      { username: PENDING_USERNAME, uuid: PENDING_USER_UUID, passwordHash, approved: false },
      { username: BIND_USERNAME, uuid: BIND_USER_UUID, passwordHash },
    ];
    const seedProfiles: YggdrasilProfile[] = [
      { uuid: TEST_UUID, userId: TEST_USER_UUID, username: TEST_USERNAME },
      { uuid: ATTACKER_UUID, userId: ATTACKER_USER_UUID, username: ATTACKER_USERNAME },
      { uuid: BANNED_PROFILE_UUID, userId: BANNED_USER_UUID, username: BANNED_USERNAME },
      { uuid: BIND_PROFILE_UUID, userId: BIND_USER_UUID, username: BIND_USERNAME },
      {
        uuid: BIND_SECOND_PROFILE_UUID,
        userId: BIND_USER_UUID,
        username: BIND_SECOND_PROFILE_NAME,
      },
    ];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MemoryModule],
      controllers: [YggdrasilController],
      providers: [
        YggdrasilService,
        { provide: AppConfigToken, useFactory: () => appConfig },
        {
          provide: YggdrasilStoreToken,
          useFactory: () => new YggdrasilMapStore({ users: seedUsers, profiles: seedProfiles }),
        },
        {
          provide: YggdrasilTokenStoreToken,
          useFactory: (db: MemoryDb) => new YggdrasilMapTokenStore(db),
          inject: [MemoryDb],
        },
        {
          provide: YggdrasilSessionStoreToken,
          useFactory: (db: MemoryDb) => new YggdrasilMapSessionStore(db),
          inject: [MemoryDb],
        },
        {
          provide: UserContentMapStoreToken,
          useClass: UserContentMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter({ bodyLimit: 1024 * 1024 }));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const fastifyInstance = app.getHttpAdapter().getInstance() as FastifyInstance;
    await registerAuthRateLimit(fastifyInstance, { max: 10, timeWindow: 60000 });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    store = moduleFixture.get(YggdrasilStoreToken) as YggdrasilMapStore;
    tokenStore = moduleFixture.get(YggdrasilTokenStoreToken) as YggdrasilMapTokenStore;
    contentStore = moduleFixture.get(UserContentMapStoreToken) as UserContentMapStore;
  });

  afterAll(async () => {
    for (const texturePath of uploadedTextures) {
      if (existsSync(texturePath)) unlinkSync(texturePath);
    }
    await app.close();
  });

  // ─── GET / (metadata) ───

  describe("GET /", () => {
    it("возвращает API metadata", async () => {
      const res = await supertest(app.getHttpServer()).get("/").expect(200);

      expect(res.body).toHaveProperty("meta");
      expect(res.body).toHaveProperty("skinDomains");
      expect(res.body).toHaveProperty("signaturePublickey");
      expect(Array.isArray(res.body.skinDomains)).toBe(true);
    });

    it("meta содержит feature.non_email_login", async () => {
      const res = await supertest(app.getHttpServer()).get("/").expect(200);

      expect(res.body.meta["feature.non_email_login"]).toBe(true);
    });

    it("homepage берётся из BASE_URL, skinDomains вычисляются из хоста", async () => {
      const res = await supertest(app.getHttpServer()).get("/").expect(200);

      expect(res.body.meta.links.homepage).toBe("http://localhost:3005");
      expect(res.body.skinDomains).toEqual(["localhost"]);
    });
  });

  // ─── POST /authserver/authenticate ───

  describe("POST /authserver/authenticate", () => {
    it("успешная аутентификация", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("clientToken");
      expect(res.body).toHaveProperty("selectedProfile");
      expect(res.body.selectedProfile.id).toBe(TEST_UUID);
      expect(res.body.selectedProfile.name).toBe(TEST_USERNAME);
      expect(Array.isArray(res.body.availableProfiles)).toBe(true);
      expect(res.body.availableProfiles.length).toBe(1);
    });

    it("ошибка при неверном пароле", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: "wrong" })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
    });

    it("ошибка при несуществующем пользователе", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: "nonexistent", password: "pass" })
        .expect(403);
    });

    it("возвращает clientToken из запроса", async () => {
      const customToken = "my-custom-client-token";
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
          clientToken: customToken,
        })
        .expect(200);

      expect(res.body.clientToken).toBe(customToken);
    });

    it("генерирует clientToken если не передан", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      expect(typeof res.body.clientToken).toBe("string");
      expect(res.body.clientToken.length).toBeGreaterThan(0);
    });

    it("возвращает user если requestUser=true", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, requestUser: true })
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(TEST_USER_UUID);
    });

    it("не возвращает user если requestUser=false", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, requestUser: false })
        .expect(200);

      expect(res.body.user).toBeUndefined();
    });

    it("accessToken — непустая строка без дефисов", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      expect(typeof res.body.accessToken).toBe("string");
      expect(res.body.accessToken.length).toBe(32);
      expect(res.body.accessToken).not.toContain("-");
    });
  });

  // ─── POST /authserver/refresh ───

  describe("POST /authserver/refresh", () => {
    it("выдаёт новый токен и инвалидирует старый", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      const oldToken = authRes.body.accessToken;

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: oldToken })
        .expect(200);

      expect(refreshRes.body.accessToken).toBeTruthy();
      expect(refreshRes.body.accessToken).not.toBe(oldToken);
      expect(refreshRes.body.selectedProfile.id).toBe(TEST_UUID);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: oldToken })
        .expect(403);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: "invalid-token" })
        .expect(403);
    });

    it("ошибка при несовпадении clientToken", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "token-a" })
        .expect(200);

      await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: authRes.body.accessToken, clientToken: "token-b" })
        .expect(403);
    });

    it("возвращает user если requestUser=true", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: authRes.body.accessToken, requestUser: true })
        .expect(200);

      expect(refreshRes.body.user).toBeDefined();
    });

    it("selectedProfile: привязка профиля к токену", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: BIND_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({
          accessToken: authRes.body.accessToken,
          selectedProfile: {
            id: BIND_SECOND_PROFILE_UUID,
            name: BIND_SECOND_PROFILE_NAME,
            properties: [],
          },
        })
        .expect(200);

      expect(refreshRes.body.selectedProfile.id).toBe(BIND_SECOND_PROFILE_UUID);
    });
  });

  // ─── POST /authserver/validate ───

  describe("POST /authserver/validate", () => {
    it("возвращает 204 для валидного токена", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(204);
    });

    it("возвращает 403 для невалидного токена", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: "invalid-token" })
        .expect(403);
    });

    it("валидация с clientToken — успех", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "ct-1" })
        .expect(200);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: authRes.body.accessToken, clientToken: "ct-1" })
        .expect(204);
    });

    it("валидация с неверным clientToken — 403", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "ct-1" })
        .expect(200);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: authRes.body.accessToken, clientToken: "ct-wrong" })
        .expect(403);
    });
  });

  // ─── POST /authserver/invalidate ───

  describe("POST /authserver/invalidate", () => {
    it("инвалидирует токен", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      const token = authRes.body.accessToken;

      await supertest(app.getHttpServer())
        .post("/authserver/invalidate")
        .send({ accessToken: token })
        .expect(204);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: token })
        .expect(403);
    });

    it("идемпотентность — 204 для несуществующего токена", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/invalidate")
        .send({ accessToken: "nonexistent-token" })
        .expect(204);
    });

    it("ошибка при неверном clientToken — токен не удаляется", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "ct-inv-correct" })
        .expect(200);

      const token = authRes.body.accessToken;

      const res = await supertest(app.getHttpServer())
        .post("/authserver/invalidate")
        .send({ accessToken: token, clientToken: "ct-inv-wrong" })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
      expect(res.body.errorMessage).toBe("Invalid token.");

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: token })
        .expect(204);
    });

    it("инвалидация с верным clientToken удаляет токен", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "ct-inv-ok" })
        .expect(200);

      await supertest(app.getHttpServer())
        .post("/authserver/invalidate")
        .send({ accessToken: authRes.body.accessToken, clientToken: "ct-inv-ok" })
        .expect(204);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(403);
    });
  });

  // ─── POST /authserver/signout ───

  describe("POST /authserver/signout", () => {
    it("инвалидирует все токены пользователя", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(200);

      const token = authRes.body.accessToken;

      await supertest(app.getHttpServer())
        .post("/authserver/signout")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(204);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: token })
        .expect(403);
    });

    it("ошибка при неверном пароле", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/signout")
        .send({ username: TEST_USERNAME, password: "wrong" })
        .expect(403);
    });

    it("ошибка при несуществующем пользователе", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/signout")
        .send({ username: "ghost", password: "pass" })
        .expect(403);
    });
  });

  // ─── Session Server ───

  async function authenticateAndBindProfile(): Promise<string> {
    const authRes = await supertest(app.getHttpServer())
      .post("/authserver/authenticate")
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);

    const token = authRes.body.accessToken;
    if (authRes.body.selectedProfile) return token;

    const refreshRes = await supertest(app.getHttpServer())
      .post("/authserver/refresh")
      .send({
        accessToken: token,
        selectedProfile: { id: TEST_UUID, name: TEST_USERNAME, properties: [] },
      })
      .expect(200);

    return refreshRes.body.accessToken;
  }

  async function authenticateUser(username: string): Promise<string> {
    const authRes = await supertest(app.getHttpServer())
      .post("/authserver/authenticate")
      .send({ username, password: TEST_PASSWORD })
      .expect(200);

    return authRes.body.accessToken;
  }

  describe("POST /sessionserver/session/minecraft/join", () => {
    it("успешная запись сессии", async () => {
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: token,
          selectedProfile: TEST_UUID,
          serverId: "test-server-id",
        })
        .expect(204);
    });

    it("ошибка при невалидном токене", async () => {
      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: "invalid-token",
          selectedProfile: TEST_UUID,
          serverId: "test-server-id",
        })
        .expect(403);
    });

    it("ошибка если selectedProfile не совпадает с привязанным", async () => {
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: token,
          selectedProfile: "00000000000000000000000000000000",
          serverId: "wrong-profile-server",
        })
        .expect(403);
    });
  });

  describe("GET /sessionserver/session/minecraft/hasJoined", () => {
    it("возвращает профиль при валидной сессии", async () => {
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: token,
          selectedProfile: TEST_UUID,
          serverId: "verify-test-id",
        })
        .expect(204);

      const res = await supertest(app.getHttpServer())
        .get(
          `/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=verify-test-id`,
        )
        .expect(200);

      expect(res.body.id).toBe(TEST_UUID);
      expect(res.body.name).toBe(TEST_USERNAME);
    });

    it("возвращает 204 при отсутствии сессии", async () => {
      await supertest(app.getHttpServer())
        .get(
          `/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=nonexistent`,
        )
        .expect(204);
    });

    it("возвращает 204 если username не совпадает", async () => {
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: token,
          selectedProfile: TEST_UUID,
          serverId: "wrong-user-server",
        })
        .expect(204);

      await supertest(app.getHttpServer())
        .get(
          `/sessionserver/session/minecraft/hasJoined?username=wronguser&serverId=wrong-user-server`,
        )
        .expect(204);
    });

    it("возвращает свойства профиля (textures)", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "http://example.com/skin.png",
      });

      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: token,
          selectedProfile: TEST_UUID,
          serverId: "textures-test-server",
        })
        .expect(204);

      const res = await supertest(app.getHttpServer())
        .get(
          `/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=textures-test-server`,
        )
        .expect(200);

      expect(res.body.properties.length).toBeGreaterThan(0);
      const texProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      expect(texProp).toBeDefined();

      const decoded = JSON.parse(Buffer.from(texProp.value, "base64").toString());
      expect(decoded.textures.SKIN.url).toBe("http://example.com/skin.png");
    });
  });

  describe("GET /sessionserver/session/minecraft/profile/:uuid", () => {
    it("возвращает профиль существующего пользователя", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      expect(res.body.id).toBe(TEST_UUID);
      expect(res.body.name).toBe(TEST_USERNAME);
      expect(Array.isArray(res.body.properties)).toBe(true);
    });

    it("возвращает 204 для несуществующего UUID", async () => {
      await supertest(app.getHttpServer())
        .get("/sessionserver/session/minecraft/profile/00000000000000000000000000000000")
        .expect(204);
    });

    it("по умолчанию отдаёт текстуры без подписи (unsigned=true)", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const texProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      expect(texProp).toBeDefined();
      expect(texProp.signature).toBeUndefined();
    });

    it("unsigned=false добавляет подпись, если включено подписывание", async () => {
      const meta = await supertest(app.getHttpServer()).get("/").expect(200);
      const signingEnabled =
        typeof meta.body.signaturePublickey === "string" && meta.body.signaturePublickey.length > 0;

      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}?unsigned=false`)
        .expect(200);

      const texProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      expect(texProp).toBeDefined();
      if (signingEnabled) {
        expect(typeof texProp.signature).toBe("string");
        expect(texProp.signature.length).toBeGreaterThan(0);
      } else {
        expect(texProp.signature).toBeUndefined();
      }
    });

    it("некорректное значение unsigned отклоняется с 400", async () => {
      await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}?unsigned=maybe`)
        .expect(400);
    });

    it("корректно кодирует текстуры в base64", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "http://example.com/skin.png",
      });

      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const textureProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      expect(textureProp).toBeDefined();

      const decoded = JSON.parse(Buffer.from(textureProp.value, "base64").toString());
      expect(decoded).toHaveProperty("timestamp");
      expect(decoded.profileId).toBe(TEST_UUID);
      expect(decoded.profileName).toBe(TEST_USERNAME);
      expect(decoded.textures.SKIN.url).toBe("http://example.com/skin.png");
    });

    it("включает metadata.model для slim скина", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "http://example.com/skin.png",
        skinModel: "slim",
      });

      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const texProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      const decoded = JSON.parse(Buffer.from(texProp.value, "base64").toString());
      expect(decoded.textures.SKIN.metadata.model).toBe("slim");
    });

    it("uuid с дефисами нормализуется", async () => {
      const dashed = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${dashed}`)
        .expect(200);

      expect(res.body.id).toBe(TEST_UUID);
    });

    it("без skinUrl в профиле берёт активный скин из user_skins", async () => {
      const first = await contentStore.save(TEST_USER_UUID, "/textures/first.png", "skin");
      const second = await contentStore.save(TEST_USER_UUID, "/textures/second.png", "skin");

      await contentStore.updateActiveSkin(TEST_USER_UUID, first.id);

      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: null,
        skinModel: null,
      });

      const resActiveFirst = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const firstProp = resActiveFirst.body.properties.find(
        (p: { name: string }) => p.name === "textures",
      );
      const firstDecoded = JSON.parse(Buffer.from(firstProp.value, "base64").toString());
      expect(firstDecoded.textures.SKIN.url).toBe("/textures/first.png");

      await contentStore.updateActiveSkin(TEST_USER_UUID, second.id);

      const resActiveSecond = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const secondProp = resActiveSecond.body.properties.find(
        (p: { name: string }) => p.name === "textures",
      );
      const secondDecoded = JSON.parse(Buffer.from(secondProp.value, "base64").toString());
      expect(secondDecoded.textures.SKIN.url).toBe("/textures/second.png");

      await contentStore.deleteByIdAndCountRemaining(first.id, "skin");
      await contentStore.deleteByIdAndCountRemaining(second.id, "skin");
    });

    it("без skinUrl и без активного скина отдаёт дефолтный", async () => {
      const inactive = await contentStore.save(TEST_USER_UUID, "/textures/inactive.png", "skin");

      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: null,
        skinModel: null,
      });

      const res = await supertest(app.getHttpServer())
        .get(`/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      const texProp = res.body.properties.find((p: { name: string }) => p.name === "textures");
      const decoded = JSON.parse(Buffer.from(texProp.value, "base64").toString());
      expect(decoded.textures.SKIN.url).toContain("/textures/default.png");

      await contentStore.deleteByIdAndCountRemaining(inactive.id, "skin");
    });
  });

  // ─── API: Batch Profiles ───

  describe("POST /api/profiles/minecraft", () => {
    it("возвращает профили по именам", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([TEST_USERNAME, "nonexistent"])
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(TEST_UUID);
      expect(res.body[0].name).toBe(TEST_USERNAME);
    });

    it("возвращает пустой массив если никто не найден", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send(["nobody1", "nobody2"])
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it("возвращает пустой массив для пустого массива имён", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([])
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it("профили не содержат properties", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([TEST_USERNAME])
        .expect(200);

      expect(res.body[0].properties).toEqual([]);
    });
  });

  // ─── API: Texture Upload/Delete ───

  describe("PUT /api/user/profile/:uuid/skin", () => {
    it("возвращает 401 без Authorization заголовка", async () => {
      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .send({ file: buildPngBase64("fake-png-data") })
        .expect(401);
    });

    it("возвращает 403 если токен принадлежит другому профилю", async () => {
      const attackerToken = await authenticateUser(ATTACKER_USERNAME);

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${attackerToken}`)
        .send({ file: buildPngBase64("fake-png-data") })
        .expect(403);
    });

    it("загружает скин как base64", async () => {
      const token = await authenticateAndBindProfile();
      const base64 = buildPngBase64("fake-png-data");

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: base64, model: "slim" })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile).toBeDefined();
      expect(profile!.skinUrl).toContain(`/textures/${TEST_USERNAME}-`);
      expect(profile!.skinModel).toBe("slim");
      if (profile!.skinUrl) {
        uploadedTextures.push(profile!.skinUrl.replace(/^https?:\/\/[^/]+\//, "public/"));
      }
    });

    it("возвращает 403 для несуществующего профиля", async () => {
      const base64 = buildPngBase64("fake-png-data");

      await supertest(app.getHttpServer())
        .put("/api/user/profile/00000000000000000000000000000000/skin")
        .send({ file: base64 })
        .expect(403);
    });

    it("возвращает 400 для неизвестного textureType", async () => {
      const res = await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/hat`)
        .send({ file: buildPngBase64("fake-png-data") })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it("возвращает 413 для тела больше bodyLimit", async () => {
      const oversizedBase64 = Buffer.alloc(1024 * 1024, 0x61).toString("base64");

      const res = await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${await authenticateAndBindProfile()}`)
        .send({ file: oversizedBase64 });

      expect(res.status).toBe(413);
    });
  });

  describe("PUT /api/user/profile/:uuid/cape", () => {
    it("загружает кейп как base64", async () => {
      const token = await authenticateAndBindProfile();
      const base64 = buildPngBase64("fake-cape-data");

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/cape`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: base64 })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile).toBeDefined();
      expect(profile!.capeUrl).toContain(`/textures/${TEST_USERNAME}-`);
      if (profile!.capeUrl) {
        uploadedTextures.push(profile!.capeUrl.replace(/^https?:\/\/[^/]+\//, "public/"));
      }
    });
  });

  describe("DELETE /api/user/profile/:uuid/:textureType", () => {
    it("возвращает 401 без Authorization заголовка", async () => {
      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .expect(401);
    });

    it("удаляет скин", async () => {
      const token = await authenticateAndBindProfile();
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "/textures/old-skin.png",
        skinModel: "slim",
      });

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.skinUrl).toBeNull();
      expect(profile!.skinModel).toBeNull();
    });

    it("удаляет кейп", async () => {
      const token = await authenticateAndBindProfile();
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        capeUrl: "/textures/old-cape.png",
      });

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/cape`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.capeUrl).toBeNull();
    });

    it("возвращает 403 для несуществующего профиля", async () => {
      await supertest(app.getHttpServer())
        .delete("/api/user/profile/00000000000000000000000000000000/skin")
        .expect(403);
    });

    it("возвращает 400 для неизвестного textureType", async () => {
      const res = await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/hat`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ─── Жизненный цикл файлов текстур ───

  describe("Жизненный цикл файлов текстур", () => {
    const resetProfile = async (): Promise<void> => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: null,
        skinModel: null,
        capeUrl: null,
      });
    };

    const localPathOf = (url: string): string => url.replace(/^https?:\/\/[^/]+\//, "public/");

    const uploadSkinViaApi = async (token: string, body: string): Promise<string> => {
      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: buildPngBase64(body) })
        .expect(204);
      const profile = await store.findProfileByUuid(TEST_UUID);
      const url = profile!.skinUrl!;
      uploadedTextures.push(localPathOf(url));
      return url;
    };

    it("замена скина удаляет старый файл", async () => {
      await resetProfile();
      const token = await authenticateAndBindProfile();
      const firstUrl = await uploadSkinViaApi(token, "lifecycle-first");
      expect(existsSync(localPathOf(firstUrl))).toBe(true);

      const secondUrl = await uploadSkinViaApi(token, "lifecycle-second");

      expect(secondUrl).not.toBe(firstUrl);
      expect(existsSync(localPathOf(firstUrl))).toBe(false);
      expect(existsSync(localPathOf(secondUrl))).toBe(true);
    });

    it("удаление скина через API удаляет файл без ссылок", async () => {
      await resetProfile();
      const token = await authenticateAndBindProfile();
      const url = await uploadSkinViaApi(token, "lifecycle-delete");

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      expect(existsSync(localPathOf(url))).toBe(false);
    });

    it("повторная загрузка того же скина не удаляет файл", async () => {
      await resetProfile();
      const token = await authenticateAndBindProfile();
      const firstUrl = await uploadSkinViaApi(token, "lifecycle-same");
      const secondUrl = await uploadSkinViaApi(token, "lifecycle-same");

      expect(secondUrl).toBe(firstUrl);
      expect(existsSync(localPathOf(firstUrl))).toBe(true);
    });

    it("файл под ссылкой user_skins не удаляется", async () => {
      await resetProfile();
      const token = await authenticateAndBindProfile();
      const url = await uploadSkinViaApi(token, "lifecycle-shared");
      const skinRow = await contentStore.save(TEST_USER_UUID, url, "skin");

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      expect(existsSync(localPathOf(url))).toBe(true);

      await contentStore.deleteByIdAndCountRemaining(skinRow.id, "skin");
    });

    it("замена кейпа удаляет старый файл", async () => {
      await resetProfile();
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/cape`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: buildPngBase64("lifecycle-cape-first") })
        .expect(204);
      const firstUrl = (await store.findProfileByUuid(TEST_UUID))!.capeUrl!;
      uploadedTextures.push(localPathOf(firstUrl));

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/cape`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: buildPngBase64("lifecycle-cape-second") })
        .expect(204);
      const secondUrl = (await store.findProfileByUuid(TEST_UUID))!.capeUrl!;
      uploadedTextures.push(localPathOf(secondUrl));

      expect(existsSync(localPathOf(firstUrl))).toBe(false);
      expect(existsSync(localPathOf(secondUrl))).toBe(true);
    });

    it("дефолтный скин не удаляется", async () => {
      const defaultUrl = `${GlobalConfig.parseEnvOrExit().BASE_URL}/textures/default.png`;
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: defaultUrl,
      });
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      expect(existsSync("public/textures/default.png")).toBe(true);
    });

    it("внешний URL текстуры не трогается при удалении", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "http://example.com/external-skin.png",
      });
      const token = await authenticateAndBindProfile();

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.skinUrl).toBeNull();
    });
  });

  // ─── Формат ошибок ───

  describe("Формат ошибок", () => {
    it("ошибки содержат error и errorMessage", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: "nobody", password: "nope" })
        .expect(403);

      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("errorMessage");
      expect(typeof res.body.error).toBe("string");
      expect(typeof res.body.errorMessage).toBe("string");
    });

    it("ошибка Invalid token", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: "bad" })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
      expect(res.body.errorMessage).toBe("Invalid token.");
    });
  });

  // ─── Бан и approve (TASK-35) ───

  const seedUserToken = async (
    username: string,
    userId: string,
    profileId: string | null,
  ): Promise<string> => {
    const accessToken = crypto.randomUUID().replace(/-/g, "");
    await tokenStore.saveToken(accessToken, {
      profileId,
      username,
      clientToken: "ct-seeded",
      userId,
    });
    return accessToken;
  };

  const encodeAccessJwt = (payload: Record<string, unknown>): string => {
    const encode = (value: Record<string, unknown>): string =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "HS256", typ: "JWT" });
    const body = encode(payload);
    const signature = createHmac("sha256", jwtAccessSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  };

  describe("Бан и approve", () => {
    it("authenticate забаненного — 403 Invalid credentials", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: BANNED_USERNAME, password: TEST_PASSWORD })
        .expect(403);

      expect(res.body.errorMessage).toBe("Invalid credentials. Invalid username or password.");
    });

    it("authenticate неодобренного неотличим от неверного пароля", async () => {
      const pendingRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: PENDING_USERNAME, password: TEST_PASSWORD })
        .expect(403);

      const wrongPassRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: "wrong" })
        .expect(403);

      expect(pendingRes.body.error).toBe(wrongPassRes.body.error);
      expect(pendingRes.body.errorMessage).toBe(wrongPassRes.body.errorMessage);
    });

    it("refresh токеном забаненного — 403 Invalid token", async () => {
      const token = await seedUserToken(BANNED_USERNAME, BANNED_USER_UUID, BANNED_PROFILE_UUID);

      const res = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: token })
        .expect(403);

      expect(res.body.errorMessage).toBe("Invalid token.");
    });

    it("validate токеном забаненного — 403 Invalid token", async () => {
      const token = await seedUserToken(BANNED_USERNAME, BANNED_USER_UUID, BANNED_PROFILE_UUID);

      const res = await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: token })
        .expect(403);

      expect(res.body.errorMessage).toBe("Invalid token.");
    });

    it("join токеном забаненного — 403 Invalid token", async () => {
      const token = await seedUserToken(BANNED_USERNAME, BANNED_USER_UUID, BANNED_PROFILE_UUID);

      const res = await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({ accessToken: token, selectedProfile: BANNED_PROFILE_UUID, serverId: "banned-join" })
        .expect(403);

      expect(res.body.errorMessage).toBe("Invalid token.");
    });

    it("join JWT-веткой забаненного — 403 Invalid token", async () => {
      const jwt = encodeAccessJwt({
        sub: BANNED_USER_UUID,
        username: BANNED_USERNAME,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({
          accessToken: jwt,
          selectedProfile: BANNED_PROFILE_UUID,
          serverId: "banned-jwt-join",
        })
        .expect(403);

      expect(res.body.errorMessage).toBe("Invalid token.");
    });
  });

  // ─── Rate limit /authserver/signout (TASK-37) ───

  describe("Rate limit /authserver/signout", () => {
    it("11-я попытка signout по одному username — 429", async () => {
      for (let i = 0; i < 10; i++) {
        await supertest(app.getHttpServer())
          .post("/authserver/signout")
          .send({ username: SIGNOUT_LIMIT_USERNAME, password: "wrong" })
          .expect(403);
      }

      const res = await supertest(app.getHttpServer())
        .post("/authserver/signout")
        .send({ username: SIGNOUT_LIMIT_USERNAME, password: "wrong" })
        .expect(429);

      expect(res.body.message).toContain("Слишком много попыток");
    });

    it("authenticate лимитом не покрыт", async () => {
      for (let i = 0; i < 12; i++) {
        await supertest(app.getHttpServer())
          .post("/authserver/authenticate")
          .send({ username: SIGNOUT_LIMIT_USERNAME, password: "wrong" })
          .expect(403);
      }
    });
  });

  // ─── Валидация DTO: MaxLength (TASK-34) ───

  describe("Валидация DTO: MaxLength", () => {
    const long = (length: number): string => "a".repeat(length);

    it("authenticate: username длиннее 64 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: long(65), password: "pass" })
        .expect(400);
    });

    it("authenticate: clientToken длиннее 512 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: "pass", clientToken: long(513) })
        .expect(400);
    });

    it("refresh: accessToken длиннее 512 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: long(513) })
        .expect(400);
    });

    it("validate: accessToken длиннее 512 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: long(513) })
        .expect(400);
    });

    it("invalidate: accessToken длиннее 512 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/invalidate")
        .send({ accessToken: long(513) })
        .expect(400);
    });

    it("signout: username длиннее 64 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/authserver/signout")
        .send({ username: long(65), password: "pass" })
        .expect(400);
    });

    it("join: serverId длиннее 64 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({ accessToken: long(32), selectedProfile: TEST_UUID, serverId: long(65) })
        .expect(400);
    });

    it("join: selectedProfile длиннее 64 — 400", async () => {
      await supertest(app.getHttpServer())
        .post("/sessionserver/session/minecraft/join")
        .send({ accessToken: long(32), selectedProfile: long(65), serverId: "server" })
        .expect(400);
    });

    it("upload: model длиннее 16 — 400", async () => {
      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .send({ file: buildPngBase64("x"), model: long(17) })
        .expect(400);
    });

    it("upload: file длиннее 700000 — 400", async () => {
      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .send({ file: long(700001) })
        .expect(400);
    });
  });
});
