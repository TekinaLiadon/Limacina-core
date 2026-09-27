import { UPLOAD_TMP_DIR } from "../launcher-files";
import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import {
  ReleasePublishService,
  acquirePublishLock,
  ensurePublishLockOwned,
  releasePublishLock,
  type UpdaterArtifactUpload,
} from "../release-publish.service";
import {
  RELEASE_LOCK_TOKEN_FILENAME,
  buildReleaseStolenLockName,
  cleanupReleaseServiceDirs,
  isReleaseBackupEntry,
  isReleaseStagingEntry,
  isReleaseStolenLockEntry,
} from "../release-service-dirs";

const RELEASES_ROOT = join("public", "releases");
const RELEASES_BACKUP = join("public", "releases.bak");

function stageUpload(
  platformKey: string,
  suffix: string,
  artifactContent: string,
  signatureContent: string,
): UpdaterArtifactUpload {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  const artifactTempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.artifact`);
  const signatureTempPath = join(UPLOAD_TMP_DIR, `${randomUUID()}.sig`);
  writeFileSync(artifactTempPath, artifactContent);
  writeFileSync(signatureTempPath, signatureContent);
  return { platformKey, suffix, artifactTempPath, signatureTempPath };
}

function failingUpload(platformKey: string, suffix: string): UpdaterArtifactUpload {
  return {
    platformKey,
    suffix,
    artifactTempPath: join(UPLOAD_TMP_DIR, `${randomUUID()}.missing`),
    signatureTempPath: join(UPLOAD_TMP_DIR, `${randomUUID()}.missing`),
  };
}

function artifactPaths(
  version: string,
  platformKey: string,
  suffix: string,
): {
  artifact: string;
  sig: string;
} {
  const artifact = join(RELEASES_ROOT, version, `Limacina-${version}-${platformKey}${suffix}`);
  return { artifact, sig: `${artifact}.sig` };
}

function releaseFiles(version: string): string[] {
  return readdirSync(join(RELEASES_ROOT, version));
}

function ageDirectory(dir: string): void {
  const past = new Date(Date.now() - 24 * 60 * 60_000);
  utimesSync(dir, past, past);
}

describe("ReleasePublishService — публикация релиза", (): void => {
  let service: ReleasePublishService;
  let releasesRootExisted = false;

  beforeAll((): void => {
    releasesRootExisted = existsSync(RELEASES_ROOT);
    if (releasesRootExisted) {
      renameSync(RELEASES_ROOT, RELEASES_BACKUP);
    }
    service = new ReleasePublishService();
  });

  afterAll((): void => {
    rmSync(RELEASES_ROOT, { recursive: true, force: true });
    rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
    if (releasesRootExisted) {
      renameSync(RELEASES_BACKUP, RELEASES_ROOT);
    }
  });

  it("публикует несколько платформ под каноническими именами и чистит temp", async () => {
    const result = await service.publish("4.4.1", [
      stageUpload("windows-x86_64", ".exe", "windows-bytes", "sig-windows"),
      stageUpload("darwin-aarch64", ".app.tar.gz", "macos-bytes", "sig-macos"),
    ]);

    expect(result).toEqual({
      version: "4.4.1",
      published: ["windows-x86_64", "darwin-aarch64"],
    });

    const windows = artifactPaths("4.4.1", "windows-x86_64", ".exe");
    expect(readFileSync(windows.artifact, "utf-8")).toBe("windows-bytes");
    expect(readFileSync(windows.sig, "utf-8")).toBe("sig-windows");
    const darwin = artifactPaths("4.4.1", "darwin-aarch64", ".app.tar.gz");
    expect(readFileSync(darwin.artifact, "utf-8")).toBe("macos-bytes");
    expect(existsSync(UPLOAD_TMP_DIR) ? readdirSync(UPLOAD_TMP_DIR) : []).toEqual([]);
    expect(existsSync(join(RELEASES_ROOT, ".lock-4.4.1"))).toBe(false);
  });

  it("повторная публикация той же платформы заменяет файлы, не оставляя служебных каталогов", async () => {
    await service.publish("4.4.2", [stageUpload("windows-x86_64", ".exe", "windows-v1", "sig-v1")]);
    const result = await service.publish("4.4.2", [
      stageUpload("windows-x86_64", ".exe", "windows-v2", "sig-v2"),
    ]);

    expect(result.published).toEqual(["windows-x86_64"]);
    const windows = artifactPaths("4.4.2", "windows-x86_64", ".exe");
    expect(readFileSync(windows.artifact, "utf-8")).toBe("windows-v2");
    expect(readFileSync(windows.sig, "utf-8")).toBe("sig-v2");
    expect(
      releaseFiles("4.4.2").some((file) => file.endsWith(".replaced") || file.startsWith(".")),
    ).toBe(false);
    expect(
      readdirSync(RELEASES_ROOT).some(
        (entry) => isReleaseStagingEntry(entry) || isReleaseBackupEntry(entry),
      ),
    ).toBe(false);
  });

  it("догрузка дополнительной платформы сохраняет уже опубликованные", async () => {
    await service.publish("4.4.8", [stageUpload("windows-x86_64", ".exe", "win-bytes", "sig-win")]);
    await service.publish("4.4.8", [
      stageUpload("darwin-aarch64", ".app.tar.gz", "mac-bytes", "sig-mac"),
    ]);

    const windows = artifactPaths("4.4.8", "windows-x86_64", ".exe");
    const darwin = artifactPaths("4.4.8", "darwin-aarch64", ".app.tar.gz");
    expect(readFileSync(windows.artifact, "utf-8")).toBe("win-bytes");
    expect(readFileSync(darwin.artifact, "utf-8")).toBe("mac-bytes");
    expect(readFileSync(darwin.sig, "utf-8")).toBe("sig-mac");
  });

  it("конкурентные публикации одной версии не теряют платформы", async () => {
    await Promise.all([
      service.publish("4.4.9", [stageUpload("windows-x86_64", ".exe", "win", "sig-win")]),
      service.publish("4.4.9", [stageUpload("linux-x86_64", ".AppImage", "linux", "sig-linux")]),
    ]);

    expect(existsSync(artifactPaths("4.4.9", "windows-x86_64", ".exe").artifact)).toBe(true);
    expect(existsSync(artifactPaths("4.4.9", "linux-x86_64", ".AppImage").artifact)).toBe(true);
  });

  it("сбой поздней платформы откатывает уже опубликованные в этом запросе", async () => {
    await expect(
      service.publish("4.4.3", [
        stageUpload("linux-aarch64", ".AppImage", "arm-bytes", "sig-arm"),
        failingUpload("linux-x86_64", ".AppImage"),
      ]),
    ).rejects.toThrow();

    expect(existsSync(join(RELEASES_ROOT, "4.4.3"))).toBe(false);
    expect(
      readdirSync(RELEASES_ROOT).some(
        (entry) => isReleaseStagingEntry(entry) || isReleaseBackupEntry(entry),
      ),
    ).toBe(false);
  });

  it("сбой поздней платформы восстанавливает перезаписанные файлы", async () => {
    const windows = artifactPaths("4.4.4", "windows-x86_64", ".exe");
    await service.publish("4.4.4", [
      stageUpload("windows-x86_64", ".exe", "original", "sig-original"),
    ]);

    await expect(
      service.publish("4.4.4", [
        stageUpload("windows-x86_64", ".exe", "replaced", "sig-replaced"),
        failingUpload("linux-x86_64", ".AppImage"),
      ]),
    ).rejects.toThrow();

    expect(readFileSync(windows.artifact, "utf-8")).toBe("original");
    expect(readFileSync(windows.sig, "utf-8")).toBe("sig-original");
    expect(
      readdirSync(RELEASES_ROOT).some(
        (entry) => isReleaseStagingEntry(entry) || isReleaseBackupEntry(entry),
      ),
    ).toBe(false);
  });

  it("занятый лок даёт 409 и не забирает чужой свежий лок", async () => {
    mkdirSync(join(RELEASES_ROOT, ".lock-4.4.5"), { recursive: true });
    const impatient = new ReleasePublishService(150);

    await expect(
      impatient.publish("4.4.5", [stageUpload("windows-x86_64", ".exe", "a", "s")]),
    ).rejects.toThrow(ConflictException);
    expect(existsSync(join(RELEASES_ROOT, ".lock-4.4.5"))).toBe(true);
  });

  it("неудачное снятие stale-лока завершается 409 по deadline, а не вечным циклом", async () => {
    const lockDir = join(RELEASES_ROOT, ".lock-4.4.11");
    mkdirSync(lockDir, { recursive: true });
    ageDirectory(lockDir);
    chmodSync(RELEASES_ROOT, 0o555);
    const impatient = new ReleasePublishService(150);

    try {
      await expect(
        impatient.publish("4.4.11", [stageUpload("windows-x86_64", ".exe", "a", "s")]),
      ).rejects.toThrow(ConflictException);
    } finally {
      chmodSync(RELEASES_ROOT, 0o755);
    }

    expect(existsSync(lockDir)).toBe(true);
  });

  it("публикация с пустой или пробельной подписью отклоняется", async () => {
    await expect(
      service.publish("4.4.13", [stageUpload("windows-x86_64", ".exe", "a", "   \n")]),
    ).rejects.toThrow(BadRequestException);

    expect(existsSync(join(RELEASES_ROOT, "4.4.13"))).toBe(false);
  });

  it("протухший лок захватывается", async () => {
    mkdirSync(join(RELEASES_ROOT, ".lock-4.4.6"), { recursive: true });
    ageDirectory(join(RELEASES_ROOT, ".lock-4.4.6"));

    const result = await service.publish("4.4.6", [
      stageUpload("windows-x86_64", ".exe", "a", "s"),
    ]);

    expect(result.version).toBe("4.4.6");
    expect(existsSync(join(RELEASES_ROOT, ".lock-4.4.6"))).toBe(false);
  });

  it("протухшие служебные каталоги павших публикаций подчищаются", async () => {
    mkdirSync(join(RELEASES_ROOT, ".staging-stale"), { recursive: true });
    ageDirectory(join(RELEASES_ROOT, ".staging-stale"));
    mkdirSync(join(RELEASES_ROOT, "4.4.12"), { recursive: true });
    const redundantBackup = `.old-4.4.12-${randomUUID()}`;
    mkdirSync(join(RELEASES_ROOT, redundantBackup), { recursive: true });
    ageDirectory(join(RELEASES_ROOT, redundantBackup));
    mkdirSync(join(RELEASES_ROOT, ".staging-fresh"), { recursive: true });

    try {
      await service.publish("4.4.10", [stageUpload("windows-x86_64", ".exe", "a", "s")]);

      expect(existsSync(join(RELEASES_ROOT, ".staging-stale"))).toBe(false);
      expect(existsSync(join(RELEASES_ROOT, redundantBackup))).toBe(false);
      expect(existsSync(join(RELEASES_ROOT, ".staging-fresh"))).toBe(true);
    } finally {
      rmSync(join(RELEASES_ROOT, ".staging-fresh"), { recursive: true, force: true });
      rmSync(join(RELEASES_ROOT, "4.4.12"), { recursive: true, force: true });
    }
  });

  it("бэкап без каталога версии восстанавливается до чистки (crash-окно swapReleaseDir)", async () => {
    const backupName = `.old-4.4.13-${randomUUID()}`;
    mkdirSync(join(RELEASES_ROOT, backupName), { recursive: true });
    writeFileSync(
      join(RELEASES_ROOT, backupName, "Limacina-4.4.13-windows-x86_64.exe"),
      "backup-payload",
    );
    ageDirectory(join(RELEASES_ROOT, backupName));

    try {
      await service.publish("4.4.10", [stageUpload("windows-x86_64", ".exe", "a", "s")]);

      expect(
        readFileSync(join(RELEASES_ROOT, "4.4.13", "Limacina-4.4.13-windows-x86_64.exe"), "utf-8"),
      ).toBe("backup-payload");
      expect(existsSync(join(RELEASES_ROOT, backupName))).toBe(false);
    } finally {
      rmSync(join(RELEASES_ROOT, "4.4.13"), { recursive: true, force: true });
    }
  });

  it("публикация версии после crash-окна подхватывает восстановленные файлы", async () => {
    const backupName = `.old-4.4.15-${randomUUID()}`;
    mkdirSync(join(RELEASES_ROOT, backupName), { recursive: true });
    writeFileSync(
      join(RELEASES_ROOT, backupName, "Limacina-4.4.15-darwin-aarch64.app.tar.gz"),
      "old-macos",
    );

    const result = await service.publish("4.4.15", [
      stageUpload("windows-x86_64", ".exe", "new-windows", "sig-new"),
    ]);

    expect(result.version).toBe("4.4.15");
    expect(
      readFileSync(
        join(RELEASES_ROOT, "4.4.15", "Limacina-4.4.15-darwin-aarch64.app.tar.gz"),
        "utf-8",
      ),
    ).toBe("old-macos");
    expect(readFileSync(artifactPaths("4.4.15", "windows-x86_64", ".exe").artifact, "utf-8")).toBe(
      "new-windows",
    );
    expect(
      readdirSync(RELEASES_ROOT).some(
        (entry) => isReleaseStagingEntry(entry) || isReleaseBackupEntry(entry),
      ),
    ).toBe(false);
  });

  it("отклоняет публикацию зарезервированной версии 0.0.0", async () => {
    await expect(
      service.publish("0.0.0", [stageUpload("windows-x86_64", ".exe", "a", "s")]),
    ).rejects.toThrow(BadRequestException);

    expect(existsSync(join(RELEASES_ROOT, "0.0.0"))).toBe(false);
  });

  it("отклоняет пустую версию", async () => {
    await expect(
      service.publish("", [stageUpload("windows-x86_64", ".exe", "a", "s")]),
    ).rejects.toThrow(BadRequestException);
  });

  it("отклоняет версию не в формате x.x.x", async () => {
    await expect(
      service.publish("bad", [stageUpload("windows-x86_64", ".exe", "a", "s")]),
    ).rejects.toThrow(BadRequestException);
  });

  it("отклоняет публикацию без артефактов", async () => {
    await expect(service.publish("4.4.6", [])).rejects.toThrow(BadRequestException);
  });

  it("создаёт каталог релиза при первой публикации", async () => {
    await service.publish("4.4.7", [stageUpload("windows-x86_64", ".exe", "a", "s")]);
    expect(existsSync(join(RELEASES_ROOT, "4.4.7", "Limacina-4.4.7-windows-x86_64.exe"))).toBe(
      true,
    );
  });

  describe("токен-лок публикации (TASK-321)", (): void => {
    const lockLogger = new Logger("ReleasePublishLockTest");
    const lockPathOf = (version: string): string => join(RELEASES_ROOT, `.lock-${version}`);
    const tokenPathOf = (version: string): string =>
      join(lockPathOf(version), RELEASE_LOCK_TOKEN_FILENAME);

    const removeStolenTombs = (): void => {
      for (const entry of readdirSync(RELEASES_ROOT)) {
        if (!isReleaseStolenLockEntry(entry)) continue;
        rmSync(join(RELEASES_ROOT, entry), { recursive: true, force: true });
      }
    };

    it("при захвате лока в каталог пишется токен владельца", async () => {
      const token = await acquirePublishLock(RELEASES_ROOT, "4.5.1", 150, lockLogger);

      expect(token.length).toBeGreaterThan(0);
      expect(readFileSync(tokenPathOf("4.5.1"), "utf-8")).toBe(token);

      releasePublishLock(RELEASES_ROOT, "4.5.1", token, lockLogger);
      expect(existsSync(lockPathOf("4.5.1"))).toBe(false);
    });

    it("чужой токен не снимает лок — отвисшая публикация не сносит чужой захват", async () => {
      const token = await acquirePublishLock(RELEASES_ROOT, "4.5.2", 150, lockLogger);

      releasePublishLock(RELEASES_ROOT, "4.5.2", "hijacker-token", lockLogger);
      expect(existsSync(lockPathOf("4.5.2"))).toBe(true);
      expect(readFileSync(tokenPathOf("4.5.2"), "utf-8")).toBe(token);

      releasePublishLock(RELEASES_ROOT, "4.5.2", token, lockLogger);
      expect(existsSync(lockPathOf("4.5.2"))).toBe(false);
    });

    it("владелец с перехваченным локом прерывается 409", async () => {
      const token = await acquirePublishLock(RELEASES_ROOT, "4.5.3", 150, lockLogger);

      writeFileSync(tokenPathOf("4.5.3"), "hijacker-token");
      expect(() => ensurePublishLockOwned(RELEASES_ROOT, "4.5.3", token)).toThrow(
        ConflictException,
      );

      rmSync(lockPathOf("4.5.3"), { recursive: true, force: true });
      expect(() => ensurePublishLockOwned(RELEASES_ROOT, "4.5.3", token)).toThrow(
        ConflictException,
      );
    });

    it("протухший лок захватывается атомарным rename в stolen-гробницу", async () => {
      mkdirSync(lockPathOf("4.5.4"), { recursive: true });
      ageDirectory(lockPathOf("4.5.4"));

      try {
        const token = await acquirePublishLock(RELEASES_ROOT, "4.5.4", 150, lockLogger);

        expect(readFileSync(tokenPathOf("4.5.4"), "utf-8")).toBe(token);
        expect(readdirSync(RELEASES_ROOT).some(isReleaseStolenLockEntry)).toBe(true);

        releasePublishLock(RELEASES_ROOT, "4.5.4", token, lockLogger);
        expect(existsSync(lockPathOf("4.5.4"))).toBe(false);
      } finally {
        removeStolenTombs();
      }
    });

    it("stolen-гробница не участвует в захвате лока и подчищается как служебный каталог", async () => {
      const tomb = join(RELEASES_ROOT, buildReleaseStolenLockName("4.5.5", randomUUID()));
      mkdirSync(tomb, { recursive: true });
      ageDirectory(tomb);

      const token = await acquirePublishLock(RELEASES_ROOT, "4.5.5", 150, lockLogger);
      expect(readFileSync(tokenPathOf("4.5.5"), "utf-8")).toBe(token);

      releasePublishLock(RELEASES_ROOT, "4.5.5", token, lockLogger);

      expect(existsSync(tomb)).toBe(true);
      cleanupReleaseServiceDirs(RELEASES_ROOT, lockLogger);
      expect(existsSync(tomb)).toBe(false);
    });

    it("публикация живёт в собственном локе и снимает его по токену (сквозной прогон)", async () => {
      const result = await service.publish("4.5.6", [
        stageUpload("windows-x86_64", ".exe", "a", "s"),
      ]);

      expect(result.version).toBe("4.5.6");
      expect(existsSync(lockPathOf("4.5.6"))).toBe(false);
    });
  });
});
