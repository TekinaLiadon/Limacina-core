import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it, spyOn } from "bun:test";
import { JwtService } from "@nestjs/jwt";
import { MemoryDb } from "../../../memory/memory-db";
import {
  YggdrasilMapSessionStore,
  YggdrasilMapTokenStore,
} from "../../../memory/yggdrasil_map_store";
import { YggdrasilMapStore, type IYggdrasilTokenStore, type TokenEntry } from "../yggdrasil_store";
import type { IUserContentStore } from "../../../user-content/user_content_store";
import type { AppConfigType } from "../../../config/global-config";
import { YggdrasilService } from "../yggdrasil.service";

const SEED_PASSWORD = "refresh-pass";

function makeConfig(): AppConfigType {
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
): YggdrasilService {
  return new YggdrasilService(
    store,
    tokenStore,
    new YggdrasilMapSessionStore(new MemoryDb()),
    contentStore,
    makeConfig(),
    new JwtService({}),
  );
}

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
