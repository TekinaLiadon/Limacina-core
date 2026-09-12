process.env["NODE_ENV"] = "test";
process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
process.env["BASE_URL"] = "http://localhost:3005";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { BadRequestException } from "@nestjs/common";
import { UserContentService } from "../user-content.service";
import { UserContentMapStore } from "../user-content.store";
import GlobalConfig, { type AppConfigType } from "../../config/global-config";

const MAX_SKINS = 2;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const pngBytes = (variant: number): Uint8Array => {
  const buffer = Buffer.alloc(PNG_SIGNATURE.length + 8);
  buffer.set(PNG_SIGNATURE);
  buffer.writeUInt8(variant, PNG_SIGNATURE.length);
  return new Uint8Array(buffer);
};

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
    expect(await store.countByUserUuid(uuid, "skin")).toBe(MAX_SKINS);
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
    expect(await store.countByUserUuid(uuid, "skin")).toBe(MAX_SKINS);
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
