import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { UPLOAD_TMP_DIR } from "../../launcher/launcher-files";
import { StartupSweepService } from "../startup-sweep.service";

const RELEASES_ROOT = join("public", "releases");
const PLATFORM_DIR = join("public", "linux", "x86_64");
const PLATFORM_PARENT = join("public", "linux");

describe("StartupSweepService — свип служебных файлов при старте", (): void => {
  const service = new StartupSweepService();
  const suffix = randomUUID().slice(0, 8);
  let releasesRootCreated = false;
  let platformDirCreated = false;

  beforeAll((): void => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    writeFileSync(join(UPLOAD_TMP_DIR, `leftover-${suffix}.zip`), "staged-payload");
    writeFileSync(join(UPLOAD_TMP_DIR, `leftover-${suffix}.sig`), "staged-signature");

    if (!existsSync(RELEASES_ROOT)) {
      mkdirSync(RELEASES_ROOT, { recursive: true });
      releasesRootCreated = true;
    }
    mkdirSync(join(RELEASES_ROOT, `.staging-sweep-${suffix}`), { recursive: true });
    writeFileSync(join(RELEASES_ROOT, `.staging-sweep-${suffix}`, "half-published.exe"), "x");
    mkdirSync(join(RELEASES_ROOT, `.lock-9.9.9-sweep-${suffix}`), { recursive: true });
    mkdirSync(join(RELEASES_ROOT, `junk-${suffix}.old-x`), { recursive: true });

    if (!existsSync(PLATFORM_DIR)) {
      mkdirSync(PLATFORM_DIR, { recursive: true });
      platformDirCreated = true;
    }
    writeFileSync(join(PLATFORM_DIR, ".Limacina-9.9.9-linux-x86_64.zip.replaced"), "backup");
  });

  afterAll((): void => {
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
    rmSync(join(RELEASES_ROOT, `.staging-sweep-${suffix}`), { recursive: true, force: true });
    rmSync(join(RELEASES_ROOT, `.lock-9.9.9-sweep-${suffix}`), { recursive: true, force: true });
    rmSync(join(RELEASES_ROOT, `junk-${suffix}.old-x`), { recursive: true, force: true });
    if (platformDirCreated) {
      rmSync(PLATFORM_PARENT, { recursive: true, force: true });
    }
    if (releasesRootCreated) {
      rmSync(RELEASES_ROOT, { recursive: true, force: true });
    }
  });

  it("убирает временные загрузки, служебные каталоги релизов и replaced-бэкапы", (): void => {
    service.onApplicationBootstrap();

    expect(existsSync(UPLOAD_TMP_DIR)).toBe(false);
    expect(existsSync(join(RELEASES_ROOT, `.staging-sweep-${suffix}`))).toBe(false);
    expect(existsSync(join(RELEASES_ROOT, `.lock-9.9.9-sweep-${suffix}`))).toBe(false);
    expect(existsSync(join(RELEASES_ROOT, `junk-${suffix}.old-x`))).toBe(false);
    expect(existsSync(join(PLATFORM_DIR, ".Limacina-9.9.9-linux-x86_64.zip.replaced"))).toBe(false);
  });

  it("восстанавливает каталог релиза из бэкапа после crash-окна swapReleaseDir (TASK-267.10)", (): void => {
    const backupName = `.old-9.9.9-${randomUUID()}`;
    mkdirSync(join(RELEASES_ROOT, backupName), { recursive: true });
    writeFileSync(join(RELEASES_ROOT, backupName, "Limacina-9.9.9-windows-x86_64.exe"), "payload");

    try {
      service.onApplicationBootstrap();

      expect(
        readFileSync(join(RELEASES_ROOT, "9.9.9", "Limacina-9.9.9-windows-x86_64.exe"), "utf-8"),
      ).toBe("payload");
      expect(existsSync(join(RELEASES_ROOT, backupName))).toBe(false);
    } finally {
      rmSync(join(RELEASES_ROOT, "9.9.9"), { recursive: true, force: true });
    }
  });

  it("не трогает опубликованные релизы", (): void => {
    mkdirSync(join(RELEASES_ROOT, `9.9.8-sweep-${suffix}`), { recursive: true });
    writeFileSync(join(RELEASES_ROOT, `9.9.8-sweep-${suffix}`, "artifact.exe"), "public");

    try {
      service.onApplicationBootstrap();

      expect(existsSync(join(RELEASES_ROOT, `9.9.8-sweep-${suffix}`, "artifact.exe"))).toBe(true);
    } finally {
      rmSync(join(RELEASES_ROOT, `9.9.8-sweep-${suffix}`), { recursive: true, force: true });
    }
  });

  it("переживает отсутствие каталогов", (): void => {
    expect(() => service.onApplicationBootstrap()).not.toThrow();
  });
});
