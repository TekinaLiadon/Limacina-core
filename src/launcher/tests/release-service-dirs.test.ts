import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  buildReplacedZipName,
  buildReleaseBackupName,
  buildReleaseLockName,
  buildReleaseStagingName,
  cleanupReleaseServiceDirs,
  isReleaseServiceEntry,
  isZipReplacedEntry,
  parseReleaseBackupEntry,
  recoverReleaseBackups,
} from "../release-service-dirs";

const TEST_ROOT = join("tmp", `release-service-dirs-${randomUUID()}`);
const logger = new Logger("ReleaseServiceDirsTest");

const ageEntry = (entry: string): void => {
  const past = new Date(Date.now() - 2 * 60 * 60_000);
  utimesSync(join(TEST_ROOT, entry), past, past);
};

describe("release-service-dirs — служебные имена", (): void => {
  it("служебные имена начинаются с точки и потому не раздаются статикой", (): void => {
    expect(buildReleaseStagingName("abc")).toBe(".staging-abc");
    expect(buildReleaseLockName("1.2.3")).toBe(".lock-1.2.3");
    expect(buildReleaseBackupName("1.2.3", "abc")).toBe(".old-1.2.3-abc");
    expect(buildReplacedZipName("Limacina-1.2.3-linux-x86_64.zip")).toBe(
      ".Limacina-1.2.3-linux-x86_64.zip.replaced",
    );
  });

  it("isReleaseServiceEntry матчит staging, lock и backup-имена обоих форматов", (): void => {
    expect(isReleaseServiceEntry(".staging-abc")).toBe(true);
    expect(isReleaseServiceEntry(".lock-1.2.3")).toBe(true);
    expect(isReleaseServiceEntry(buildReleaseBackupName("1.2.3", randomUUID()))).toBe(true);
    expect(isReleaseServiceEntry(`1.2.3.old-${randomUUID()}`)).toBe(true);
    expect(isReleaseServiceEntry("1.2.3")).toBe(false);
    expect(isReleaseServiceEntry("1.2.3-old")).toBe(false);
  });

  it("isZipReplacedEntry матчит replaced-имена обоих форматов", (): void => {
    expect(isZipReplacedEntry(buildReplacedZipName("a.zip"))).toBe(true);
    expect(isZipReplacedEntry("a.zip.replaced")).toBe(true);
    expect(isZipReplacedEntry("a.zip")).toBe(false);
    expect(isZipReplacedEntry(".replaced-dir/a.zip")).toBe(false);
  });

  it("parseReleaseBackupEntry разбирает оба формата имён бэкапа", (): void => {
    const id = randomUUID();
    expect(parseReleaseBackupEntry(buildReleaseBackupName("1.2.3", id))).toBe("1.2.3");
    expect(parseReleaseBackupEntry(`1.2.3.old-${id}`)).toBe("1.2.3");
  });

  it("parseReleaseBackupEntry отбрасывает имена без валидной версии или uuid", (): void => {
    expect(parseReleaseBackupEntry(`.old-${randomUUID()}`)).toBeNull();
    expect(parseReleaseBackupEntry(`not-a-version.old-${randomUUID()}`)).toBeNull();
    expect(parseReleaseBackupEntry(`.old-not-a-version-${randomUUID()}`)).toBeNull();
    expect(parseReleaseBackupEntry(`.old-1.2.3-not-a-uuid`)).toBeNull();
    expect(parseReleaseBackupEntry(`.old-1.2.3-`)).toBeNull();
    expect(parseReleaseBackupEntry("1.2.3")).toBeNull();
  });
});

