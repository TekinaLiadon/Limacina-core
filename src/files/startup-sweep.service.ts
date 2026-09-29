import { existsSync, readdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import {
  PUBLIC_DIR,
  RELEASES_DIR,
  SUPPORTED_PLATFORMS,
  UPLOAD_TMP_DIR,
  parseLauncherZipName,
} from "../launcher/launcher-files";
import {
  cleanupReleaseServiceDirs,
  isZipReplacedEntry,
  parseReplacedZipName,
  recoverReleaseBackups,
} from "../launcher/release-service-dirs";
import { cleanupPanelBackups, recoverPanelBackups } from "../technical/panel-deploy-dirs";

@Injectable()
export class StartupSweepService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSweepService.name);

  onApplicationBootstrap(): void {
    this.sweepUploadTmp();
    this.sweepReleaseServiceDirs();
    this.sweepReplacedZips();
    this.sweepPanelDeployBackups();
  }

  private sweepUploadTmp(): void {
    if (!existsSync(UPLOAD_TMP_DIR)) return;

    try {
      const removed = readdirSync(UPLOAD_TMP_DIR).length;
      rmSync(UPLOAD_TMP_DIR, { recursive: true, force: true });
      if (removed > 0) {
        this.logger.warn({ dir: UPLOAD_TMP_DIR, removed }, "Свип временных загрузок при старте");
      }
    } catch (error) {
      this.logger.error(
        { err: error, dir: UPLOAD_TMP_DIR },
        "Не удалось очистить временные загрузки при старте",
      );
    }
  }

  private sweepReleaseServiceDirs(): void {
    const releasesRoot = join(PUBLIC_DIR, RELEASES_DIR);
    if (!existsSync(releasesRoot)) return;

    recoverReleaseBackups(releasesRoot, this.logger);
    cleanupReleaseServiceDirs(releasesRoot, this.logger);
  }

  private sweepPanelDeployBackups(): void {
    recoverPanelBackups(PUBLIC_DIR, this.logger);
    cleanupPanelBackups(PUBLIC_DIR, this.logger);
  }

  private sweepReplacedZips(): void {
    for (const [os, archs] of Object.entries(SUPPORTED_PLATFORMS)) {
      for (const arch of archs) {
        this.sweepReplacedZipDir(join(PUBLIC_DIR, os, arch), os, arch);
      }
    }
  }

  private sweepReplacedZipDir(dir: string, os: string, arch: string): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      this.logger.error(
        { err: error, dir },
        "Не удалось прочитать платформенный каталог при старте",
      );
      return;
    }

    for (const entry of entries) {
      if (!isZipReplacedEntry(entry)) continue;

      const fullPath = join(dir, entry);
      if (this.restoreReplacedZip(dir, entry, os, arch)) continue;

      try {
        unlinkSync(fullPath);
        this.logger.warn({ file: entry }, "Свип резервной копии zip при старте");
      } catch (error) {
        this.logger.error(
          { err: error, file: fullPath },
          "Не удалось удалить резервную копию zip при старте",
        );
      }
    }
  }

  private restoreReplacedZip(dir: string, entry: string, os: string, arch: string): boolean {
    const originalName = parseReplacedZipName(entry);
    if (!originalName || !parseLauncherZipName(originalName, os, arch)) return false;
    if (existsSync(join(dir, originalName))) return false;

    try {
      renameSync(join(dir, entry), join(dir, originalName));
      this.logger.warn(
        { backup: entry, restored: originalName },
        "zip лаунчера восстановлен из резервной копии после crash-окна обновления",
      );
    } catch (error) {
      this.logger.error(
        { err: error, backup: join(dir, entry) },
        "Не удалось восстановить zip лаунчера из резервной копии",
      );
    }
    return true;
  }
}
