import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildTestPng } from "../../utils/tests/test-png";
import { chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import { BadRequestException } from "@nestjs/common";
import { UserContentService } from "../user-content.service";
import {
  UserContentMapStore,
  type ContentDeletionResult,
  type ContentType,
} from "../user_content_store";
import { YggdrasilMapStore } from "../../yggdrasil/service/yggdrasil_store";
import { MemoryDb } from "../../memory/memory-db";
import GlobalConfig, { type AppConfigType } from "../../config/global-config";

const MAX_SKINS = 2;
const pngBytes = (variant: number): Uint8Array => new Uint8Array(buildTestPng({ variant }));
const capeBytes = (variant: number): Uint8Array =>
  new Uint8Array(buildTestPng({ width: 64, height: 32, variant }));

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const expectedTexturePath = (prefix: string, bytes: Uint8Array): string => {
  return `public/textures/${prefix}-${sha256(bytes)}.png`;
};

describe("UserContentService — лимит загрузок", (): void => {
  let service: UserContentService;
  let store: UserContentMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: String(MAX_SKINS),
    });
    store = new UserContentMapStore();
    service = new UserContentService(store, config);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  it("параллельные загрузки не обходят лимит скинов", async () => {
    const uuid = "race-user-0001";
    const buffers = Array.from({ length: 6 }, (_, i) => pngBytes(i + 1));
    for (const buffer of buffers) trackFile(expectedTexturePath("raceuser", buffer));

    const results = await Promise.allSettled(
      buffers.map((buffer) => service.uploadSkin(uuid, "raceuser", buffer)),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result) => result.status === "rejected" && result.reason instanceof BadRequestException,
    );

    expect(fulfilled.length).toBe(MAX_SKINS);
    expect(rejected.length).toBe(6 - MAX_SKINS);
    expect((await store.findByUserUuid(uuid, "skin")).length).toBe(MAX_SKINS);
  });

  it("последовательная загрузка свыше лимита отклоняется", async () => {
    const uuid = "seq-user-0002";
    const first = await service.uploadSkin(uuid, "sequser", pngBytes(10));
    const second = await service.uploadSkin(uuid, "sequser", pngBytes(11));
    trackFile(`public/${first.url.replace(`${config.BASE_URL}/`, "")}`);
    trackFile(`public/${second.url.replace(`${config.BASE_URL}/`, "")}`);

    await expect(service.uploadSkin(uuid, "sequser", pngBytes(12))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await store.findByUserUuid(uuid, "skin")).length).toBe(MAX_SKINS);
  });
});

