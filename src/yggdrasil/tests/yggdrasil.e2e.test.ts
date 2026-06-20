import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { YggdrasilController } from "../yggdrasil.controller";
import { YggdrasilService } from "../service/yggdrasil.service";
import {
  YggdrasilMapStore,
  YggdrasilMapTokenStore,
  YggdrasilMapSessionStore,
  YggdrasilStoreToken,
  YggdrasilTokenStoreToken,
  YggdrasilSessionStoreToken,
} from "../service/yggdrasil_store";

const TEST_USERNAME = "testplayer";
const TEST_UUID = "a1b2c3d4e5f67890abcdef1234567890";
const TEST_USER_UUID = "11111111111111111111111111111111";
const TEST_PASSWORD = "pass123";

describe("Yggdrasil эндпоинты", () => {
  let app: INestApplication;
  let store: YggdrasilMapStore;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [YggdrasilController],
      providers: [
        YggdrasilService,
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
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    store = moduleFixture.get(YggdrasilStoreToken) as YggdrasilMapStore;
    const passwordHash = await Bun.password.hash(TEST_PASSWORD);
    await store.__test__addUser(TEST_USERNAME, TEST_USER_UUID, passwordHash);
    await store.saveProfile({ uuid: TEST_UUID, userId: TEST_USER_UUID, username: TEST_USERNAME });
  });

  afterAll(async () => {
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
  });

  // ─── POST /authserver/authenticate ───

  describe("POST /authserver/authenticate", () => {
    it("успешная аутентификация", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

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
        .expect(201);

      expect(res.body.clientToken).toBe(customToken);
    });

    it("генерирует clientToken если не передан", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      expect(typeof res.body.clientToken).toBe("string");
      expect(res.body.clientToken.length).toBeGreaterThan(0);
    });

    it("возвращает user если requestUser=true", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, requestUser: true })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(TEST_USER_UUID);
    });

    it("не возвращает user если requestUser=false", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, requestUser: false })
        .expect(201);

      expect(res.body.user).toBeUndefined();
    });

    it("accessToken — непустая строка без дефисов", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

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
        .expect(201);

      const oldToken = authRes.body.accessToken;

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: oldToken })
        .expect(201);

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
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: authRes.body.accessToken, clientToken: "token-b" })
        .expect(403);
    });

    it("возвращает user если requestUser=true", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({ accessToken: authRes.body.accessToken, requestUser: true })
        .expect(201);

      expect(refreshRes.body.user).toBeDefined();
    });

    it("selectedProfile: привязка профиля к токену", async () => {
      const secondProfileUuid = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5";
      await store.saveProfile({
        uuid: secondProfileUuid,
        userId: TEST_USER_UUID,
        username: "testplayer2",
      });

      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

      const refreshRes = await supertest(app.getHttpServer())
        .post("/authserver/refresh")
        .send({
          accessToken: authRes.body.accessToken,
          selectedProfile: { id: secondProfileUuid, name: "testplayer2", properties: [] },
        })
        .expect(201);

      expect(refreshRes.body.selectedProfile.id).toBe(secondProfileUuid);
    });
  });

  // ─── POST /authserver/validate ───

  describe("POST /authserver/validate", () => {
    it("возвращает 204 для валидного токена", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

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
        .expect(201);

      await supertest(app.getHttpServer())
        .post("/authserver/validate")
        .send({ accessToken: authRes.body.accessToken, clientToken: "ct-1" })
        .expect(204);
    });

    it("валидация с неверным clientToken — 403", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD, clientToken: "ct-1" })
        .expect(201);

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
        .expect(201);

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
  });

  // ─── POST /authserver/signout ───

  describe("POST /authserver/signout", () => {
    it("инвалидирует все токены пользователя", async () => {
      const authRes = await supertest(app.getHttpServer())
        .post("/authserver/authenticate")
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .expect(201);

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
      .expect(201);

    const token = authRes.body.accessToken;
    if (authRes.body.selectedProfile) return token;

    const refreshRes = await supertest(app.getHttpServer())
      .post("/authserver/refresh")
      .send({
        accessToken: token,
        selectedProfile: { id: TEST_UUID, name: TEST_USERNAME, properties: [] },
      })
      .expect(201);

    return refreshRes.body.accessToken;
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

    it("возвращает 404 при отсутствии сессии", async () => {
      await supertest(app.getHttpServer())
        .get(
          `/sessionserver/session/minecraft/hasJoined?username=${TEST_USERNAME}&serverId=nonexistent`,
        )
        .expect(404);
    });

    it("возвращает 404 если username не совпадает", async () => {
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
        .expect(404);
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

    it("возвращает 404 для несуществующего UUID", async () => {
      await supertest(app.getHttpServer())
        .get("/sessionserver/session/minecraft/profile/00000000000000000000000000000000")
        .expect(404);
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
  });

  // ─── API: Batch Profiles ───

  describe("POST /api/profiles/minecraft", () => {
    it("возвращает профили по именам", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([TEST_USERNAME, "nonexistent"])
        .expect(201);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(TEST_UUID);
      expect(res.body[0].name).toBe(TEST_USERNAME);
    });

    it("возвращает пустой массив если никто не найден", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send(["nobody1", "nobody2"])
        .expect(201);

      expect(res.body).toEqual([]);
    });

    it("возвращает пустой массив для пустого массива имён", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([])
        .expect(201);

      expect(res.body).toEqual([]);
    });

    it("профили не содержат properties", async () => {
      const res = await supertest(app.getHttpServer())
        .post("/api/profiles/minecraft")
        .send([TEST_USERNAME])
        .expect(201);

      expect(res.body[0].properties).toEqual([]);
    });
  });

  // ─── API: Texture Upload/Delete ───

  describe("PUT /api/user/profile/:uuid/skin", () => {
    it("загружает скин как base64", async () => {
      const fakePng = Buffer.from("fake-png-data");
      const base64 = fakePng.toString("base64");

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/skin`)
        .send({ file: base64, model: "slim" })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile).toBeDefined();
      expect(profile!.skinUrl).toContain("/textures/");
      expect(profile!.skinModel).toBe("slim");
    });

    it("возвращает 403 для несуществующего профиля", async () => {
      const fakePng = Buffer.from("fake-png-data");
      const base64 = fakePng.toString("base64");

      await supertest(app.getHttpServer())
        .put("/api/user/profile/00000000000000000000000000000000/skin")
        .send({ file: base64 })
        .expect(403);
    });
  });

  describe("PUT /api/user/profile/:uuid/cape", () => {
    it("загружает кейп как base64", async () => {
      const fakePng = Buffer.from("fake-cape-data");
      const base64 = fakePng.toString("base64");

      await supertest(app.getHttpServer())
        .put(`/api/user/profile/${TEST_UUID}/cape`)
        .send({ file: base64 })
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile).toBeDefined();
      expect(profile!.capeUrl).toContain("/textures/");
    });
  });

  describe("DELETE /api/user/profile/:uuid/:textureType", () => {
    it("удаляет скин", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        skinUrl: "/textures/old-skin.png",
        skinModel: "slim",
      });

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/skin`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.skinUrl).toBeNull();
      expect(profile!.skinModel).toBeNull();
    });

    it("удаляет кейп", async () => {
      await store.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_USER_UUID,
        username: TEST_USERNAME,
        capeUrl: "/textures/old-cape.png",
      });

      await supertest(app.getHttpServer())
        .delete(`/api/user/profile/${TEST_UUID}/cape`)
        .expect(204);

      const profile = await store.findProfileByUuid(TEST_UUID);
      expect(profile!.capeUrl).toBeNull();
    });

    it("возвращает 403 для несуществующего профиля", async () => {
      await supertest(app.getHttpServer())
        .delete("/api/user/profile/00000000000000000000000000000000/skin")
        .expect(403);
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
});