describe("release-service-dirs — восстановление после crash-окна swapReleaseDir", (): void => {
  beforeAll((): void => {
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterAll((): void => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("возвращает бэкап нового формата на место, если каталог версии отсутствует", (): void => {
    const backupName = buildReleaseBackupName("5.0.0", randomUUID());
    mkdirSync(join(TEST_ROOT, backupName), { recursive: true });
    writeFileSync(join(TEST_ROOT, backupName, "Limacina-5.0.0-windows-x86_64.exe"), "payload");

    recoverReleaseBackups(TEST_ROOT, logger);

    expect(
      readFileSync(join(TEST_ROOT, "5.0.0", "Limacina-5.0.0-windows-x86_64.exe"), "utf-8"),
    ).toBe("payload");
    expect(existsSync(join(TEST_ROOT, backupName))).toBe(false);
  });

  it("возвращает legacy-бэкап на место, если каталог версии отсутствует", (): void => {
    const backupName = `5.0.1.old-${randomUUID()}`;
    mkdirSync(join(TEST_ROOT, backupName), { recursive: true });
    writeFileSync(join(TEST_ROOT, backupName, "Limacina-5.0.1-windows-x86_64.exe"), "legacy");

    recoverReleaseBackups(TEST_ROOT, logger);

    expect(
      readFileSync(join(TEST_ROOT, "5.0.1", "Limacina-5.0.1-windows-x86_64.exe"), "utf-8"),
    ).toBe("legacy");
    expect(existsSync(join(TEST_ROOT, backupName))).toBe(false);
  });

  it("не трогает бэкап, если каталог версии уже опубликован", (): void => {
    const backupName = buildReleaseBackupName("5.0.2", randomUUID());
    mkdirSync(join(TEST_ROOT, backupName), { recursive: true });
    mkdirSync(join(TEST_ROOT, "5.0.2"), { recursive: true });

    try {
      recoverReleaseBackups(TEST_ROOT, logger);

      expect(existsSync(join(TEST_ROOT, backupName))).toBe(true);
      expect(existsSync(join(TEST_ROOT, "5.0.2"))).toBe(true);
    } finally {
      rmSync(join(TEST_ROOT, backupName), { recursive: true, force: true });
      rmSync(join(TEST_ROOT, "5.0.2"), { recursive: true, force: true });
    }
  });
});

describe("release-service-dirs — чистка служебных каталогов", (): void => {
  beforeAll((): void => {
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterAll((): void => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("при старте убирает staging/lock/мусорные имена и бэкап с существующей базой, бэкап без базы оставляет", (): void => {
    const backupId = randomUUID();
    const redundantBackup = `.old-6.0.0-${backupId}`;
    const restorableBackup = `.old-6.0.1-${backupId}`;
    mkdirSync(join(TEST_ROOT, "6.0.0"), { recursive: true });
    mkdirSync(join(TEST_ROOT, redundantBackup), { recursive: true });
    mkdirSync(join(TEST_ROOT, restorableBackup), { recursive: true });
    mkdirSync(join(TEST_ROOT, ".staging-sweep-start"), { recursive: true });
    mkdirSync(join(TEST_ROOT, ".lock-6.0.0"), { recursive: true });
    mkdirSync(join(TEST_ROOT, ".old-junk"), { recursive: true });

    cleanupReleaseServiceDirs(TEST_ROOT, logger);

    expect(existsSync(join(TEST_ROOT, redundantBackup))).toBe(false);
    expect(existsSync(join(TEST_ROOT, ".staging-sweep-start"))).toBe(false);
    expect(existsSync(join(TEST_ROOT, ".lock-6.0.0"))).toBe(false);
    expect(existsSync(join(TEST_ROOT, ".old-junk"))).toBe(false);
    expect(existsSync(join(TEST_ROOT, restorableBackup))).toBe(true);
    expect(existsSync(join(TEST_ROOT, "6.0.0"))).toBe(true);
  });

  it("при публикации убирает только протухшие каталоги; свежие и бэкап без базы остаются", (): void => {
    const backupId = randomUUID();
    const staleBackup = `.old-6.1.0-${backupId}`;
    const freshBackup = `.old-6.1.1-${backupId}`;
    const restorableBackup = `.old-6.1.2-${backupId}`;
    mkdirSync(join(TEST_ROOT, "6.1.0"), { recursive: true });
    mkdirSync(join(TEST_ROOT, "6.1.1"), { recursive: true });
    mkdirSync(join(TEST_ROOT, staleBackup), { recursive: true });
    mkdirSync(join(TEST_ROOT, freshBackup), { recursive: true });
    mkdirSync(join(TEST_ROOT, restorableBackup), { recursive: true });
    mkdirSync(join(TEST_ROOT, ".staging-stale-clean"), { recursive: true });
    mkdirSync(join(TEST_ROOT, ".staging-fresh-clean"), { recursive: true });
    ageEntry(staleBackup);
    ageEntry(".staging-stale-clean");

    try {
      cleanupReleaseServiceDirs(TEST_ROOT, logger, 60 * 60_000);

      expect(existsSync(join(TEST_ROOT, staleBackup))).toBe(false);
      expect(existsSync(join(TEST_ROOT, ".staging-stale-clean"))).toBe(false);
      expect(existsSync(join(TEST_ROOT, freshBackup))).toBe(true);
      expect(existsSync(join(TEST_ROOT, ".staging-fresh-clean"))).toBe(true);
      expect(existsSync(join(TEST_ROOT, restorableBackup))).toBe(true);
    } finally {
      for (const entry of [
        freshBackup,
        restorableBackup,
        ".staging-fresh-clean",
        "6.1.0",
        "6.1.1",
      ]) {
        rmSync(join(TEST_ROOT, entry), { recursive: true, force: true });
      }
    }
  });
});