describe("UserContentService — нейминг файлов и условный unlink", (): void => {
  let service: UserContentService;
  let store: UserContentMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: "2",
    });
    store = new UserContentMapStore();
    service = new UserContentService(store, config);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  it("имя нового файла содержит префикс ника и хеш контента", async () => {
    const bytes = pngBytes(21);
    const upload = await service.uploadSkin("naming-user-0001", "naminguser", bytes);
    trackFile(localPathOf(upload.url));

    expect(upload.url).toBe(`${config.BASE_URL}/textures/naminguser-${sha256(bytes)}.png`);
    expect(existsSync(localPathOf(upload.url))).toBe(true);
  });

  it("одинаковый контент разных пользователей пишет разные файлы", async () => {
    const bytes = pngBytes(22);
    const first = await service.uploadSkin("share-user-0001", "firstuser", bytes);
    const second = await service.uploadSkin("share-user-0002", "seconduser", bytes);
    trackFile(localPathOf(first.url));
    trackFile(localPathOf(second.url));

    expect(first.url).not.toBe(second.url);
    expect(existsSync(localPathOf(first.url))).toBe(true);
    expect(existsSync(localPathOf(second.url))).toBe(true);

    await service.delete("share-user-0001", first.id, "skin");
    expect(existsSync(localPathOf(first.url))).toBe(false);
    expect(existsSync(localPathOf(second.url))).toBe(true);

    await service.delete("share-user-0002", second.id, "skin");
    expect(existsSync(localPathOf(second.url))).toBe(false);
  });

  it("повторная загрузка того же контента юзером: файл живёт до удаления последней ссылки", async () => {
    const bytes = pngBytes(23);
    const userUuid = "dup-user-0001";
    const first = await service.uploadSkin(userUuid, "dupuser", bytes);
    const second = await service.uploadSkin(userUuid, "dupuser", bytes);
    trackFile(localPathOf(first.url));

    expect(first.url).toBe(second.url);

    await service.delete(userUuid, first.id, "skin");
    expect(existsSync(localPathOf(first.url))).toBe(true);

    await service.delete(userUuid, second.id, "skin");
    expect(existsSync(localPathOf(first.url))).toBe(false);
  });

  it("легаси hash-файл с общими ссылками удаляется только с последней строкой", async () => {
    const bytes = pngBytes(24);
    const legacyUrl = `${config.BASE_URL}/textures/${sha256(bytes)}.png`;
    const legacyPath = `public/textures/${sha256(bytes)}.png`;
    await Bun.write(legacyPath, bytes);
    trackFile(legacyPath);

    const first = await store.save("legacy-user-0001", legacyUrl, "skin");
    const second = await store.save("legacy-user-0002", legacyUrl, "skin");

    await service.delete("legacy-user-0001", first.id, "skin");
    expect(existsSync(legacyPath)).toBe(true);

    await service.delete("legacy-user-0002", second.id, "skin");
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("небезопасный ник санитизируется в префиксе имени файла", async () => {
    const bytes = pngBytes(25);
    const upload = await service.uploadSkin("evil-user-0001", "../evil user", bytes);
    trackFile(localPathOf(upload.url));

    expect(upload.url).toContain("/textures/eviluser-");
  });
});

describe("UserContentService — откат при сбоях атомарности", (): void => {
  let service: UserContentService;
  let store: UserContentMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: "2",
    });
    store = new UserContentMapStore();
    service = new UserContentService(store, config);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  it("при сбое записи файла запись в БД откатывается", async () => {
    const userUuid = "rb-upload-0001";
    const dirMode = statSync("public/textures").mode & 0o777;
    chmodSync("public/textures", 0o555);
    try {
      await expect(service.uploadSkin(userUuid, "rbupload", pngBytes(41))).rejects.toThrow();
    } finally {
      chmodSync("public/textures", dirMode);
    }

    expect((await store.findByUserUuid(userUuid, "skin")).length).toBe(0);
  });

  it("при сбое синхронизации профиля активный скин откатывается к предыдущему", async () => {
    const userUuid = "rb-active-0001";
    const first = await service.uploadSkin(userUuid, "rbactive", pngBytes(51));
    const second = await service.uploadSkin(userUuid, "rbactive", pngBytes(52));
    trackFile(localPathOf(first.url));
    trackFile(localPathOf(second.url));

    await service.setActiveSkin(userUuid, first.id);

    const failingProfiles = new FailingTextureSyncStore();
    await failingProfiles.saveProfile({
      uuid: userUuid,
      userId: userUuid,
      username: "rbactive",
    });
    const failingService = new UserContentService(store, config, failingProfiles);

    await expect(failingService.setActiveSkin(userUuid, second.id)).rejects.toThrow();

    const skins = await store.findByUserUuid(userUuid, "skin");
    const active = skins.filter((item) => item.active);
    expect(active.map((item) => item.id)).toEqual([first.id]);
  });

  it("при сбое синхронизации и отсутствии активного скина все остаются неактивными", async () => {
    const userUuid = "rb-none-0001";
    const upload = await service.uploadSkin(userUuid, "rbnone", pngBytes(61));
    trackFile(localPathOf(upload.url));

    const failingProfiles = new FailingTextureSyncStore();
    await failingProfiles.saveProfile({
      uuid: userUuid,
      userId: userUuid,
      username: "rbnone",
    });
    const failingService = new UserContentService(store, config, failingProfiles);

    await expect(failingService.setActiveSkin(userUuid, upload.id)).rejects.toThrow();

    const skins = await store.findByUserUuid(userUuid, "skin");
    expect(skins.every((item) => !item.active)).toBe(true);
  });
});

