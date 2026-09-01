process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createHmac } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1YggdrasilController } from "../yggdrasil.controller";
import { YggdrasilService } from "../../../yggdrasil/service/yggdrasil.service";
import {
  YggdrasilMapStore,
  YggdrasilMapTokenStore,
  YggdrasilMapSessionStore,
  YggdrasilStoreToken,
  YggdrasilTokenStoreToken,
  YggdrasilSessionStoreToken,
} from "../../../yggdrasil/service/yggdrasil_store";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../../user-content/user-content.store";
import GlobalConfig from "../../../config/global-config";
import { AppConfigToken } from "../../../config/app-config.provider";

const TEST_USERNAME = "v1player";
const TEST_UUID = "a1b2c3d4e5f67890abcdef1234567890";
const TEST_USER_UUID = "11111111111111111111111111111111";
const TEST_PASSWORD = "pass123";
const ATTACKER_USERNAME = "v1attacker";
const ATTACKER_UUID = "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
const ATTACKER_USER_UUID = "22222222222222222222222222222222";
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const buildPngBase64 = (body: string): string => {
  const bytes = new Uint8Array([...PNG_SIGNATURE, ...new Uint8Array(Buffer.from(body))]);
  return Buffer.from(bytes.buffer).toString("base64");
};
const buildJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "test-access-secret")
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
};

