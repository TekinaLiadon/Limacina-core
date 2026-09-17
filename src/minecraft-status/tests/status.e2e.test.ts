import { setupTestEnv } from "../../utils/tests/test-env";
import { applyV1ApiPrefix } from "../../utils/tests/v1-prefix";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import supertest from "supertest";
import { V1StatusController } from "../../v1/common/status/status.controller";
import { MinecraftStatusService, STATUS_CACHE_KEY } from "../minecraft-status.service";
import { buildStatusResponse } from "./status-packet";
import { CacheStoreToken, type ICacheStore } from "../../cache/cache_store";
import { CacheMapStore } from "../../memory/cache_map_store";
import { MemoryDb } from "../../memory/memory-db";
import GlobalConfig from "../../config/global-config";
import { AppConfigToken } from "../../config/app-config.provider";

interface FakeMinecraftServer {
  server: Server;
  connectionCount: () => number;
}

function startFakeMinecraftServer(status: object): Promise<FakeMinecraftServer> {
  let connections = 0;
  return new Promise((resolveStart) => {
    const server = createServer((socket) => {
      connections++;
      let responded = false;
      socket.on("data", (data: Buffer) => {
        if (responded) return;
        responded = true;
        void data;
        socket.write(buildStatusResponse(status));
        socket.end();
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () =>
      resolveStart({ server, connectionCount: () => connections }),
    );
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolveStop) => {
    server.close(() => resolveStop());
  });
}

async function createStatusApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [V1StatusController],
    providers: [
      MinecraftStatusService,
      {
        provide: AppConfigToken,
        useFactory: () => GlobalConfig.parseEnvOrExit(),
      },
      MemoryDb,
      {
        provide: CacheStoreToken,
        useFactory: (db: MemoryDb) => new CacheMapStore(db),
        inject: [MemoryDb],
      },
    ],
  }).compile();

  const statusApp = moduleFixture.createNestApplication(new FastifyAdapter());
  applyV1ApiPrefix(statusApp);
  await statusApp.init();
  await statusApp.getHttpAdapter().getInstance().ready();
  return statusApp;
}

const TEST_STATUS = {
  version: { name: "1.21.4", protocol: 769 },
  players: { max: 20, online: 7 },
  description: { text: "Limacina test" },
};

describe("V1 common/status эндпоинт — SLP-пинг игрового сервера", (): void => {
  let app: INestApplication;
  let fakeServer: Server;
  let connectionCount: () => number;

  beforeAll(async () => {
    const fake = await startFakeMinecraftServer(TEST_STATUS);
    ({ server: fakeServer, connectionCount } = fake);
    const address = fakeServer.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    process.env["MINECRAFT_HOST"] = `127.0.0.1:${port}`;

    app = await createStatusApp();
  });

  afterAll(async () => {
    await app.close();
    await stopServer(fakeServer);
  });

  describe("GET /v1/common/status", () => {
    it("возвращает 200 и число игроков", async () => {
      const res = await supertest(app.getHttpServer()).get("/v1/common/status").expect(200);

      expect(res.body.online).toBe(7);
      expect(res.body.max).toBe(20);
      expect(res.body.version).toBe("1.21.4");
    });

    it("повторный запрос отдаётся из кеша без нового пинга", async () => {
      await supertest(app.getHttpServer()).get("/v1/common/status").expect(200);
      const connectionsBefore = connectionCount();

      const res = await supertest(app.getHttpServer()).get("/v1/common/status").expect(200);

      expect(res.body.online).toBe(7);
      expect(connectionCount()).toBe(connectionsBefore);
    });

    it("после инвалидации кеша сервер пингуется снова", async () => {
      const connectionsBefore = connectionCount();
      const cache = app.get<ICacheStore>(CacheStoreToken, { strict: false });
      await cache.delete(STATUS_CACHE_KEY);

      const res = await supertest(app.getHttpServer()).get("/v1/common/status").expect(200);

      expect(res.body.online).toBe(7);
      expect(connectionCount()).toBeGreaterThan(connectionsBefore);
    });

    it("возвращает 503, когда игровой сервер недоступен", async () => {
      const offlineApp = await createOfflineApp();

      try {
        await supertest(offlineApp.getHttpServer()).get("/v1/common/status").expect(503);
      } finally {
        await offlineApp.close();
      }
    });

    it("ошибка недоступности не кешируется", async () => {
      const offlineApp = await createOfflineApp();

      try {
        await supertest(offlineApp.getHttpServer()).get("/v1/common/status").expect(503);
        await supertest(offlineApp.getHttpServer()).get("/v1/common/status").expect(503);

        const cache = offlineApp.get<ICacheStore>(CacheStoreToken, { strict: false });
        expect(await cache.get(STATUS_CACHE_KEY)).toBeUndefined();
      } finally {
        await offlineApp.close();
      }
    });

    it("возвращает 503, когда MINECRAFT_HOST не задан", async () => {
      const unconfiguredApp = await createUnconfiguredApp();

      try {
        const res = await supertest(unconfiguredApp.getHttpServer())
          .get("/v1/common/status")
          .expect(503);

        expect(res.body.message).toContain("MINECRAFT_HOST не задан");
      } finally {
        await unconfiguredApp.close();
      }
    });

    it("возвращает 503 при невалидном порте в MINECRAFT_HOST", async () => {
      const invalidPortApp = await createInvalidPortApp();

      try {
        const res = await supertest(invalidPortApp.getHttpServer())
          .get("/v1/common/status")
          .expect(503);

        expect(res.body.message).toContain("Некорректный MINECRAFT_HOST");
      } finally {
        await invalidPortApp.close();
      }
    });

    const createOfflineApp = async (): Promise<INestApplication> => {
      const savedHost = process.env["MINECRAFT_HOST"];
      process.env["MINECRAFT_HOST"] = "127.0.0.1:1";

      try {
        return await createStatusApp();
      } finally {
        if (savedHost === undefined) delete process.env["MINECRAFT_HOST"];
        else process.env["MINECRAFT_HOST"] = savedHost;
      }
    };

    const createUnconfiguredApp = async (): Promise<INestApplication> => {
      const savedHost = process.env["MINECRAFT_HOST"];
      delete process.env["MINECRAFT_HOST"];

      try {
        return await createStatusApp();
      } finally {
        if (savedHost !== undefined) process.env["MINECRAFT_HOST"] = savedHost;
      }
    };

    const createInvalidPortApp = async (): Promise<INestApplication> => {
      const savedHost = process.env["MINECRAFT_HOST"];
      process.env["MINECRAFT_HOST"] = "127.0.0.1:notaport";

      try {
        return await createStatusApp();
      } finally {
        if (savedHost === undefined) delete process.env["MINECRAFT_HOST"];
        else process.env["MINECRAFT_HOST"] = savedHost;
      }
    };
  });
});
