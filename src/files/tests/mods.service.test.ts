import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ICacheStore } from "../../cache/cache_store";
import { MODS_CACHE_KEY, MODS_LIST_CACHE_TTL_MS, ModsService } from "../mods.service";

class TestCacheStore implements ICacheStore {
  readonly values = new Map<string, unknown>();
  readonly ttls = new Map<string, number | undefined>();
  readonly deleted: string[] = [];

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, ttlMs);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.deleted.push(key);
  }
}

const ROOT_DIR = join("tmp", "mods-service-test");
const MODS_DIR = join(ROOT_DIR, "mods");
const TMP_DIR = join(ROOT_DIR, "upload");

let cache: TestCacheStore;
let service: ModsService;

function writeMod(name: string, content: string): void {
  writeFileSync(join(MODS_DIR, name), content);
}

function writeTemp(name: string, content: string): string {
  const tempPath = join(TMP_DIR, name);
  writeFileSync(tempPath, content);
  return tempPath;
}

beforeEach((): void => {
  rmSync(ROOT_DIR, { recursive: true, force: true });
  mkdirSync(MODS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  cache = new TestCacheStore();
  service = new ModsService(cache, MODS_DIR, TMP_DIR);
});

afterEach((): void => {
  rmSync(ROOT_DIR, { recursive: true, force: true });
});

describe("ModsService.getMods", (): void => {
  it("отдаёт отсортированные имена и размеры файлов папки", async (): Promise<void> => {
    writeMod("b.jar", "12345");
    writeMod("a.jar", "123");
    mkdirSync(join(MODS_DIR, "nested"));
    writeMod(".hidden.jar", "x");

    expect(await service.getMods()).toEqual([
      { name: "a.jar", size: 3 },
      { name: "b.jar", size: 5 },
    ]);
  });

  it("возвращает пустой список, если папки модов нет", async (): Promise<void> => {
    rmSync(MODS_DIR, { recursive: true, force: true });

    expect(await service.getMods()).toEqual([]);
  });

  it("кеширует список на 30 секунд", async (): Promise<void> => {
    writeMod("a.jar", "123");
    await service.getMods();

    writeMod("b.jar", "456");

    expect((await service.getMods()).map((mod) => mod.name)).toEqual(["a.jar"]);
    expect(cache.ttls.get(MODS_CACHE_KEY)).toBe(MODS_LIST_CACHE_TTL_MS);
  });
});

describe("ModsService.uploadMods", (): void => {
  it("переносит файлы в папку модов и сбрасывает кеш", async (): Promise<void> => {
    await service.getMods();
    const firstTemp = writeTemp("first.part", "first-content");
    const secondTemp = writeTemp("second.part", "second-content");

    const result = await service.uploadMods([
      { name: "one.jar", tempPath: firstTemp },
      { name: "two.jar", tempPath: secondTemp },
    ]);

    expect(result).toEqual({ uploaded: ["one.jar", "two.jar"] });
    expect(readFileSync(join(MODS_DIR, "one.jar"), "utf-8")).toBe("first-content");
    expect(readFileSync(join(MODS_DIR, "two.jar"), "utf-8")).toBe("second-content");
    expect(existsSync(firstTemp)).toBeFalse();
    expect(existsSync(secondTemp)).toBeFalse();
    expect(cache.deleted).toContain(MODS_CACHE_KEY);
  });

  it("заменяет существующий мод и не оставляет бэкапов", async (): Promise<void> => {
    writeMod("replace.jar", "old-content");
    const tempPath = writeTemp("replace.part", "new-content");

    await service.uploadMods([{ name: "replace.jar", tempPath }]);

    expect(readFileSync(join(MODS_DIR, "replace.jar"), "utf-8")).toBe("new-content");
    expect(readdirSync(TMP_DIR)).toEqual([]);
  });

  it("откатывает частичную загрузку и восстанавливает заменённый файл", async (): Promise<void> => {
    writeMod("existing.jar", "old-content");
    const validTemp = writeTemp("existing.part", "new-content");
    const missingTemp = join(TMP_DIR, "missing.part");

    await expect(
      service.uploadMods([
        { name: "existing.jar", tempPath: validTemp },
        { name: "broken.jar", tempPath: missingTemp },
      ]),
    ).rejects.toBeDefined();

    expect(readFileSync(join(MODS_DIR, "existing.jar"), "utf-8")).toBe("old-content");
    expect(existsSync(join(MODS_DIR, "broken.jar"))).toBeFalse();
    expect(existsSync(validTemp)).toBeFalse();
    expect(cache.deleted).not.toContain(MODS_CACHE_KEY);
  });

  it("отклоняет загрузку поверх каталога с тем же именем", async (): Promise<void> => {
    mkdirSync(join(MODS_DIR, "blocked.jar"));
    const tempPath = writeTemp("blocked.part", "content");

    await expect(service.uploadMods([{ name: "blocked.jar", tempPath }])).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(existsSync(join(MODS_DIR, "blocked.jar"))).toBeTrue();
    expect(existsSync(tempPath)).toBeFalse();
  });

  it("отклоняет пустой список загрузки", async (): Promise<void> => {
    await expect(service.uploadMods([])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ModsService.deleteMod", (): void => {
  it("удаляет файл и сбрасывает кеш", async (): Promise<void> => {
    writeMod("remove-me.jar", "content");
    await service.getMods();

    await service.deleteMod("remove-me.jar");

    expect(existsSync(join(MODS_DIR, "remove-me.jar"))).toBeFalse();
    expect(cache.deleted).toContain(MODS_CACHE_KEY);
  });

  it("отдаёт 404 для отсутствующего мода", async (): Promise<void> => {
    await expect(service.deleteMod("missing.jar")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("отклоняет путь вне папки модов", async (): Promise<void> => {
    writeFileSync(join(ROOT_DIR, "secret.jar"), "secret");

    await expect(service.deleteMod("../secret.jar")).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(join(ROOT_DIR, "secret.jar"))).toBeTrue();
  });

  it("не удаляет каталог с именем мода", async (): Promise<void> => {
    mkdirSync(join(MODS_DIR, "folder.jar"));

    await expect(service.deleteMod("folder.jar")).rejects.toBeInstanceOf(NotFoundException);
    expect(existsSync(join(MODS_DIR, "folder.jar"))).toBeTrue();
  });
});
