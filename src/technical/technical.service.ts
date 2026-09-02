import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { v4 } from "uuid";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import type { InitOwnerResponseDto } from "./dto/dto";

const SHUTDOWN_DELAY_MS = 300;

@Injectable()
export class TechnicalService {
  private readonly logger = new Logger(TechnicalService.name);

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  restartServer(): void {
    this.logger.log("Перезапуск сервера по запросу администратора");
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
