import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { copyFile } from "node:fs/promises";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import {
  buildInstallCommand,
  currentRevision,
  hasLockfile,
  runStep,
  terminateActiveSteps,
} from "../utils/technical-steps";
import type { RequestUser } from "../common/current-user.decorator";
import type { RebuildStatusDto } from "./dto/dto";
import { TechnicalRestartService } from "./technical-restart.service";

const GIT_PULL_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MIGRATE_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 120_000;
const BINARY_PATH = "dist/Limacina";
const BINARY_BACKUP_PATH = "dist/Limacina.previous";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

@Injectable()
export class TechnicalRebuildService implements OnApplicationShutdown {
  private readonly logger = new Logger(TechnicalRebuildService.name);
  private rebuildInProgress = false;
  private lastRebuildError: string | null = null;
  private lastRebuildRevisions: { before: string | null; after: string | null } = {
    before: null,
    after: null,
  };

  constructor(
    @Inject(AppConfigToken) private readonly appConfig: AppConfigType,
    private readonly restart: TechnicalRestartService,
  ) {
    this.restart.setRestartGuard(() => this.rebuildInProgress);
  }

  startRebuild(actor: RequestUser): void {
    if (this.restart.isShutdownScheduled()) {
      this.logger.error(
        { actor: actor.username },
        "Отказ: остановка сервера уже запланирована, пересборка отклонена",
      );
      throw new ConflictException("Перезапуск уже запланирован, пересборка отклонена");
    }
    if (this.rebuildInProgress) {
      this.logger.error({ actor: actor.username }, "Отказ: пересборка уже выполняется");
      throw new ConflictException("Пересборка уже выполняется");
    }
    this.rebuildInProgress = true;
    this.lastRebuildError = null;
    this.lastRebuildRevisions = { before: null, after: null };

    this.logger.log(
      { actor: actor.username, actorRole: actor.role },
      "Пересборка и перезапуск сервера по запросу администратора",
    );
    void this.executeRebuildPipeline(actor);
  }

  async onApplicationShutdown(): Promise<void> {
    await terminateActiveSteps();
  }

  getRebuildStatus(): RebuildStatusDto {
    return {
      inProgress: this.rebuildInProgress,
      lastError: this.lastRebuildError,
      revisionBefore: this.lastRebuildRevisions.before,
      revisionAfter: this.lastRebuildRevisions.after,
    };
  }

  private async executeRebuildPipeline(actor: RequestUser): Promise<void> {
    try {
      const revisions = await this.gitPull();
      this.lastRebuildRevisions = revisions;
      this.verifyPinnedRevision(revisions.after);
      await this.installDependencies();
      await this.buildBinary();
      await this.runMigrationsWithBinaryRollback();
    } catch (error) {
      this.rebuildInProgress = false;
      this.lastRebuildError = errorMessage(error);
      this.logger.error(
        { actor: actor.username, err: error },
        "Конвейер пересборки прерван, перезапуск отменён",
      );
      return;
    }
    this.lastRebuildError = null;
    if (
      !this.restart.scheduleShutdown(() => {
        this.rebuildInProgress = false;
      })
    ) {
      this.rebuildInProgress = false;
    }
  }

  private async runMigrationsWithBinaryRollback(): Promise<void> {
    try {
      await this.runMigrations();
    } catch (error) {
      await this.restoreBinary();
      throw error;
    }
  }

  private verifyPinnedRevision(revision: string): void {
    const pinned = this.appConfig.DEPLOY_PINNED_REVISION;
    if (pinned === undefined || revision === pinned) {
      return;
    }
    this.logger.error(
      { actual: revision, expected: pinned },
      "Ревизия после git pull не совпадает с закреплённой",
    );
    throw new InternalServerErrorException(
      "Пересборка не удалась: ревизия не совпадает с DEPLOY_PINNED_REVISION, перезапуск отменён",
    );
  }

  async gitPull(): Promise<{ before: string; after: string }> {
    const revisionBefore = await currentRevision(this.logger);
    await runStep(this.logger, "git pull", ["git", "pull", "--ff-only"], GIT_PULL_TIMEOUT_MS);
    const revisionAfter = await currentRevision(this.logger);
    this.logger.log({ revisionBefore, revisionAfter }, "Исходники обновлены");
    return { before: revisionBefore, after: revisionAfter };
  }

  async installDependencies(): Promise<void> {
    const frozenLockfile = await hasLockfile(process.cwd());
    await runStep(
      this.logger,
      "bun install",
      buildInstallCommand(frozenLockfile),
      INSTALL_TIMEOUT_MS,
    );
  }

  async runMigrations(): Promise<void> {
    await runStep(this.logger, "migrate:up", ["bun", "run", "migrate:up"], MIGRATE_TIMEOUT_MS);
  }

  async buildBinary(): Promise<void> {
    await this.backupBinary();
    try {
      await this.runBuildStep();
    } catch (error) {
      await this.restoreBinary();
      throw error;
    }
  }

  async runBuildStep(): Promise<void> {
    await runStep(this.logger, "build", ["bun", "run", "build"], BUILD_TIMEOUT_MS);
  }

  async backupBinary(
    binaryPath: string = BINARY_PATH,
    backupPath: string = BINARY_BACKUP_PATH,
  ): Promise<void> {
    if (!(await Bun.file(binaryPath).exists())) {
      this.logger.log({ binaryPath }, "Бинарник отсутствует, резервная копия не создана");
      return;
    }
    try {
      await copyFile(binaryPath, backupPath);
    } catch (error) {
      this.logger.error(
        { err: error, binaryPath, backupPath },
        "Резервная копия бинарника не создана",
      );
      throw new InternalServerErrorException(
        "Пересборка не удалась: не создана резервная копия бинарника, перезапуск отменён",
      );
    }
  }

  async restoreBinary(
    binaryPath: string = BINARY_PATH,
    backupPath: string = BINARY_BACKUP_PATH,
  ): Promise<void> {
    try {
      if (!(await Bun.file(backupPath).exists())) {
        this.logger.error(
          { binaryPath, backupPath },
          "Резервная копия бинарника не найдена, откат не выполнен",
        );
        return;
      }
      await copyFile(backupPath, binaryPath);
      this.logger.error(
        { binaryPath, backupPath },
        "Бинарник восстановлен из резервной копии: прод остаётся на прежней схеме БД",
      );
    } catch (error) {
      this.logger.error({ err: error, binaryPath, backupPath }, "Откат бинарника не выполнен");
    }
  }
}
