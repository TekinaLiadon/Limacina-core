process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
process.env["NODE_ENV"] = "test";
process.env["BASE_URL"] = "http://localhost:3005";
process.env["DB_DRIVER"] = "map";

import { describe, expect, it } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtStrategy, type JwtAccessPayload } from "./jwt.strategy";
import { AuthMapStore, type StoredUser } from "../auth/service/auth_store.service";
import { AuthService } from "../auth/service/auth.service";
import { AdminService } from "../admin/admin.service";
import { AdminMapStore } from "../admin/admin.store";
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

describe("JwtStrategy password_changed_at", (): void => {
  it("401 для токена, выданного до смены пароля", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ passwordChangedAt: new Date() }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    expect(
      strategy.validate({
        sub: TEST_UUID,
        username: TEST_USERNAME,
        role: "user",
        iat: Math.floor(Date.now() / 1000) - 3600,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("токен, выданный после смены пароля, валиден", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ passwordChangedAt: new Date(Date.now() - 60_000) }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const result = await strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
      iat: Math.floor(Date.now() / 1000),
    });

    expect(result).toEqual({ uuid: TEST_UUID, username: TEST_USERNAME, role: "user" });
  });

  it("токен той же секунды, что и смена пароля, валиден", async (): Promise<void> => {
    const markSecond = Math.floor(Date.now() / 1000);
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ passwordChangedAt: new Date(markSecond * 1000 + 500) }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const result = await strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
      iat: markSecond,
    });

    expect(result).toEqual({ uuid: TEST_UUID, username: TEST_USERNAME, role: "user" });
  });

  it("отсутствие метки password_changed_at не мешает валидации", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({}));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const result = await strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
      iat: 12345,
    });

    expect(result).toEqual({ uuid: TEST_UUID, username: TEST_USERNAME, role: "user" });
  });

  it("401 для токена без iat при наличии метки", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ passwordChangedAt: new Date() }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    expect(
      strategy.validate({ sub: TEST_UUID, username: TEST_USERNAME, role: "user" }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe("Смена пароля деактивирует выданные access-токены", (): void => {
  const OLD_PASSWORD = "oldpass123";

  const buildAuthStack = (store: AuthMapStore) => {
    const jwtService = new JwtService({
      secret: TEST_CONFIG.JWT_ACCESS,
      signOptions: { expiresIn: 31536000 },
    });
    const authService = new AuthService(jwtService, store, TEST_CONFIG);
    const strategy = new JwtStrategy(TEST_CONFIG, store);
    return { authService, jwtService, strategy };
  };

  it("смена собственного пароля убивает старый access, новый — жив", async (): Promise<void> => {
    const store = new AuthMapStore();
    const { authService, jwtService, strategy } = buildAuthStack(store);
    await store.saveUser(buildUser({ passwordHash: await Bun.password.hash(OLD_PASSWORD) }));

    const login = await authService.login(TEST_USERNAME, OLD_PASSWORD);
    await Bun.sleep(1100);
    const changed = await authService.changePassword(TEST_USERNAME, OLD_PASSWORD, "newpass456");

    const oldPayload = jwtService.decode<JwtAccessPayload>(login.tokens.access_token);
    const newPayload = jwtService.decode<JwtAccessPayload>(changed.tokens.access_token);

    expect(strategy.validate(oldPayload)).rejects.toThrow(UnauthorizedException);
    expect(await strategy.validate(newPayload)).toEqual({
      uuid: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
    });
  });

  it("owner-ская смена пароля убивает access-токен", async (): Promise<void> => {
    const authStore = new AuthMapStore();
    const adminStore = new AdminMapStore();
    const { authService, jwtService, strategy } = buildAuthStack(authStore);
    await authStore.saveUser(buildUser({ passwordHash: await Bun.password.hash(OLD_PASSWORD) }));
    await adminStore.saveUser({
      uuid: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
      approved: true,
      banned: false,
    });

    const login = await authService.login(TEST_USERNAME, OLD_PASSWORD);
    await Bun.sleep(1100);

    const adminService = new AdminService(adminStore, authStore);
    await adminService.setUserPassword(TEST_USERNAME, "ownernewpass", {
      uuid: "owner-uuid-000000000000000000000000000",
      username: "owner",
      role: "owner",
    });

    const payload = jwtService.decode<JwtAccessPayload>(login.tokens.access_token);
    expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
