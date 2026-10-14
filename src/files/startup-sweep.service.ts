import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { PUBLIC_DIR, RELEASES_DIR, UPLOAD_TMP_DIR } from "../launcher/launcher-files";
import { cleanupReleaseServiceDirs, recoverReleaseBackups } from "../launcher/release-service-dirs";
import { cleanupPanelBackups, recoverPanelBackups } from "../technical/panel-deploy-dirs";

@Injectable()
export class StartupSweepService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSweepService.name);

  onApplicationBootstrap(): void {
    this.sweepUploadTmp();
    this.sweepReleaseServiceDirs();
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
}
