import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { copyFile } from "node:fs/promises";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { generateUuid } from "../utils/uuid";
import type { RequestUser } from "../common/current-user.decorator";
import type { InitOwnerResponseDto, RebuildStatusDto } from "./dto/dto";

const SHUTDOWN_DELAY_MS = 300;
const STEP_OUTPUT_LIMIT = 2000;
const GIT_PULL_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MIGRATE_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 120_000;
const KILL_GRACE_MS = 5_000;
const BINARY_PATH = "dist/Limacina";
const BINARY_BACKUP_PATH = "dist/Limacina.previous";
const LOCKFILE_PATHS = ["bun.lockb", "bun.lock"];

export function buildStepEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { SECRETS: _secrets, ...stepEnv } = env;
  return { ...stepEnv, GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

const STEP_ENV = buildStepEnv();

function truncateOutput(output: string): string {
  if (output.length <= STEP_OUTPUT_LIMIT) return output;
  return `${output.slice(0, STEP_OUTPUT_LIMIT)}…[обрезано]`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function signalProcessGroup(proc: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessTree(proc: Bun.Subprocess, graceMs: number): Promise<void> {
  signalProcessGroup(proc, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(proc.pid)) {
      return;
    }
    await Bun.sleep(100);
  }
  signalProcessGroup(proc, "SIGKILL");
}

export async function runStep(
  logger: Logger,
  step: string,
  command: string[],
  timeoutMs: number,
  killGraceMs = KILL_GRACE_MS,
): Promise<void> {
  let proc: Bun.Subprocess<Bun.SpawnOptions.Writable, "pipe", "pipe">;
  try {
    proc = Bun.spawn(command, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: STEP_ENV,
      detached: true,
    });
  } catch (error) {
    logger.error(
      { err: error, step, command: command.join(" ") },
      `Шаг перезапуска не запущен: ${step}`,
    );
    throw new InternalServerErrorException(
      `Пересборка не удалась на шаге ${step}: команда не запущена, перезапуск отменён`,
    );
  }

  let escalation: Promise<void> | undefined;
  const timeout = setTimeout(() => {
    escalation = terminateProcessTree(proc, killGraceMs);
  }, timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (escalation) {
      await escalation;
    }
    if (exitCode !== 0) {
      logger.error(
        {
          step,
          exitCode,
          command: command.join(" "),
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
        },
        `Шаг перезапуска не выполнен: ${step}`,
      );
      throw new InternalServerErrorException(
        `Пересборка не удалась на шаге ${step}, перезапуск отменён`,
      );
    }
    logger.log({ step }, "Шаг перезапуска выполнен");
  } finally {
    clearTimeout(timeout);
  }
}

export async function currentRevision(
  logger: Logger,
  cwd: string = process.cwd(),
): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: STEP_ENV,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      logger.error(
        { cwd, exitCode, stderr: truncateOutput(stderr) },
        "Не удалось определить ревизию git",
      );
      return "unknown";
    }
    return stdout.trim();
  } catch (error) {
    logger.error({ err: error }, "Не удалось запустить git для определения ревизии");
    return "unknown";
  }
}

export function buildInstallCommand(frozenLockfile: boolean): string[] {
  return frozenLockfile ? ["bun", "install", "--frozen-lockfile"] : ["bun", "install"];
}

@Injectable()
export class TechnicalService {
  private readonly logger = new Logger(TechnicalService.name);
  private rebuildInProgress = false;
  private shutdownScheduled = false;
  private lastRebuildError: string | null = null;
  private lastRebuildRevisions: { before: string | null; after: string | null } = {
    before: null,
    after: null,
  };

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
    @Inject(AppConfigToken) private readonly appConfig: AppConfigType,
  ) {}

  async restartServer(actor: RequestUser): Promise<void> {
    if (!this.scheduleShutdown()) {
      this.logger.warn(
        { actor: actor.username },
        "Повторный запрос перезапуска отклонён: остановка уже запланирована",
      );
      throw new ConflictException("Перезапуск уже запланирован");
    }
    this.logger.log(
      { actor: actor.username, actorRole: actor.role },
      "Перезапуск сервера по запросу администратора",
    );
  }

  startRebuild(actor: RequestUser): void {
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
      await this.runMigrations();
      await this.buildBinary();
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
    this.scheduleShutdown();
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

  scheduleShutdown(): boolean {
    if (this.shutdownScheduled) return false;
    this.shutdownScheduled = true;
    setTimeout(() => {
      try {
        this.sendShutdownSignal();
      } catch (error) {
        this.logger.error({ err: error }, "Сигнал остановки не отправлен, принудительный выход");
        process.exit(1);
      }
      this.shutdownScheduled = false;
      this.rebuildInProgress = false;
    }, SHUTDOWN_DELAY_MS);
    return true;
  }

  sendShutdownSignal(): void {
    process.kill(process.pid, "SIGTERM");
  }

  async gitPull(): Promise<{ before: string; after: string }> {
    const revisionBefore = await currentRevision(this.logger);
    await runStep(this.logger, "git pull", ["git", "pull", "--ff-only"], GIT_PULL_TIMEOUT_MS);
    const revisionAfter = await currentRevision(this.logger);
    this.logger.log({ revisionBefore, revisionAfter }, "Исходники обновлены");
    return { before: revisionBefore, after: revisionAfter };
  }

  async installDependencies(): Promise<void> {
    const frozenLockfile = await this.hasLockfile();
    await runStep(
      this.logger,
      "bun install",
      buildInstallCommand(frozenLockfile),
      INSTALL_TIMEOUT_MS,
    );
  }

  private async hasLockfile(): Promise<boolean> {
    for (const lockfilePath of LOCKFILE_PATHS) {
      if (await Bun.file(lockfilePath).exists()) {
        return true;
      }
    }
    return false;
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
        "Бинарник восстановлен из резервной копии после неудачной сборки",
      );
    } catch (error) {
      this.logger.error({ err: error, binaryPath, backupPath }, "Откат бинарника не выполнен");
    }
  }

  async initOwner(username: string, password: string): Promise<InitOwnerResponseDto> {
    if (await this.adminStore.hasOwner()) {
      throw new ConflictException("Владелец уже создан");
    }

    if (await this.authStore.userExists(username)) {
      throw new ConflictException("Юзернейм уже занят");
    }

    const uuid = generateUuid();
    const passwordHash = await Bun.password.hash(password);

    const saved = await this.authStore.saveUser({
      uuid,
      username,
      passwordHash,
      role: "owner",
      approved: true,
      banned: false,
    });
    if (!saved) {
      throw new ConflictException("Юзернейм уже занят");
    }

    await this.adminStore.saveUser({
      uuid,
      username,
      role: "owner",
      approved: true,
      banned: false,
    });

    this.logger.log({ username }, "Владелец создан");

    return { uuid, username };
  }
}
