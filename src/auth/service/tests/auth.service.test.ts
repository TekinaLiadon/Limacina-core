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

class FlakyAuthStore extends AuthMapStore {
  failNextSaveRefresh = false;
  failReplacePassword = false;
  savedRefreshJtis: string[] = [];

  constructor() {
    super(new MemoryDb());
  }

  override async saveRefresh(
    jti: string,
    entry: { userId: string; username: string },
    expiresAt: Date,
  ): Promise<void> {
    if (this.failNextSaveRefresh) {
      this.failNextSaveRefresh = false;
      throw new Error("saveRefresh недоступен");
    }
    this.savedRefreshJtis.push(jti);
    await super.saveRefresh(jti, entry, expiresAt);
  }

  override async replacePassword(
    uuid: string,
    passwordHash: string,
    changedAt: Date,
    keepRefreshJti?: string,
    expectedRole?: string,
  ): Promise<boolean> {
    if (this.failReplacePassword) {
      this.failReplacePassword = false;
      throw new Error("replacePassword недоступен");
    }
    return super.replacePassword(uuid, passwordHash, changedAt, keepRefreshJti, expectedRole);
  }
}

describe("AuthService — атомарность регистрации", () => {
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

describe("AuthService — MASTER_PASSWORD", () => {
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

describe("AuthService — политика паролей", () => {
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

describe("AuthService — восстановление сессии при сбоях", () => {
  let service: AuthService;
  let store: FlakyAuthStore;

  const firstSavedJti = (): string => store.savedRefreshJtis[0] as string;

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
        { provide: AuthStoreToken, useClass: FlakyAuthStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    store = moduleFixture.get<IAuthStore>(AuthStoreToken) as FlakyAuthStore;
  });

  it("сбой выпуска пары после claim восстанавливает refresh-токен — сессия не теряется", async () => {
    store.savedRefreshJtis = [];
    const registered = await service.register("refreshrb", "user-pass-123");
    await store.setApproved(registered.uuid, true);
    const originalJti = firstSavedJti();

    store.failNextSaveRefresh = true;
    try {
      await expect(service.refresh(registered.tokens.refresh_token)).rejects.toThrow(
        "saveRefresh недоступен",
      );
    } finally {
      store.failNextSaveRefresh = false;
    }

    expect(await store.findRefresh(originalJti)).toBeDefined();
    const retry = await service.refresh(registered.tokens.refresh_token);
    expect(retry.uuid).toBe(registered.uuid);
  });

  it("успешный changePassword отзывает старую сессию и оставляет новую", async () => {
    store.savedRefreshJtis = [];
    const registered = await service.register("passchange", "user-pass-123");
    await store.setApproved(registered.uuid, true);
    const oldJti = firstSavedJti();

    const changed = await service.changePassword("passchange", "user-pass-123", "new-pass-456");

    expect(await store.findRefresh(oldJti)).toBeUndefined();
    expect(changed.tokens.refresh_token).not.toBe(registered.tokens.refresh_token);
    expect((await service.login("passchange", "new-pass-456")).username).toBe("passchange");
    expect((await service.refresh(changed.tokens.refresh_token)).uuid).toBe(registered.uuid);
  });

  it("сбой replacePassword при смене пароля не оставляет пользователя без сессий", async () => {
    store.savedRefreshJtis = [];
    const registered = await service.register("passrb", "user-pass-123");
    await store.setApproved(registered.uuid, true);
    const oldJti = firstSavedJti();

    store.failReplacePassword = true;
    try {
      await expect(
        service.changePassword("passrb", "user-pass-123", "broken-pass-789"),
      ).rejects.toThrow("replacePassword недоступен");
    } finally {
      store.failReplacePassword = false;
    }

    expect(await store.findRefresh(oldJti)).toBeDefined();
    const retry = await service.refresh(registered.tokens.refresh_token);
    expect(retry.uuid).toBe(registered.uuid);
    expect((await service.login("passrb", "user-pass-123")).username).toBe("passrb");
  });
});

describe("AuthService — заголовок X-Launcher-Id при логине", () => {
  const INSTALL_ID = "v1-0123456789abcdef0123456789abcdef";
  const OTHER_INSTALL_ID = "v1-fedcba0987654321fedcba0987654321";
  let service: AuthService;
  let store: IAuthStore;
  let installDb: MemoryDb;
  let userUuid: string;

  beforeAll(async () => {
    installDb = new MemoryDb();
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
        { provide: MemoryDb, useValue: installDb },
        { provide: AuthStoreToken, useClass: AuthMapStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    store = moduleFixture.get<IAuthStore>(AuthStoreToken);
    const registered = await service.register("headeruser", "user-pass-123");
    await store.setApproved(registered.uuid, true);
    userUuid = registered.uuid;
  });

  it("логин с валидным заголовком сохраняет ID установки", async () => {
    const res = await service.login("headeruser", "user-pass-123", INSTALL_ID);

    expect(res.uuid).toBe(userUuid);
    expect(installDb.installIds.get(userUuid)).toEqual({ current: INSTALL_ID, history: [] });
  });

  it("логин без заголовка не меняет сохранённый ID", async () => {
    await service.login("headeruser", "user-pass-123");

    expect(installDb.installIds.get(userUuid)).toEqual({ current: INSTALL_ID, history: [] });
  });

  it("невалидный заголовок игнорируется, логин проходит", async () => {
    const res = await service.login("headeruser", "user-pass-123", "spoofed-value");

    expect(res.uuid).toBe(userUuid);
    expect(installDb.installIds.get(userUuid)).toEqual({ current: INSTALL_ID, history: [] });
  });

  it("смена ID сдвигает предыдущий в историю", async () => {
    await service.login("headeruser", "user-pass-123", OTHER_INSTALL_ID);

    expect(installDb.installIds.get(userUuid)).toEqual({
      current: OTHER_INSTALL_ID,
      history: [INSTALL_ID],
    });
  });
});

describe("AuthService — сбой записи X-Launcher-Id не ломает логин", () => {
  class FailingInstallStore extends AuthMapStore {
    override async recordInstallId(): Promise<void> {
      throw new Error("recordInstallId недоступен");
    }
  }

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
        { provide: AuthStoreToken, useClass: FailingInstallStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    store = moduleFixture.get<IAuthStore>(AuthStoreToken);
    const registered = await service.register("failinstall", "user-pass-123");
    await store.setApproved(registered.uuid, true);
  });

  it("логин успешен и выдаёт токены при недоступной записи ID", async () => {
    const res = await service.login(
      "failinstall",
      "user-pass-123",
      "v1-0123456789abcdef0123456789abcdef",
    );

    expect(res.tokens.access_token).toBeDefined();
    expect(res.tokens.refresh_token).toBeDefined();
  });
});

describe("AuthService — статусы аккаунта при логине", () => {
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
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        { provide: AuthStoreToken, useClass: AuthMapStore },
      ],
    }).compile();

    service = moduleFixture.get(AuthService);
    const store = moduleFixture.get<IAuthStore>(AuthStoreToken);
    await service.register("pendinglogin", "pass123");
    const banned = await service.register("bannedlogin", "pass123");
    await store.setApproved(banned.uuid, true);
    await store.setBanned(banned.uuid, true);
  });

  it("логин неодобренного аккаунта с верным паролем объясняет ожидание одобрения", async () => {
    await expect(service.login("pendinglogin", "pass123")).rejects.toThrow(
      "Аккаунт ожидает одобрения администратором",
    );
  });

  it("неверный пароль неодобренного аккаунта отвечает общим сообщением", async () => {
    await expect(service.login("pendinglogin", "wrongpass")).rejects.toThrow(
      "Неверное имя пользователя или пароль",
    );
  });

  it("логин забаненного аккаунта с верным паролем отвечает общим сообщением", async () => {
    await expect(service.login("bannedlogin", "pass123")).rejects.toThrow(
      "Неверное имя пользователя или пароль",
    );
  });
});
