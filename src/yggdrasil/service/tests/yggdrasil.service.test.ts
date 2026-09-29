import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { HttpException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MemoryDb } from "../../../memory/memory-db";
import {
  YggdrasilMapSessionStore,
  YggdrasilMapTokenStore,
} from "../../../memory/yggdrasil_map_store";
import { YggdrasilMapStore, type IYggdrasilTokenStore, type TokenEntry } from "../yggdrasil_store";
import type { IUserContentStore } from "../../../user-content/user_content_store";
import type { AppConfigType } from "../../../config/global-config";
import { buildTestPng } from "../../../utils/tests/test-png";
import { buildContentLocation } from "../../../utils/content-files";
import { YggdrasilService } from "../yggdrasil.service";

const SEED_PASSWORD = "refresh-pass";

function makeConfig(baseUrl = "http://localhost:3005"): AppConfigType {
  return {
    NODE_ENV: "test",
    PORT: 3005,
    JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
    JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
    DB_DRIVER: "map",
    BASE_URL: baseUrl,
    MAX_SKINS_PER_USER: 1,
    MAX_MODELS_PER_USER: 1,
    MAX_CAPES_PER_USER: 1,
    RATE_LIMIT_AUTH_MAX: 10,
    RATE_LIMIT_AUTH_WINDOW: 60000,
    RATE_LIMIT_AUTH_IP_MAX: 10,
    RATE_LIMIT_GLOBAL_MAX: 600,
    RATE_LIMIT_GLOBAL_WINDOW: 60000,
    BEHIND_PROXY: true,
    RCON_PORT: 25575,
  };
}

function makeContentStore(): IUserContentStore {
  return {
    findByUserUuid: async () => [],
    countByFilePath: async () => 0,
  } as unknown as IUserContentStore;
}

function makeService(
  store: YggdrasilMapStore,
  tokenStore: IYggdrasilTokenStore,
  contentStore: IUserContentStore = makeContentStore(),
  baseUrl = "http://localhost:3005",
): YggdrasilService {
  return new YggdrasilService(
    store,
    tokenStore,
    new YggdrasilMapSessionStore(new MemoryDb()),
    contentStore,
    makeConfig(baseUrl),
    new JwtService({}),
  );
}

const rejectionResponse = async (
  promise: Promise<unknown>,
): Promise<{ error: string; errorMessage: string }> => {
  const thrown = await promise.then(
    (): HttpException | undefined => undefined,
    (error: HttpException) => error,
  );
  if (!thrown) throw new Error("ожидался reject, а метод завершился успешно");
  return thrown.getResponse() as { error: string; errorMessage: string };
};

const makeStore = async (): Promise<{ store: YggdrasilMapStore; username: string }> => {
  const username = "refreshuser";
  const uuid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const store = new YggdrasilMapStore(new MemoryDb(), {
    users: [
      {
        username,
        uuid,
        passwordHash: await Bun.password.hash(SEED_PASSWORD),
        approved: true,
      },
    ],
    profiles: [{ uuid, userId: uuid, username }],
  });
  return { store, username };
};