describe("UserContentService — unlink с учётом профильных ссылок", (): void => {
  let service: UserContentService;
  let store: UserContentMapStore;
  let profileStore: YggdrasilMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: "2",
      MAX_CAPES_PER_USER: "2",
    });
    store = new UserContentMapStore();
    profileStore = new YggdrasilMapStore();
    service = new UserContentService(store, config, profileStore);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  it("удаление активного скина, на который ссылался профиль, физически удаляет файл", async () => {
    const bytes = pngBytes(31);
    const userUuid = "prof-skin-0001";
    const upload = await service.uploadSkin(userUuid, "profskin", bytes);
    trackFile(localPathOf(upload.url));
    await profileStore.saveProfile({ uuid: userUuid, userId: userUuid, username: "profskin" });
    await service.setActiveSkin(userUuid, upload.id);
    expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBe(upload.url);

    await service.delete(userUuid, upload.id, "skin");

    expect(existsSync(localPathOf(upload.url))).toBe(false);
    expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBeNull();
  });

  it("удаление плаща, на который ссылался профиль, физически удаляет файл", async () => {
    const bytes = capeBytes(32);
    const userUuid = "prof-cape-0001";
    await profileStore.saveProfile({ uuid: userUuid, userId: userUuid, username: "profcape" });
    const upload = await service.uploadCape(userUuid, "profcape", bytes);
    trackFile(localPathOf(upload.url));
    expect((await profileStore.findProfileByUuid(userUuid))?.capeUrl).toBe(upload.url);

    await service.delete(userUuid, upload.id, "cape");

    expect(existsSync(localPathOf(upload.url))).toBe(false);
    expect((await profileStore.findProfileByUuid(userUuid))?.capeUrl).toBeNull();
  });

  it("файл скина не удаляется, пока профиль реально ссылается на него", async () => {
    const bytes = pngBytes(35);
    const userUuid = "prof-skin-0002";
    const upload = await service.uploadSkin(userUuid, "profskin2", bytes);
    trackFile(localPathOf(upload.url));
    await profileStore.saveProfile({
      uuid: userUuid,
      userId: userUuid,
      username: "profskin2",
      skinUrl: upload.url,
    });

    await service.delete(userUuid, upload.id, "skin");

    expect(existsSync(localPathOf(upload.url))).toBe(true);
    expect(await store.countByFilePath(upload.url, "skin")).toBe(0);
  });

  it("файл не удаляется, пока на него ссылается профиль другого пользователя", async () => {
    const bytes = pngBytes(34);
    const ownerUuid = "prof-owner-0001";
    const otherUuid = "prof-other-0001";
    const upload = await service.uploadSkin(ownerUuid, "profowner", bytes);
    trackFile(localPathOf(upload.url));
    await profileStore.saveProfile({ uuid: ownerUuid, userId: ownerUuid, username: "profowner" });
    await service.setActiveSkin(ownerUuid, upload.id);
    await profileStore.saveProfile({
      uuid: otherUuid,
      userId: otherUuid,
      username: "profother",
      skinUrl: upload.url,
    });

    await service.delete(ownerUuid, upload.id, "skin");

    expect(existsSync(localPathOf(upload.url))).toBe(true);
  });

  it("файл удаляется, когда профильных ссылок на него нет", async () => {
    const bytes = pngBytes(33);
    const userUuid = "prof-free-0001";
    await profileStore.saveProfile({
      uuid: userUuid,
      userId: userUuid,
      username: "proffree",
    });
    const upload = await service.uploadSkin(userUuid, "proffree", bytes);
    trackFile(localPathOf(upload.url));

    await service.delete(userUuid, upload.id, "skin");

    expect(existsSync(localPathOf(upload.url))).toBe(false);
  });
});

