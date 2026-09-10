import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import { generateUuid } from "../utils/uuid";
import type { RequestUser } from "../common/current-user.decorator";
import type { InitOwnerResponseDto } from "./dto/dto";

const SHUTDOWN_DELAY_MS = 300;
const STEP_OUTPUT_LIMIT = 2000;
const GIT_PULL_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MIGRATE_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 120_000;

function truncateOutput(output: string): string {
  if (output.length <= STEP_OUTPUT_LIMIT) return output;
  return `${output.slice(0, STEP_OUTPUT_LIMIT)}…[обрезано]`;
}

export async function runStep(
  logger: Logger,
  step: string,
  command: string[],
  timeoutMs: number,
): Promise<void> {
  const proc = Bun.spawn(command, { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      logger.error(
        { step, exitCode, stdout: truncateOutput(stdout), stderr: truncateOutput(stderr) },
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

export async function currentRevision(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return exitCode === 0 ? stdout.trim() : "unknown";
}

@Injectable()
export class TechnicalService {
  private readonly logger = new Logger(TechnicalService.name);
  private rebuildInProgress = false;

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  async restartServer(rebuild: boolean, actor: RequestUser): Promise<void> {
    if (!rebuild) {
      this.logger.log(
        { actor: actor.username, actorRole: actor.role },
        "Перезапуск сервера по запросу администратора",
      );
      this.scheduleShutdown();
      return;
    }

    if (this.rebuildInProgress) {
      this.logger.error({ actor: actor.username }, "Отказ: пересборка уже выполняется");
      throw new ConflictException("Пересборка уже выполняется");
    }
    this.rebuildInProgress = true;

    this.logger.log(
      { actor: actor.username, actorRole: actor.role },
      "Пересборка и перезапуск сервера по запросу администратора",
    );

    try {
      await this.gitPull();
      await this.installDependencies();
      await this.runMigrations();
      await this.buildBinary();
    } catch (error) {
      this.rebuildInProgress = false;
      throw error;
    }

    this.scheduleShutdown();
  }

  scheduleShutdown(): void {
    setTimeout(() => {
      try {
        this.sendShutdownSignal();
      } catch (error) {
        this.logger.error({ err: error }, "Сигнал остановки не отправлен, принудительный выход");
        process.exit(1);
      }
      this.rebuildInProgress = false;
    }, SHUTDOWN_DELAY_MS);
  }

  sendShutdownSignal(): void {
    process.kill(process.pid, "SIGTERM");
  }

  async gitPull(): Promise<void> {
    const revisionBefore = await currentRevision();
    await runStep(this.logger, "git pull", ["git", "pull", "--ff-only"], GIT_PULL_TIMEOUT_MS);
    const revisionAfter = await currentRevision();
    this.logger.log({ revisionBefore, revisionAfter }, "Исходники обновлены");
  }

  async installDependencies(): Promise<void> {
    await runStep(this.logger, "bun install", ["bun", "install"], INSTALL_TIMEOUT_MS);
  }

  async runMigrations(): Promise<void> {
    await runStep(this.logger, "migrate:up", ["bun", "run", "migrate:up"], MIGRATE_TIMEOUT_MS);
  }

  async buildBinary(): Promise<void> {
    await runStep(this.logger, "build", ["bun", "run", "build"], BUILD_TIMEOUT_MS);
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
