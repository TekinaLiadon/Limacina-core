import { setupTestEnv } from "../../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import fastifyMultipart from "@fastify/multipart";
import supertest from "supertest";
import { V1ContentController } from "../content.controller";
import { UserContentService } from "../../../../user-content/user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../../../user-content/user-content.store";
import {
  YggdrasilMapStore,
  YggdrasilStoreToken,
} from "../../../../yggdrasil/service/yggdrasil_store";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";

const TEST_UUID = "v1user-uuid-0001";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const pngBuffer = (extraBytes = 16): Buffer => {
  const buffer = Buffer.alloc(PNG_SIGNATURE.length + extraBytes);
  buffer.set(PNG_SIGNATURE);
  return buffer;
};

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

describe("V1 common/content эндпоинты", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let userToken: string;
  let otherUserToken: string;
  let uploadedSkinId: number;
  const uploadedFiles: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [V1ContentController],
      providers: [
        UserContentService,
        {
          provide: AppConfigToken,
          useFactory: () =>
            GlobalConfig.parseEnvOrExit({ ...process.env, MAX_SKINS_PER_USER: "5" }),
        },
        TestJwtStrategy,
        {
          provide: UserContentMapStoreToken,
          useClass: UserContentMapStore,
        },
        {
          provide: YggdrasilStoreToken,
          useFactory: () => new YggdrasilMapStore(),
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

    userToken = jwtService.sign({ sub: TEST_UUID, username: "v1user", role: "user" });
    otherUserToken = jwtService.sign({ sub: "other-uuid-0002", username: "other", role: "user" });

    const uploadRes = await supertest(app.getHttpServer())
      .post("/v1/common/content/skins")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", pngBuffer(), "skin.png")
      .expect(201);
    uploadedSkinId = uploadRes.body.id;
    trackUploadedFile(uploadRes.body.url);
  });

  afterAll(async () => {
    for (const filePath of uploadedFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
    await app.close();
  });

  const trackUploadedFile = (url: string): void => {
    const filePath = url.replace(/^https?:\/\/[^/]+\//, "public/");
    uploadedFiles.push(filePath);
  };

  const uploadOwnSkin = async (): Promise<{ id: number; url: string }> => {
    const res = await supertest(app.getHttpServer())
      .post("/v1/common/content/skins")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", pngBuffer(110), "skin.png")
      .expect(201);
    trackUploadedFile(res.body.url);
    return { id: res.body.id, url: res.body.url };
  };

  const deleteUserSkin = async (): Promise<void> => {
    const store = app.get(UserContentMapStoreToken);
    const items = await store.findByUserUuid(TEST_UUID, "skin");
    for (const item of items) {
      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${item.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    }
  };

  describe("POST /v1/common/content/skins", () => {
    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).post("/v1/common/content/skins").expect(401);
    });

    it("возвращает 400 если файл не загружен", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .field("dummy", "no-file")
        .expect(400);
    });

    it("возвращает 400 если файл не является PNG", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", Buffer.from("not-a-png"), "skin.png")
        .expect(400);
    });

    it("возвращает 400 при превышении лимита размера скина", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(512 * 1024), "skin.png")
        .expect(400);
    });

    it("одинаковый скин разных пользователей пишет разные файлы", async () => {
      const bytes = pngBuffer(210);
      const firstRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", bytes, "skin.png")
        .expect(201);
      trackUploadedFile(firstRes.body.url);

      const secondRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${otherUserToken}`)
        .attach("file", bytes, "skin.png")
        .expect(201);
      trackUploadedFile(secondRes.body.url);

      const firstUrl: string = firstRes.body.url;
      const secondUrl: string = secondRes.body.url;
      expect(firstUrl).toContain("/textures/v1user-");
      expect(secondUrl).toContain("/textures/other-");
      expect(firstUrl).not.toBe(secondUrl);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${firstRes.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${secondRes.body.id}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(200);

      expect(existsSync(firstUrl.replace(/^https?:\/\/[^/]+\//, "public/"))).toBe(false);
      expect(existsSync(secondUrl.replace(/^https?:\/\/[^/]+\//, "public/"))).toBe(false);
    });
  });

  describe("GET /v1/common/content/skins/:uuid", () => {
    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer()).get(`/v1/common/content/skins/${TEST_UUID}`).expect(401);
    });

    it("возвращает список скинов пользователя", async () => {
      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.length).toBeGreaterThan(0);
      for (const item of listRes.body) {
        expect(typeof item.active).toBe("boolean");
      }
    });

    it("отдаёт дефолтный скин с active=true, когда своих скинов нет", async () => {
      const store = app.get(UserContentMapStoreToken);
      const ownSkins = await store.findByUserUuid(TEST_UUID, "skin");
      for (const skin of ownSkins) {
        await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${skin.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(200);
      }

      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(listRes.body).toEqual([
        { id: null, url: "http://localhost:3005/textures/default.png", model: null, active: true },
      ]);
    });

    it("при удалении активного скина активным становится последний оставшийся", async () => {
      const first = await uploadOwnSkin();
      const second = await uploadOwnSkin();
      const third = await uploadOwnSkin();

      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: third.id })
        .expect(200);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${third.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      const store = app.get(UserContentMapStoreToken);
      const remaining = await store.findByUserUuid(TEST_UUID, "skin");
      const activeItems = remaining.filter((s: { active: boolean }) => s.active);
      expect(activeItems.length).toBe(1);
      expect(activeItems[0]?.id).toBe(second.id);

      for (const skin of [first, second]) {
        await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${skin.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(200);
      }
    });

    it("возвращает model каждого скина (slim/classic/null)", async () => {
      const store = app.get(UserContentMapStoreToken);
      for (const skin of await store.findByUserUuid(TEST_UUID, "skin")) {
        await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${skin.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(200);
      }

      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins?model=slim")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(40), "skin.png")
        .expect(201);
      trackUploadedFile(uploadRes.body.url);

      const skins = await store.findByUserUuid(TEST_UUID, "skin");
      const expectedModels = new Map(
        skins.map((s: { id: number; skinModel?: string | null }) => [s.id, s.skinModel ?? null]),
      );

      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(listRes.body.length).toBe(expectedModels.size);
      for (const item of listRes.body) {
        expect(expectedModels.get(item.id)).toBe(item.model ?? null);
        if (item.id === uploadRes.body.id) {
          expect(item.model).toBe("slim");
        }
      }

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadRes.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe("DELETE /v1/common/content/skins/:id", () => {
    it("возвращает 403 при удалении чужого скина", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${otherUserToken}`)
        .attach("file", pngBuffer(48), "skin.png")
        .expect(201);
      trackUploadedFile(uploadRes.body.url);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadRes.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(403);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadRes.body.id}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(200);
    });

    it("удаляет свой скин и восстанавливает его для остальных тестов", async () => {
      const store = app.get(UserContentMapStoreToken);
      let ownSkins = await store.findByUserUuid(TEST_UUID, "skin");
      if (ownSkins.length === 0) {
        const uploadRes = await supertest(app.getHttpServer())
          .post("/v1/common/content/skins")
          .set("Authorization", `Bearer ${userToken}`)
          .attach("file", pngBuffer(), "skin.png")
          .expect(201);
        trackUploadedFile(uploadRes.body.url);
        ownSkins = await store.findByUserUuid(TEST_UUID, "skin");
      }

      const targetId = ownSkins.at(-1)?.id;
      expect(targetId).toBeDefined();

      const res = await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${targetId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(), "skin.png")
        .expect(201);
      uploadedSkinId = uploadRes.body.id;
      trackUploadedFile(uploadRes.body.url);
    });

    it("возвращает 404 если скин не найден", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/common/content/skins/999999")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(404);
    });

    it("возвращает 400 при нечисловом id", async () => {
      await supertest(app.getHttpServer())
        .delete("/v1/common/content/skins/not-a-number")
        .set("Authorization", `Bearer ${userToken}`)
        .expect(400);
    });

    it("запрещает удалять дефолтный скин (файл и запись)", async () => {
      const store = app.get(UserContentMapStoreToken);
      const seededIds: number[] = [];
      try {
        const seeded = await store.save(
          TEST_UUID,
          "http://localhost:3005/textures/default.png",
          "skin",
        );
        seededIds.push(seeded.id);

        const res = await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${seeded.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(400);

        expect(res.body.message).toBe("Нельзя удалить дефолтный скин");
        expect(await store.findById(seeded.id, "skin")).toBeDefined();
        expect(existsSync("public/textures/default.png")).toBe(true);

        const seededRelative = await store.save(TEST_UUID, "/textures/default.png", "skin");
        seededIds.push(seededRelative.id);

        await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${seededRelative.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(400);

        expect(existsSync("public/textures/default.png")).toBe(true);
      } finally {
        for (const id of seededIds) {
          await store.deleteByIdAndCountRemaining(id, "skin");
        }
      }
    });
  });

  describe("PATCH /v1/common/content/skins/active", () => {
    const uploadSkin = async (token: string): Promise<{ id: number; url: string }> => {
      const res = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", pngBuffer(120), "skin.png")
        .expect(201);
      trackUploadedFile(res.body.url);
      return { id: res.body.id, url: res.body.url };
    };

    it("возвращает 401 без токена", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .send({ id: 1 })
        .expect(401);
    });

    it("меняет активный скин: один active, профиль синхронизируется", async () => {
      await deleteUserSkin();
      const first = await uploadSkin(userToken);
      const second = await uploadSkin(userToken);

      const activateFirst = await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: first.id })
        .expect(200);
      expect(activateFirst.body.success).toBe(true);

      const listAfterFirst = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
      const activeFirst = listAfterFirst.body.find((s: { id: number }) => s.id === first.id);
      const inactiveSecond = listAfterFirst.body.find((s: { id: number }) => s.id === second.id);
      expect(activeFirst?.active).toBe(true);
      expect(inactiveSecond?.active).toBe(false);

      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: second.id })
        .expect(200);

      const listAfterSecond = await supertest(app.getHttpServer())
        .get(`/v1/common/content/skins/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
      const firstAfter = listAfterSecond.body.find((s: { id: number }) => s.id === first.id);
      const secondAfter = listAfterSecond.body.find((s: { id: number }) => s.id === second.id);
      expect(firstAfter?.active).toBe(false);
      expect(secondAfter?.active).toBe(true);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${first.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${second.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });

    it("возвращает 403 при попытке активировать чужой скин", async () => {
      const otherSkin = await uploadSkin(otherUserToken);

      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: otherSkin.id })
        .expect(403);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${otherSkin.id}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(200);
    });

    it("возвращает 404 если скин не найден", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: 999999 })
        .expect(404);
    });

    it("возвращает 400 при нецелом id", async () => {
      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: "not-a-number" })
        .expect(400);
    });

    it("возвращает 400 при выборе дефолтного скина", async () => {
      const store = app.get(UserContentMapStoreToken);
      const seeded = await store.save(
        TEST_UUID,
        "http://localhost:3005/textures/default.png",
        "skin",
      );

      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: seeded.id })
        .expect(400);

      await store.deleteByIdAndCountRemaining(seeded.id, "skin");
    });
  });

  describe("Модели", () => {
    it("загружает и удаляет модель", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/models")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", Buffer.from("fake-model-v1"), "model.txt")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      const modelId = uploadRes.body.id;

      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/models/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(listRes.body.some((m: { id: number }) => m.id === modelId)).toBe(true);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/models/${modelId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe("Модель рук скина (?model=)", () => {
    const uploadSkinWithModel = async (model?: string): Promise<{ id: number; url: string }> => {
      const store = app.get(UserContentMapStoreToken);
      const ownSkins = await store.findByUserUuid(TEST_UUID, "skin");
      for (const skin of ownSkins) {
        await supertest(app.getHttpServer())
          .delete(`/v1/common/content/skins/${skin.id}`)
          .set("Authorization", `Bearer ${userToken}`)
          .expect(200);
      }

      const res = await supertest(app.getHttpServer())
        .post(`/v1/common/content/skins${model ? `?model=${model}` : ""}`)
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(32), "skin.png")
        .expect(201);
      trackUploadedFile(res.body.url);
      return { id: res.body.id, url: res.body.url };
    };

    it("сохраняет slim-модель в записи скина", async () => {
      const uploaded = await uploadSkinWithModel("slim");

      const store = app.get(UserContentMapStoreToken);
      const item = await store.findById(uploaded.id, "skin");
      expect(item?.skinModel).toBe("slim");
      uploadedSkinId = uploaded.id;
    });

    it("отдаёт 400 при невалидном model", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/skins?model=fat")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(33), "skin.png")
        .expect(400);
    });
  });

  describe("Плащи", () => {
    it("загружает, листует и удаляет плащ", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/capes")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(64), "cape.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      const capeId = uploadRes.body.id;

      const listRes = await supertest(app.getHttpServer())
        .get(`/v1/common/content/capes/${TEST_UUID}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      expect(listRes.body.some((c: { id: number }) => c.id === capeId)).toBe(true);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/capes/${capeId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });

    it("отдаёт 400 при невалидном PNG плаща", async () => {
      await supertest(app.getHttpServer())
        .post("/v1/common/content/capes")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", Buffer.from("not-a-png"), "cape.png")
        .expect(400);
    });

    it("отдаёт 403 при удалении чужого плаща", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/capes")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(65), "cape.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      const capeId = uploadRes.body.id;

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/capes/${capeId}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(403);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/capes/${capeId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe("Write-through в yggdrasil-профиль", () => {
    it("загрузка скина не меняет активный скин профиля", async () => {
      await deleteUserSkin();
      const profileStore = app.get(YggdrasilStoreToken);
      await profileStore.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_UUID,
        username: "v1user",
        skinUrl: null,
        skinModel: null,
        capeUrl: null,
      });

      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins?model=slim")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(80), "skin.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      uploadedSkinId = uploadRes.body.id;

      const profile = await profileStore.findProfileByUuid(TEST_UUID);
      expect(profile?.skinUrl).toBeNull();
      expect(profile?.skinModel).toBeNull();

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadedSkinId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);
    });

    it("смена активного скина обновляет skinUrl и skinModel профиля", async () => {
      await deleteUserSkin();
      const profileStore = app.get(YggdrasilStoreToken);
      await profileStore.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_UUID,
        username: "v1user",
        skinUrl: null,
        skinModel: null,
        capeUrl: null,
      });

      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/skins?model=slim")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(81), "skin.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);
      uploadedSkinId = uploadRes.body.id;

      await supertest(app.getHttpServer())
        .patch("/v1/common/content/skins/active")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ id: uploadedSkinId })
        .expect(200);

      const profile = await profileStore.findProfileByUuid(TEST_UUID);
      expect(profile?.skinUrl).toBe(uploadRes.body.url);
      expect(profile?.skinModel).toBe("slim");

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/skins/${uploadedSkinId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      const clearedProfile = await profileStore.findProfileByUuid(TEST_UUID);
      expect(clearedProfile?.skinUrl).toBeNull();
      expect(clearedProfile?.skinModel).toBeNull();
    });

    it("загрузка плаща обновляет capeUrl профиля", async () => {
      const profileStore = app.get(YggdrasilStoreToken);
      await profileStore.saveProfile({
        uuid: TEST_UUID,
        userId: TEST_UUID,
        username: "v1user",
        skinUrl: null,
        skinModel: null,
        capeUrl: null,
      });

      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/capes")
        .set("Authorization", `Bearer ${userToken}`)
        .attach("file", pngBuffer(96), "cape.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);

      const profile = await profileStore.findProfileByUuid(TEST_UUID);
      expect(profile?.capeUrl).toBe(uploadRes.body.url);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/capes/${uploadRes.body.id}`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200);

      const clearedProfile = await profileStore.findProfileByUuid(TEST_UUID);
      expect(clearedProfile?.capeUrl).toBeNull();
    });

    it("без профиля загрузка не падает (no-op)", async () => {
      const uploadRes = await supertest(app.getHttpServer())
        .post("/v1/common/content/capes")
        .set("Authorization", `Bearer ${otherUserToken}`)
        .attach("file", pngBuffer(97), "cape.png")
        .expect(201);

      trackUploadedFile(uploadRes.body.url);

      await supertest(app.getHttpServer())
        .delete(`/v1/common/content/capes/${uploadRes.body.id}`)
        .set("Authorization", `Bearer ${otherUserToken}`)
        .expect(200);
    });
  });
});