describe("UserContentService — удаление скинов и активность", (): void => {
  let service: UserContentService;
  let store: UserContentMapStore;
  let profileStore: YggdrasilMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: "3",
    });
    store = new UserContentMapStore();
    profileStore = new YggdrasilMapStore();
    service = new UserContentService(store, config, profileStore);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  const uploadThree = async (userUuid: string, username: string) => {
    const first = await service.uploadSkin(userUuid, username, pngBytes(71));
    const second = await service.uploadSkin(userUuid, username, pngBytes(72));
    const third = await service.uploadSkin(userUuid, username, pngBytes(73));
    for (const upload of [first, second, third]) trackFile(localPathOf(upload.url));
    return { first, second, third };
  };

  it("удаление неактивного скина не меняет активный и skinUrl профиля", async () => {
    const userUuid = "del-inactive-0001";
    const username = "delinactive";
    const { first, second, third } = await uploadThree(userUuid, username);
    await profileStore.saveProfile({ uuid: userUuid, userId: userUuid, username });
    await service.setActiveSkin(userUuid, first.id);
    expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBe(first.url);

    try {
      await service.delete(userUuid, second.id, "skin");

      const skins = await store.findByUserUuid(userUuid, "skin");
      expect(skins.filter((item) => item.active).map((item) => item.id)).toEqual([first.id]);
      expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBe(first.url);
    } finally {
      await service.delete(userUuid, first.id, "skin");
      await service.delete(userUuid, third.id, "skin");
    }
  });

  it("удаление активного скина переводит активность и профиль на последний оставшийся", async () => {
    const userUuid = "del-active-0001";
    const username = "delactive";
    const { first, second, third } = await uploadThree(userUuid, username);
    await profileStore.saveProfile({ uuid: userUuid, userId: userUuid, username });
    await service.setActiveSkin(userUuid, first.id);

    await service.delete(userUuid, first.id, "skin");

    const skins = await store.findByUserUuid(userUuid, "skin");
    expect(skins.filter((item) => item.active).map((item) => item.id)).toEqual([third.id]);
    expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBe(third.url);

    await service.delete(userUuid, second.id, "skin");
    await service.delete(userUuid, third.id, "skin");
  });

  it("удаление последнего скина обнуляет skinUrl профиля", async () => {
    const userUuid = "del-last-0001";
    const username = "dellast";
    const first = await service.uploadSkin(userUuid, username, pngBytes(74));
    trackFile(localPathOf(first.url));
    await profileStore.saveProfile({ uuid: userUuid, userId: userUuid, username });
    await service.setActiveSkin(userUuid, first.id);

    await service.delete(userUuid, first.id, "skin");

    expect((await store.findByUserUuid(userUuid, "skin")).length).toBe(0);
    expect((await profileStore.findProfileByUuid(userUuid))?.skinUrl).toBeNull();
  });

  it("откат setActiveSkin не перетирает конкурентную активацию другого скина", async () => {
    const userUuid = "race-active-0001";
    const username = "raceactive";
    const { first, second, third } = await uploadThree(userUuid, username);
    const okProfiles = new YggdrasilMapStore();
    const gatedProfiles = new GatedTextureSyncStore();
    await okProfiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    await gatedProfiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    const okService = new UserContentService(store, config, okProfiles);
    const racingService = new UserContentService(store, config, gatedProfiles);
    await okService.setActiveSkin(userUuid, first.id);

    const started = deferred();
    const gate = deferred();
    gatedProfiles.onSync = async () => {
      started.resolve();
      await gate.promise;
    };

    const pendingActivation = racingService.setActiveSkin(userUuid, second.id);
    await started.promise;

    const pendingGood = okService.setActiveSkin(userUuid, third.id);
    gate.resolve();

    await expect(pendingActivation).rejects.toThrow("Синхронизация профиля недоступна");
    await pendingGood;

    const skins = await store.findByUserUuid(userUuid, "skin");
    expect(skins.filter((item) => item.active).map((item) => item.id)).toEqual([third.id]);
    expect((await okProfiles.findProfileByUuid(userUuid))?.skinUrl).toBe(third.url);
  });

  it("интерливинг двух смен даёт согласованные active и skinUrl профиля", async () => {
    const userUuid = "il-active-0001";
    const username = "ilactive";
    const { first, second, third } = await uploadThree(userUuid, username);
    const profiles = new GatedNextSyncStore();
    await profiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    const gatedService = new UserContentService(store, config, profiles);
    await gatedService.setActiveSkin(userUuid, first.id);

    profiles.armGate();
    const changeA = gatedService.setActiveSkin(userUuid, second.id);
    await profiles.waitGateStarted();
    const changeB = gatedService.setActiveSkin(userUuid, third.id);
    profiles.releaseGate();

    await changeA;
    await changeB;

    const skins = await store.findByUserUuid(userUuid, "skin");
    expect(skins.filter((item) => item.active).map((item) => item.id)).toEqual([third.id]);
    expect((await profiles.findProfileByUuid(userUuid))?.skinUrl).toBe(third.url);
  });
});

