import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { v4 } from "uuid";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import type { InitOwnerResponseDto } from "./dto/dto";

const SHUTDOWN_DELAY_MS = 300;
const BUILD_TIMEOUT_MS = 120_000;

@Injectable()
export class TechnicalService {
  private readonly logger = new Logger(TechnicalService.name);

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  async restartServer(rebuild: boolean): Promise<void> {
    if (!rebuild) {
      this.logger.log("Перезапуск сервера по запросу администратора");
      this.scheduleShutdown();
      return;
    }

    this.logger.log("Пересборка и перезапуск сервера по запросу администратора");
    await this.buildBinary();
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
    }, SHUTDOWN_DELAY_MS);
  }

  sendShutdownSignal(): void {
    process.kill(process.pid, "SIGTERM");
  }

  async buildBinary(): Promise<void> {
    this.logger.log("Сборка нового бинарника");
    const buildProcess = Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const buildTimeout = setTimeout(() => buildProcess.kill(), BUILD_TIMEOUT_MS);
    try {
      const [exitCode, buildOutput] = await Promise.all([
        buildProcess.exited,
        new Response(buildProcess.stderr).text(),
      ]);
      if (exitCode !== 0) {
        this.logger.error({ exitCode, buildOutput }, "Сборка бинарника не удалась");
        throw new InternalServerErrorException(
          "Пересборка не удалась, сервер не будет перезапущен",
        );
      }
      this.logger.log("Новый бинарник собран");
    } finally {
      clearTimeout(buildTimeout);
    }
  }

  async initOwner(username: string, password: string): Promise<InitOwnerResponseDto> {
    if (await this.adminStore.hasOwner()) {
      throw new ConflictException("Владелец уже создан");
    }

    if (await this.authStore.userExists(username)) {
      throw new ConflictException("Юзернейм уже занят");
    }

    const uuid = v4().replace(/-/g, "");
    const passwordHash = await Bun.password.hash(password);

    await this.authStore.saveUser({
      uuid,
      username,
      passwordHash,
      skin: null,
      role: "owner",
      approved: true,
      banned: false,
    });

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
