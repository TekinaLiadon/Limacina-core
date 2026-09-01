process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { describe, expect, it } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy";
import { AuthMapStore, type StoredUser } from "../auth/service/auth_store.service";
import GlobalConfig from "../config/global-config";

const TEST_UUID = "33333333333333333333333333333333";
const TEST_USERNAME = "strategyuser";
const TEST_CONFIG = {
  JWT_ACCESS: "test-access-secret",
  JWT_REFRESH: "test-refresh-secret",
  DB_DRIVER: "map",
} as unknown as ReturnType<typeof GlobalConfig.parseEnvOrExit>;

const buildUser = (overrides: Partial<StoredUser>): StoredUser => ({
  uuid: TEST_UUID,
  username: TEST_USERNAME,
  passwordHash: "hash",
  skin: null,
  role: "user",
  approved: true,
  banned: false,
  ...overrides,
});

describe("JwtStrategy store-check", (): void => {
  it("возвращает пользователя с актуальной ролью из стора", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ role: "admin" }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const result = await strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
    });

    expect(result).toEqual({ uuid: TEST_UUID, username: TEST_USERNAME, role: "admin" });
  });

  it("401 для забаненного пользователя", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ banned: true }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    expect(
      strategy.validate({ sub: TEST_UUID, username: TEST_USERNAME, role: "user" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("401 для удалённого пользователя", async (): Promise<void> => {
    const store = new AuthMapStore();
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    expect(
      strategy.validate({ sub: TEST_UUID, username: TEST_USERNAME, role: "user" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("роль из payload игнорируется в пользу роли из стора", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ role: "user" }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const result = await strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "admin",
    });

    expect(result.role).toBe("user");
  });

  it("401 если uuid пользователя не совпадает с sub токена", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ uuid: "other-uuid-000000000000000000000000000" }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    expect(
      strategy.validate({ sub: TEST_UUID, username: TEST_USERNAME, role: "user" }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