describe("UserContentService — откат загрузки плаща при сбое синка профиля", (): void => {
  let store: UserContentMapStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_CAPES_PER_USER: "2",
    });
    store = new UserContentMapStore();
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  it("при сбое синка профиля строка и файл плаща откатываются", async () => {
    const userUuid = "rb-cape-0001";
    const username = "rbcape";
    const bytes = capeBytes(91);
    trackFile(`public/capes/${username}-${sha256(bytes)}.png`);

    const failingProfiles = new FailingTextureSyncStore();
    await failingProfiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    const failingService = new UserContentService(store, config, failingProfiles);

    await expect(failingService.uploadCape(userUuid, username, bytes)).rejects.toThrow(
      "Синхронизация профиля недоступна",
    );

    expect((await store.findByUserUuid(userUuid, "cape")).length).toBe(0);
    expect(
      existsSync(localPathOf(`${config.BASE_URL}/capes/${username}-${sha256(bytes)}.png`)),
    ).toBe(false);
  });

  it("повторная загрузка того же плаща после сбоя создаёт одну строку", async () => {
    const userUuid = "rb-cape-0002";
    const username = "rbcape2";
    const bytes = capeBytes(92);
    trackFile(`public/capes/${username}-${sha256(bytes)}.png`);

    const failingProfiles = new FailingTextureSyncStore();
    await failingProfiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    const profiles = new YggdrasilMapStore();
    await profiles.saveProfile({ uuid: userUuid, userId: userUuid, username });
    const failingService = new UserContentService(store, config, failingProfiles);
    const okService = new UserContentService(store, config, profiles);

    await expect(failingService.uploadCape(userUuid, username, bytes)).rejects.toThrow();

    const upload = await okService.uploadCape(userUuid, username, bytes);
    const capes = await store.findByUserUuid(userUuid, "cape");
    expect(capes.length).toBe(1);
    expect(capes[0]?.filePath).toBe(upload.url);
    expect(existsSync(localPathOf(upload.url))).toBe(true);
    expect((await profiles.findProfileByUuid(userUuid))?.capeUrl).toBe(upload.url);
  });
});

