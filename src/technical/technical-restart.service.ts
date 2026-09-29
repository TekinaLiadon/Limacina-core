import { ConflictException, Injectable, Logger } from "@nestjs/common";
import type { RequestUser } from "../common/current-user.decorator";

const SHUTDOWN_DELAY_MS = 300;

@Injectable()
export class TechnicalRestartService {
  private readonly logger = new Logger(TechnicalRestartService.name);
  private shutdownScheduled = false;
  private restartGuard: (() => boolean) | null = null;

  async restartServer(actor: RequestUser): Promise<void> {
    if (this.restartGuard?.()) {
      this.logger.error({ actor: actor.username }, "Отказ: идёт пересборка, перезапуск отклонён");
      throw new ConflictException("Перезапуск отклонён: идёт пересборка");
    }
    if (!this.scheduleShutdown()) {
      this.logger.error(
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

  setRestartGuard(isRebuildInProgress: () => boolean): void {
    this.restartGuard = isRebuildInProgress;
  }

  isShutdownScheduled(): boolean {
    return this.shutdownScheduled;
  }

  scheduleShutdown(onShutdown?: () => void): boolean {
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
      onShutdown?.();
    }, SHUTDOWN_DELAY_MS);
    return true;
  }

  sendShutdownSignal(): void {
    process.kill(process.pid, "SIGTERM");
  }
}
