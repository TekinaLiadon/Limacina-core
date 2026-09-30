import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import { CacheStoreToken, type ICacheStore } from "../../cache/cache_store";
import { CacheMapStore } from "../../memory/cache_map_store";
import { MemoryDb } from "../../memory/memory-db";
import {
  RCON_STATUS_CACHE_KEY,
  RconClientToken,
  RconService,
  createRconClient,
  type RconClient,
} from "../rcon.service";
import { SourceRconClient, type RconResult } from "../source-rcon-client";

interface RconConfigOptions {
  host?: string;
  port?: number;
  password?: string;
}

function rconConfig(rcon: RconConfigOptions): AppConfigType {
  return {
    NODE_ENV: "test",
    PORT: 3005,
    JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
    JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
    DB_DRIVER: "map",
    BASE_URL: "http://localhost:3005",
    MAX_SKINS_PER_USER: 1,
    MAX_MODELS_PER_USER: 1,
    MAX_CAPES_PER_USER: 1,
    RATE_LIMIT_AUTH_MAX: 10,
    RATE_LIMIT_AUTH_WINDOW: 60000,
    RATE_LIMIT_AUTH_IP_MAX: 1000,
    RATE_LIMIT_GLOBAL_MAX: 600,
    RATE_LIMIT_GLOBAL_WINDOW: 60000,
    BEHIND_PROXY: true,
    RCON_HOST: rcon.host,
    RCON_PORT: rcon.port ?? 25575,
    RCON_PASSWORD: rcon.password,
  };
}

class FakeRconClient implements RconClient {
  available = true;
  output = "Сервер: готово";
  error: string | undefined;
  checkCount = 0;
  onCheck: (() => Promise<void>) | undefined;
  readonly calls: string[] = [];

  async checkAvailable(): Promise<boolean> {
    this.checkCount++;
    if (this.onCheck) await this.onCheck();
    return this.available;
  }

  async executeCommand(command: string): Promise<RconResult> {
    this.calls.push(command);
    if (this.error) return { ok: false, error: this.error };
    return { ok: true, output: this.output };
  }
}

async function createService(
  config: AppConfigType,
  client: RconClient,
): Promise<{ service: RconService; cache: ICacheStore }> {
  const db = new MemoryDb();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    providers: [
      RconService,
      { provide: AppConfigToken, useValue: config },
      { provide: CacheStoreToken, useFactory: () => new CacheMapStore(db) },
      { provide: RconClientToken, useValue: client },
    ],
  }).compile();

  return {
    service: moduleFixture.get(RconService),
    cache: moduleFixture.get(CacheStoreToken),
  };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("RconService — статус", () => {
  it("отключён, когда RCON не настроен — коннект не проверяется", async () => {
    const client = new FakeRconClient();
    const { service } = await createService(rconConfig({}), client);

    expect((await service.getStatus()).enabled).toBe(false);
    expect(client.checkCount).toBe(0);
  });

  it("проверяет коннект и кеширует результат на короткое время", async () => {
    const client = new FakeRconClient();
    const { service, cache } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    expect((await service.getStatus()).enabled).toBe(true);
    expect(client.checkCount).toBe(1);

    expect((await service.getStatus()).enabled).toBe(true);
    expect(client.checkCount).toBe(1);

    await cache.delete(RCON_STATUS_CACHE_KEY);
    expect((await service.getStatus()).enabled).toBe(true);
    expect(client.checkCount).toBe(2);
  });

  it("недоступный RCON отдаёт enabled:false и тоже кешируется", async () => {
    const client = new FakeRconClient();
    client.available = false;
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    expect((await service.getStatus()).enabled).toBe(false);
    expect((await service.getStatus()).enabled).toBe(false);
    expect(client.checkCount).toBe(1);
  });

  it("бёрст параллельных запросов поднимает одну RCON-проверку", async () => {
    const client = new FakeRconClient();
    let releaseCheck!: () => void;
    const checkGate = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    client.onCheck = () => checkGate;
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    const statusesPromise = Promise.all(Array.from({ length: 5 }, () => service.getStatus()));
    await Bun.sleep(10);

    expect(client.checkCount).toBe(1);

    releaseCheck();
    const statuses = await statusesPromise;

    expect(statuses).toHaveLength(5);
    expect(statuses.every((status) => status.enabled)).toBe(true);
    expect(client.checkCount).toBe(1);
  });
});

describe("RconService — команды", () => {
  it("отдаёт статический список ванильных команд", async () => {
    const { service } = await createService(rconConfig({}), new FakeRconClient());

    const { commands } = service.getCommands();

    expect(commands.length).toBeGreaterThan(20);
    expect(commands).toContain("say");
    expect(commands).toContain("stop");
    expect(commands).toContain("whitelist");
  });
});

describe("RconService — выполнение", () => {
  it("возвращает вывод команды", async () => {
    const client = new FakeRconClient();
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    expect((await service.execute("say Hello")).output).toBe("Сервер: готово");
    expect(client.calls).toContain("say Hello");
  });

  it("триммит команду и обрезает ведущие слеши", async () => {
    const client = new FakeRconClient();
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    await service.execute("  //say Hi  ");

    expect(client.calls).toContain("say Hi");
  });

  it("пустая команда или только слеш — 400", async () => {
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      new FakeRconClient(),
    );

    expect(await errorOf(service.execute("/"))).toBeInstanceOf(BadRequestException);
    expect(await errorOf(service.execute("   "))).toBeInstanceOf(BadRequestException);
  });

  it("слишком длинная команда — 400", async () => {
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      new FakeRconClient(),
    );

    const error = await errorOf(service.execute("a".repeat(300)));

    expect(error).toBeInstanceOf(BadRequestException);
  });

  it("сбой RCON — 503 с понятным сообщением, команда не выполняется повторно", async () => {
    const client = new FakeRconClient();
    client.error = "Неверный пароль RCON";
    const { service } = await createService(
      rconConfig({ host: "127.0.0.1", password: "secret" }),
      client,
    );

    const error = await errorOf(service.execute("say Hi"));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).toBe("Неверный пароль RCON");
    expect(client.calls).toEqual(["say Hi"]);
  });

  it("выполнение без настройки RCON — 503", async () => {
    const client = new FakeRconClient();
    const { service } = await createService(rconConfig({}), client);

    const error = await errorOf(service.execute("say Hi"));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(client.calls.length).toBe(0);
  });
});

describe("createRconClient — выбор клиента по конфигу", () => {
  it("без настройки возвращает заглушку, которая ничего не подключает", async () => {
    const client = createRconClient(rconConfig({}));

    expect(await client.checkAvailable()).toBe(false);
    const result = await client.executeCommand("say Hi");
    expect(result.ok).toBe(false);
  });

  it("с настройкой возвращает SourceRconClient", () => {
    const client = createRconClient(rconConfig({ host: "127.0.0.1", password: "secret" }));

    expect(client).toBeInstanceOf(SourceRconClient);
  });
});