describe("UserContentService — сериализация операций над одним файлом", (): void => {
  let service: UserContentService;
  let store: GatedDeleteStore;
  let config: AppConfigType;
  const writtenFiles: string[] = [];

  beforeAll(() => {
    config = GlobalConfig.parseEnvOrExit({
      ...process.env,
      MAX_SKINS_PER_USER: "2",
    });
    store = new GatedDeleteStore();
    service = new UserContentService(store, config);
  });

  afterAll(() => {
    for (const filePath of writtenFiles) {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  const trackFile = (filePath: string): void => {
    if (!writtenFiles.includes(filePath)) writtenFiles.push(filePath);
  };

  const localPathOf = (url: string): string => `public/${url.replace(`${config.BASE_URL}/`, "")}`;

  it("загрузка ждёт завершения удаления того же файла — нет битых ссылок", async () => {
    const userUuid = "race-path-0001";
    const username = "racepath";
    const bytes = pngBytes(101);
    const upload = await service.uploadSkin(userUuid, username, bytes);
    const localPath = localPathOf(upload.url);
    trackFile(localPath);

    const started = deferred();
    const gate = deferred();
    store.onDelete = async () => {
      started.resolve();
      await gate.promise;
    };

    const pendingDelete = service.delete(userUuid, upload.id, "skin");
    await started.promise;

    const racingUpload = service.uploadSkin(userUuid, username, bytes);
    expect(await store.countByFilePath(upload.url, "skin")).toBe(0);
    expect(existsSync(localPath)).toBe(true);

    gate.resolve();
    await pendingDelete;
    await racingUpload;

    expect(await store.countByFilePath(upload.url, "skin")).toBe(1);
    expect(existsSync(localPath)).toBe(true);
  });
});

describe("UserContentService — тексты ошибок удаления", (): void => {
  let service: UserContentService;

  beforeAll(() => {
    const config = GlobalConfig.parseEnvOrExit({ ...process.env });
    service = new UserContentService(new UserContentMapStore(), config);
  });

  it("404 называет тип контента в именительном падеже", async () => {
    await expect(service.delete("notfound-user-0001", 1, "skin")).rejects.toThrow("Скин не найден");
    await expect(service.delete("notfound-user-0001", 1, "cape")).rejects.toThrow("Плащ не найден");
    await expect(service.delete("notfound-user-0001", 1, "model")).rejects.toThrow(
      "Модель не найдена",
    );
  });
});

class GatedTextureSyncStore extends YggdrasilMapStore {
  onSync: (() => Promise<void>) | undefined;

  constructor() {
    super(new MemoryDb());
  }

  override async updateProfileTexture(): Promise<void> {
    if (this.onSync) await this.onSync();
    throw new Error("Синхронизация профиля недоступна");
  }
}

class GatedNextSyncStore extends YggdrasilMapStore {
  private armed = false;
  private readonly gateStarted = deferred();
  private readonly gate = deferred();

  constructor() {
    super(new MemoryDb());
  }

  armGate(): void {
    this.armed = true;
  }

  releaseGate(): void {
    this.gate.resolve();
  }

  async waitGateStarted(): Promise<void> {
    await this.gateStarted.promise;
  }

  override async updateProfileTexture(
    uuid: string,
    textures: Parameters<YggdrasilMapStore["updateProfileTexture"]>[1],
  ): Promise<void> {
    if (this.armed) {
      this.armed = false;
      this.gateStarted.resolve();
      await this.gate.promise;
    }
    return super.updateProfileTexture(uuid, textures);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FailingTextureSyncStore extends YggdrasilMapStore {
  constructor() {
    super(new MemoryDb());
  }

  override async updateProfileTexture(): Promise<void> {
    throw new Error("Синхронизация профиля недоступна");
  }
}

class GatedDeleteStore extends UserContentMapStore {
  onDelete: (() => Promise<void>) | undefined;

  override async deleteByIdAndCountRemaining(
    id: number,
    type: ContentType,
  ): Promise<ContentDeletionResult | undefined> {
    const result = await super.deleteByIdAndCountRemaining(id, type);
    if (this.onDelete) await this.onDelete();
    return result;
  }
}
