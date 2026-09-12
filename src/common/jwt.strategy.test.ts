import { setupTestEnv } from "../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtStrategy, type JwtAccessPayload } from "./jwt.strategy";
import { AuthMapStore, type StoredUser } from "../auth/service/auth_store.service";
import { AuthService } from "../auth/service/auth.service";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "../auth/token.constants";
import { AdminService } from "../admin/admin.service";
import { CronService } from "../cron/cron.service";
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

  it("401 для неодобренного пользователя с нейтральным сообщением", async (): Promise<void> => {
    const store = new AuthMapStore();
    await store.saveUser(buildUser({ approved: false }));
    const strategy = new JwtStrategy(TEST_CONFIG, store);

    const invalidation = strategy.validate({
      sub: TEST_UUID,
      username: TEST_USERNAME,
      role: "user",
    });
    await expect(invalidation).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(invalidation).rejects.toThrow("Нет доступа");
  });
});

describe("Неодобренный пользователь не продлевает сессию и не меняет пароль", (): void => {
  const OLD_PASSWORD = "oldpass123";

  const buildAuthService = (store: AuthMapStore): AuthService => {
    const jwtService = new JwtService({
      secret: TEST_CONFIG.JWT_ACCESS,
      signOptions: { expiresIn: 31536000 },
    });
    return new AuthService(jwtService, store, TEST_CONFIG);
  };

  it("refresh отклоняет токен неодобренного пользователя", async (): Promise<void> => {
    const store = new AuthMapStore();
    const authService = buildAuthService(store);
    const registered = await authService.register(TEST_USERNAME, OLD_PASSWORD);

    await expect(authService.refresh(registered.tokens.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("refresh отклоняет токен после снятия approve", async (): Promise<void> => {
    const store = new AuthMapStore();
    const authService = buildAuthService(store);
    const passwordHash = await Bun.password.hash(OLD_PASSWORD);
    await store.saveUser(buildUser({ passwordHash }));

    const login = await authService.login(TEST_USERNAME, OLD_PASSWORD);
    await store.saveUser(buildUser({ passwordHash, approved: false }));

    await expect(authService.refresh(login.tokens.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("changePassword отклоняет неодобренного пользователя", async (): Promise<void> => {
    const store = new AuthMapStore();
    const authService = buildAuthService(store);
    await authService.register(TEST_USERNAME, OLD_PASSWORD);

    await expect(
      authService.changePassword(TEST_USERNAME, OLD_PASSWORD, "newpass456"),
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

    const adminService = new AdminService(adminStore, authStore, new CronService());
    await adminService.setUserPassword(TEST_USERNAME, "ownernewpass", {
      uuid: "owner-uuid-000000000000000000000000000",
      username: "owner",
      role: "owner",
    });

    const payload = jwtService.decode<JwtAccessPayload>(login.tokens.access_token);
    expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});

describe("TTL и ротация токенов (H-02a)", (): void => {
  const OLD_PASSWORD = "oldpass123";

  const buildAuthStack = (store: AuthMapStore) => {
    const jwtService = new JwtService({
      secret: TEST_CONFIG.JWT_ACCESS,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    });
    const authService = new AuthService(jwtService, store, TEST_CONFIG);
    return { authService, jwtService };
  };

  it("access-токен живёт 3 часа, refresh — 365 дней", (): void => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3 * 60 * 60);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it("access-токен живёт 3 часа, refresh — 365 дней", (): void => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3 * 60 * 60);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it("логаут завершает access-сессию за пределами TTL", async (): Promise<void> => {
    const store = new AuthMapStore();
    const { authService, jwtService } = buildAuthStack(store);
    await store.saveUser(buildUser({ passwordHash: await Bun.password.hash(OLD_PASSWORD) }));

    const login = await authService.login(TEST_USERNAME, OLD_PASSWORD);
    await authService.invalidate(login.tokens.refresh_token);

    const decoded = jwtService.decode<JwtAccessPayload & { exp: number }>(
      login.tokens.access_token,
    );
    expect(decoded.exp - decoded.iat!).toBe(ACCESS_TOKEN_TTL_SECONDS);

    const expiredAccess = await jwtService.signAsync(
      { sub: TEST_UUID, username: TEST_USERNAME, role: "user" },
      { secret: TEST_CONFIG.JWT_ACCESS, expiresIn: -1 },
    );
    await expect(
      jwtService.verifyAsync(expiredAccess, { secret: TEST_CONFIG.JWT_ACCESS }),
    ).rejects.toThrow();
  });

  it("ротация refresh: после invalidate пара не восстанавливается", async (): Promise<void> => {
    const store = new AuthMapStore();
    const { authService } = buildAuthStack(store);
    await store.saveUser(buildUser({ passwordHash: await Bun.password.hash(OLD_PASSWORD) }));

    const login = await authService.login(TEST_USERNAME, OLD_PASSWORD);
    const renewed = await authService.refresh(login.tokens.refresh_token);

    expect(renewed.tokens.refresh_token).not.toBe(login.tokens.refresh_token);
    expect(renewed.tokens.access_token).not.toBe(login.tokens.access_token);

    await expect(authService.refresh(login.tokens.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );

    await authService.invalidate(renewed.tokens.refresh_token);
    await expect(authService.refresh(renewed.tokens.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