describe("YggdrasilService.refresh — атомарность замены токена (TASK-269.8)", (): void => {
  it("сбой подготовки ответа не расходует токен — refresh можно повторить", async (): Promise<void> => {
    const { store, username } = await makeStore();
    const tokenStore = new YggdrasilMapTokenStore(new MemoryDb());
    const contentStore = makeContentStore();
    const service = makeService(store, tokenStore, contentStore);

    const auth = await service.authenticate({ username, password: SEED_PASSWORD });
    const { accessToken } = auth;

    const findByUserUuid = spyOn(contentStore, "findByUserUuid").mockRejectedValue(
      new Error("content store down"),
    );

    await expect(service.refresh({ accessToken })).rejects.toThrow("content store down");

    expect(await tokenStore.findToken(accessToken)).toBeDefined();
    findByUserUuid.mockRestore();

    const retry = await service.refresh({ accessToken });
    expect(await tokenStore.findToken(accessToken)).toBeUndefined();
    expect(await tokenStore.findToken(retry.accessToken)).toBeDefined();
  });

  it("сбой saveToken после списания возвращает старый токен в стор", async (): Promise<void> => {
    const { store, username } = await makeStore();
    const tokenStore = new YggdrasilMapTokenStore(new MemoryDb());
    const service = makeService(store, tokenStore);

    const auth = await service.authenticate({ username, password: SEED_PASSWORD });
    const { accessToken } = auth;
    const originalSave = tokenStore.saveToken.bind(tokenStore);
    const saveToken = spyOn(tokenStore, "saveToken").mockImplementation(
      (token: string, entry: TokenEntry): Promise<void> => {
        if (token === accessToken) return originalSave(token, entry);
        throw new Error("token store down");
      },
    );

    await expect(service.refresh({ accessToken })).rejects.toThrow("token store down");

    expect(await tokenStore.findToken(accessToken)).toBeDefined();
    saveToken.mockRestore();

    const retry = await service.refresh({ accessToken });
    expect(await tokenStore.findToken(retry.accessToken)).toBeDefined();
  });

  it("параллельный refresh одного токена даёт ровно один успех", async (): Promise<void> => {
    const { store, username } = await makeStore();
    const tokenStore = new YggdrasilMapTokenStore(new MemoryDb());
    const service = makeService(store, tokenStore);

    const auth = await service.authenticate({ username, password: SEED_PASSWORD });

    const results = await Promise.allSettled([
      service.refresh({ accessToken: auth.accessToken }),
      service.refresh({ accessToken: auth.accessToken }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });
});

describe("YggdrasilService.uploadTexture — сериализация мутаций текстур (TASK-411.15)", (): void => {
  const TEXTURE_USERNAME = "textureuser";
  const TEXTURE_UUID = "d0000000000000000000000000000001";
  const writtenFiles: string[] = [];

  const textureLocation = (bytes: Uint8Array): { url: string; path: string } =>
    buildContentLocation("http://localhost:3005", "textures", TEXTURE_USERNAME, bytes, "png");

  const makeTextureStore = async (): Promise<YggdrasilMapStore> =>
    new YggdrasilMapStore(new MemoryDb(), {
      users: [
        {
          username: TEXTURE_USERNAME,
          uuid: TEXTURE_UUID,
          passwordHash: await Bun.password.hash(SEED_PASSWORD),
          approved: true,
        },
      ],
      profiles: [{ uuid: TEXTURE_UUID, userId: TEXTURE_UUID, username: TEXTURE_USERNAME }],
    });

  afterAll((): void => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("параллельные PUT одного профиля не осиротевают файлы текстур", async (): Promise<void> => {
    const bytesA = new Uint8Array(buildTestPng({ variant: 211 }));
    const bytesB = new Uint8Array(buildTestPng({ variant: 212 }));
    writtenFiles.push(textureLocation(bytesA).path, textureLocation(bytesB).path);

    const store = await makeTextureStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const auth = await service.authenticate({
      username: TEXTURE_USERNAME,
      password: SEED_PASSWORD,
    });
    const authorization = `Bearer ${auth.accessToken}`;

    await Promise.allSettled([
      service.uploadTexture(TEXTURE_UUID, "skin", Buffer.from(bytesA), undefined, authorization),
      service.uploadTexture(TEXTURE_UUID, "skin", Buffer.from(bytesB), undefined, authorization),
    ]);

    const profile = await store.findProfileByUuid(TEXTURE_UUID);
    const finalUrl = profile?.skinUrl;
    const isKnownTexture =
      finalUrl === textureLocation(bytesA).url || finalUrl === textureLocation(bytesB).url;
    expect(isKnownTexture).toBe(true);

    const finalPath =
      finalUrl === textureLocation(bytesA).url
        ? textureLocation(bytesA).path
        : textureLocation(bytesB).path;
    const orphanPath =
      finalUrl === textureLocation(bytesA).url
        ? textureLocation(bytesB).path
        : textureLocation(bytesA).path;
    expect(existsSync(finalPath)).toBe(true);
    expect(existsSync(orphanPath)).toBe(false);
  }, 30_000);

  it("параллельные PUT и DELETE оставляют профиль и файлы согласованными", async (): Promise<void> => {
    const bytes = new Uint8Array(buildTestPng({ variant: 213 }));
    writtenFiles.push(textureLocation(bytes).path);

    const store = await makeTextureStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const auth = await service.authenticate({
      username: TEXTURE_USERNAME,
      password: SEED_PASSWORD,
    });
    const authorization = `Bearer ${auth.accessToken}`;
    await service.uploadTexture(TEXTURE_UUID, "skin", Buffer.from(bytes), undefined, authorization);

    await Promise.allSettled([
      service.deleteTexture(TEXTURE_UUID, "skin", authorization),
      service.deleteTexture(TEXTURE_UUID, "skin", authorization),
    ]);

    const profile = await store.findProfileByUuid(TEXTURE_UUID);
    expect(profile?.skinUrl).toBeNull();
    expect(existsSync(textureLocation(bytes).path)).toBe(false);
  }, 30_000);
});

const NEUTRAL_CREDENTIALS_ERROR = "Invalid credentials. Invalid username or password.";
const TIMING_PASSWORD = "timing-pass";
const TIMING_ACTIVE_UUID = "b0000000000000000000000000000001";
const TIMING_BANNED_UUID = "b0000000000000000000000000000002";

const makeTimingStore = async (): Promise<{ store: YggdrasilMapStore; passwordHash: string }> => {
  const passwordHash = await Bun.password.hash(TIMING_PASSWORD);
  const store = new YggdrasilMapStore(new MemoryDb(), {
    users: [
      { username: "timingactive", uuid: TIMING_ACTIVE_UUID, passwordHash, approved: true },
      {
        username: "timingbanned",
        uuid: TIMING_BANNED_UUID,
        passwordHash,
        approved: true,
        banned: true,
      },
    ],
    profiles: [
      {
        uuid: "c0000000000000000000000000000001",
        userId: TIMING_ACTIVE_UUID,
        username: "timingactive",
      },
      {
        uuid: "c0000000000000000000000000000002",
        userId: TIMING_BANNED_UUID,
        username: "timingbanned",
      },
    ],
  });
  return { store, passwordHash };
};

describe("YggdrasilService — тайминговая нейтральность (TASK-267.4)", (): void => {
  it("authenticate несуществующего юзера выполняет dummy-verify", async (): Promise<void> => {
    const { store } = await makeTimingStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const verify = spyOn(Bun.password, "verify");

    try {
      const response = await rejectionResponse(
        service.authenticate({ username: "timingghost", password: "guess" }),
      );
      expect(response.error).toBe("ForbiddenOperationException");
      expect(response.errorMessage).toBe(NEUTRAL_CREDENTIALS_ERROR);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  });

  it("authenticate забаненного проверяет пароль до статусного отказа", async (): Promise<void> => {
    const { store, passwordHash } = await makeTimingStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const verify = spyOn(Bun.password, "verify");

    try {
      const response = await rejectionResponse(
        service.authenticate({ username: "timingbanned", password: "wrong" }),
      );
      expect(response.errorMessage).toBe(NEUTRAL_CREDENTIALS_ERROR);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[1]).toBe(passwordHash);
    } finally {
      verify.mockRestore();
    }
  });

  it("authenticate забаненного с верным паролем даёт ту же нейтральную ошибку", async (): Promise<void> => {
    const { store, passwordHash } = await makeTimingStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const verify = spyOn(Bun.password, "verify");

    try {
      const response = await rejectionResponse(
        service.authenticate({ username: "timingbanned", password: TIMING_PASSWORD }),
      );
      expect(response.error).toBe("ForbiddenOperationException");
      expect(response.errorMessage).toBe(NEUTRAL_CREDENTIALS_ERROR);
      expect(verify.mock.calls[0]?.[1]).toBe(passwordHash);
    } finally {
      verify.mockRestore();
    }
  });

  it("signout несуществующего юзера выполняет dummy-verify", async (): Promise<void> => {
    const { store } = await makeTimingStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const verify = spyOn(Bun.password, "verify");

    try {
      const response = await rejectionResponse(
        service.signout({ username: "timingghost", password: "guess" }),
      );
      expect(response.errorMessage).toBe(NEUTRAL_CREDENTIALS_ERROR);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  });

  it("signout с неверным паролем проверяет реальный хеш", async (): Promise<void> => {
    const { store, passwordHash } = await makeTimingStore();
    const service = makeService(store, new YggdrasilMapTokenStore(new MemoryDb()));
    const verify = spyOn(Bun.password, "verify");

    try {
      const response = await rejectionResponse(
        service.signout({ username: "timingactive", password: "wrong" }),
      );
      expect(response.errorMessage).toBe(NEUTRAL_CREDENTIALS_ERROR);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[1]).toBe(passwordHash);
    } finally {
      verify.mockRestore();
    }
  });
});

const makeMetadataService = (baseUrl: string): YggdrasilService =>
  makeService(
    new YggdrasilMapStore(new MemoryDb(), { users: [], profiles: [] }),
    new YggdrasilMapTokenStore(new MemoryDb()),
    makeContentStore(),
    baseUrl,
  );

describe("YggdrasilService.getMetadata — skinDomains (TASK-269.34)", (): void => {
  it("апекс-домен получает корректный wildcard-элемент", () => {
    const metadata = makeMetadataService("https://example.com").getMetadata();
    expect(metadata.skinDomains).toEqual(["example.com", ".example.com"]);
  });

  it("поддомен сохраняет wildcard по родительскому домену", () => {
    const metadata = makeMetadataService("https://limacina.example.com").getMetadata();
    expect(metadata.skinDomains).toEqual(["limacina.example.com", ".example.com"]);
  });

  it("IPv4-хост не получает мусорных элементов", () => {
    const metadata = makeMetadataService("http://127.0.0.1:3005").getMetadata();
    expect(metadata.skinDomains).toEqual(["127.0.0.1"]);
  });

  it("IPv6-хост не получает мусорных элементов", () => {
    const metadata = makeMetadataService("http://[::1]:3005").getMetadata();
    expect(metadata.skinDomains).toEqual(["[::1]"]);
  });

  it("хост без точки не получает wildcard", () => {
    const metadata = makeMetadataService("http://localhost:3005").getMetadata();
    expect(metadata.skinDomains).toEqual(["localhost"]);
  });
});
