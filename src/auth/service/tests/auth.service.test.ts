import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { beforeAll, describe, expect, it } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "../auth.service";
import { AuthMapStore, AuthStoreToken, type IAuthStore } from "../auth_store";
import { MemoryDb } from "../../../memory/memory-db";
import GlobalConfig from "../../../config/global-config";
import { AppConfigToken } from "../../../config/app-config.provider";

class FailingRefreshStore extends AuthMapStore {
  constructor() {
    super(new MemoryDb());
  }

  override async saveRefresh(): Promise<void> {
    throw new Error("saveRefresh недоступен");
  }
}

describe("AuthService — атомарность регистрации (TASK-217.7)", () => {
  let service: AuthService;
  let failingStore: IAuthStore;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret-0123456789abcdef0123",
          signOptions: { expiresIn: 3600 },
        }),
      ],
      providers: [
        AuthService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        { provide: AuthStoreToken, useClass: FailingRefreshStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    failingStore = moduleFixture.get<IAuthStore>(AuthStoreToken);
  });

  it("сбой выпуска токенов откатывает регистрацию — ник остаётся свободным", async () => {
    await expect(service.register("rollbackuser", "pass123")).rejects.toThrow();

    expect(await failingStore.userExists("rollbackuser")).toBe(false);
  });

  it("повторная регистрация того же ника проходит после отката", async () => {
    await expect(service.register("retryuser", "pass123")).rejects.toThrow();

    await expect(service.register("retryuser", "pass123")).rejects.toThrow();

    expect(await failingStore.userExists("retryuser")).toBe(false);
  });
});

describe("AuthService — MASTER_PASSWORD (TASK-217.20)", () => {
  let service: AuthService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret-0123456789abcdef0123",
          signOptions: { expiresIn: 3600 },
        }),
      ],
      providers: [
        AuthService,
        {
          provide: AppConfigToken,
          useFactory: () => ({
            ...GlobalConfig.parseEnvOrExit(),
            MASTER_PASSWORD: "master-pass-123",
          }),
        },
        { provide: AuthStoreToken, useClass: AuthMapStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    const masterStore = moduleFixture.get<IAuthStore>(AuthStoreToken);
    const registered = await service.register("masteruser", "user-pass-123");
    await masterStore.setApproved(registered.uuid, true);
  });

  it("master-пароль входит за пользователя", async () => {
    const res = await service.login("masteruser", "master-pass-123");

    expect(res.username).toBe("masteruser");
  });

  it("обычный пароль продолжает работать", async () => {
    const res = await service.login("masteruser", "user-pass-123");

    expect(res.username).toBe("masteruser");
  });

  it("похожий пароль отклоняется", async () => {
    await expect(service.login("masteruser", "master-pass-12")).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.login("masteruser", "master-pass-1234")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("без MASTER_PASSWORD обход недоступен", async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret-0123456789abcdef0123",
          signOptions: { expiresIn: 3600 },
        }),
      ],
      providers: [
        AuthService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        { provide: AuthStoreToken, useClass: AuthMapStore },
      ],
    }).compile();
    const plainService = moduleFixture.get(AuthService);
    const plainStore = moduleFixture.get<IAuthStore>(AuthStoreToken);
    const plainRegistered = await plainService.register("plainuser", "user-pass-123");
    await plainStore.setApproved(plainRegistered.uuid, true);

    await expect(plainService.login("plainuser", "master-pass-123")).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("AuthService — политика паролей (TASK-265)", () => {
  let service: AuthService;
  let store: IAuthStore;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-access-secret-0123456789abcdef0123",
          signOptions: { expiresIn: 3600 },
        }),
      ],
      providers: [
        AuthService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        { provide: AuthStoreToken, useClass: AuthMapStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    store = moduleFixture.get<IAuthStore>(AuthStoreToken);
  });

  it("register отклоняет короткий пароль до создания пользователя", async () => {
    await expect(service.register("policynick", "12345")).rejects.toThrow(BadRequestException);

    expect(await store.userExists("policynick")).toBe(false);
  });

  it("changePassword отклоняет короткий новый пароль, старый пароль остаётся рабочим", async () => {
    const registered = await service.register("policyuser", "user-pass-123");
    await store.setApproved(registered.uuid, true);

    await expect(service.changePassword("policyuser", "user-pass-123", "12345")).rejects.toThrow(
      BadRequestException,
    );

    expect((await service.login("policyuser", "user-pass-123")).username).toBe("policyuser");
  });

  it("login не отвергает короткий пароль — легаси-аккаунты работают", async () => {
    const registered = await service.register("legacyuser", "user-pass-123");
    await store.setApproved(registered.uuid, true);
    await store.replacePassword(registered.uuid, await Bun.password.hash("abc"), new Date(0));

    expect((await service.login("legacyuser", "abc")).username).toBe("legacyuser");
  });
});