describe("V1 Yggdrasil эндпоинты", (): void => {
  let app: INestApplication;
  let store: YggdrasilMapStore;
  const uploadedTextures: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [V1YggdrasilController],
      providers: [
        YggdrasilService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        {
          provide: YggdrasilStoreToken,
          useClass: YggdrasilMapStore,
        },
        {
          provide: YggdrasilTokenStoreToken,
          useClass: YggdrasilMapTokenStore,
        },
        {
          provide: YggdrasilSessionStoreToken,
          useClass: YggdrasilMapSessionStore,
        },
        {
          provide: UserContentMapStoreToken,
          useClass: UserContentMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    store = moduleFixture.get(YggdrasilStoreToken) as YggdrasilMapStore;
    const passwordHash = await Bun.password.hash(TEST_PASSWORD);
    await store.__test__addUser(TEST_USERNAME, TEST_USER_UUID, passwordHash);
    await store.saveProfile({ uuid: TEST_UUID, userId: TEST_USER_UUID, username: TEST_USERNAME });
    await store.__test__addUser(ATTACKER_USERNAME, ATTACKER_USER_UUID, passwordHash);
    await store.saveProfile({
      uuid: ATTACKER_UUID,
      userId: ATTACKER_USER_UUID,
      username: ATTACKER_USERNAME,
    });
  });

  async function authenticateUser(username: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post("/v1/authserver/authenticate")
      .send({ username, password: TEST_PASSWORD })
      .expect(201);
    return res.body.accessToken as string;
  }

  afterAll(async () => {
    for (const texturePath of uploadedTextures) {
      if (existsSync(texturePath)) unlinkSync(texturePath);
    }
    await app.close();
  });

  describe("GET /v1 (metadata)", () => {
    it("возвращает API metadata", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1").expect(200);

      expect(res.body).toHaveProperty("meta");
      expect(res.body).toHaveProperty("skinDomains");
      expect(Array.isArray(res.body.skinDomains)).toBe(true);
    });
  });

  describe("POST /v1/authserver/authenticate", () => {
    it("успешная аутентификация", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("clientToken");
      expect(res.body.selectedProfile.id).toBe(TEST_UUID);
      expect(res.body.selectedProfile.name).toBe(TEST_USERNAME);
    });

    it("ошибка при неверном пароле", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: "wrong" })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
    });
  });

  describe("POST /v1/authserver/refresh", () => {
    it("выдаёт новый токен", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .post("/v1/authserver/refresh")
        .send({ accessToken: authRes.body.accessToken })
        .expect(201);

      expect(res.body.accessToken).not.toBe(authRes.body.accessToken);
      expect(res.body.selectedProfile.id).toBe(TEST_UUID);
    });
  });

  describe("POST /v1/authserver/validate", () => {
    it("возвращает 204 для валидного токена", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/authserver/validate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(204);
    });

    it("возвращает 403 для невалидного токена", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/authserver/validate")
        .send({ accessToken: "invalid-token" })
        .expect(403);
    });
  });

  describe("POST /v1/authserver/invalidate", () => {
    it("инвалидирует токен", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/authserver/invalidate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(204);

      await supertest(app.getHttpServer())
        .post("/v1/authserver/validate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(403);
    });
  });

  describe("POST /v1/authserver/signout", () => {
    it("инвалидирует все токены пользователя", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/authserver/signout")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(204);

      await supertest(app.getHttpServer())
        .post("/v1/authserver/validate")
        .send({ accessToken: authRes.body.accessToken })
        .expect(403);
    });
  });

  describe("POST /v1/sessionserver/session/minecraft/join", () => {
    it("успешная запись сессии", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/v1/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/v1/sessionserver/session/minecraft/join")
        .send({
          accessToken: authRes.body.accessToken,
          selectedProfile: TEST_UUID,
          serverId: "v1-test-server-id",
        })
        .expect(204);
    });
  });

  describe("GET /v1/sessionserver/session/minecraft/hasJoined", () => {
    it("возвращает профиль при валидной сессии", async () => {
      const res = await supertest(app.getHttpServer())
        .get(
          `/v1/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=v1-test-server-id`,
        )
        .expect(200);

      expect(res.body.id).toBe(TEST_UUID);
      expect(res.body.name).toBe(TEST_USERNAME);
    });

    it("возвращает 404 при отсутствии сессии", async () => {
      await supertest(app.getHttpServer())
        .get(
          `/v1/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=nonexistent`,
        )
        .expect(404);
    });
  });

  describe("GET /v1/sessionserver/session/minecraft/profile/:uuid", () => {
    it("возвращает профиль", async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/v1/sessionserver/session/minecraft/profile/${TEST_UUID}`)
        .expect(200);

      expect(res.body.id).toBe(TEST_UUID);
      expect(res.body.name).toBe(TEST_USERNAME);
    });

    it("возвращает 404 для несуществующего UUID", async () => {
      await supertest(app.getHttpServer())
        .get("/v1/sessionserver/session/minecraft/profile/00000000000000000000000000000000")
        .expect(404);
    });
  });

  describe("POST /v1/api/profiles/minecraft", () => {
    it("возвращает профили по именам", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/api/profiles/minecraft")
        .send([TEST_USERNAME, "nonexistent"])
        .expect(201);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(TEST_UUID);
    });
  });

  describe("PUT /v1/api/user/profile/:uuid/:textureType", () => {
    it("возвращает 401 без Authorization заголовка", async () => {
      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .send({ file: buildPngBase64("fake-png-data-v1") })
        .expect(401);
    });

    it("возвращает 401 с невалидным токеном", async () => {
      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", "Bearer invalid-token")
        .send({ file: buildPngBase64("fake-png-data-v1") })
        .expect(401);
    });

    it("возвращает 403 если токен принадлежит другому профилю", async () => {
      const attackerToken = await authenticateUser(ATTACKER_USERNAME);

      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${attackerToken}`)
        .send({ file: buildPngBase64("fake-png-data-v1") })
        .expect(403);
    });

    it("загружает скин как base64 с токеном владельца", async () => {
      const token = await authenticateUser(TEST_USERNAME);
      const base64 = buildPngBase64("fake-png-data-v1");

      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: base64, model: "slim" })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile).toBeDefined();
      expect(profile!.skinUrl).toContain("/textures/");
      expect(profile!.skinModel).toBe("slim");
      if (profile!.skinUrl) {
        uploadedTextures.push(profile!.skinUrl.replace(/^https?:\/\/[^/]+\//, "public/"));
      }
    });

    it("загружает скин по JWT владельца", async () => {
      const jwt = buildJwt({
        sub: TEST_USER_UUID,
        username: TEST_USERNAME,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${jwt}`)
        .send({ file: buildPngBase64("jwt-owner-skin-data") })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.skinUrl).toContain("/textures/");
      if (profile!.skinUrl) {
        uploadedTextures.push(profile!.skinUrl.replace(/^https?:\/\/[^/]+\//, "public/"));
      }
    });

    it("возвращает 403 если JWT принадлежит другому пользователю", async () => {
      const jwt = buildJwt({
        sub: ATTACKER_USER_UUID,
        username: ATTACKER_USERNAME,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${jwt}`)
        .send({ file: buildPngBase64("jwt-attacker-skin-data") })
        .expect(403);
    });

    it("возвращает 403 если файл не является PNG", async () => {
      const token = await authenticateUser(TEST_USERNAME);
      const res = await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: Buffer.from("not-a-png-at-all").toString("base64") })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
    });

    it("возвращает 403 если файл превышает лимит размера", async () => {
      const token = await authenticateUser(TEST_USERNAME);
      const oversize = new Uint8Array(512 * 1024 + 1);
      oversize.set(PNG_SIGNATURE);
      const res = await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ file: Buffer.from(oversize.buffer).toString("base64") })
        .expect(403);

      expect(res.body.error).toBe("ForbiddenOperationException");
    });
    it("возвращает 400 для неизвестного textureType (PUT)", async () => {
      const res = await supertest(app.getHttpServer())
        .put(`/v1/api/user/profile/${TEST_UUID}/hat`)
        .send({ file: buildPngBase64("fake-png-data-v1") })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it("возвращает 400 для неизвестного textureType (DELETE)", async () => {
      await supertest(app.getHttpServer())
        .delete(`/v1/api/user/profile/${TEST_UUID}/hat`)
        .expect(400);
    });
  });

  describe("DELETE /v1/api/user/profile/:uuid/:textureType", () => {
    it("возвращает 401 без Authorization заголовка", async () => {
      await supertest(app.getHttpServer())
        .delete(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .expect(401);
    });

    it("удаляет скин с токеном владельца", async () => {
      const token = await authenticateUser(TEST_USERNAME);

      await supertest(app.getHttpServer())
        .delete(`/v1/api/user/profile/${TEST_UUID}/skin`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.skinUrl).toBeNull();
    });
  });
});
