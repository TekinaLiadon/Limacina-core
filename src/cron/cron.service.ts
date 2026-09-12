import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

export interface CronTask {
  name: string;
  run: () => void | Promise<void>;
}

export const CRON_FIRE_HOUR = 4;

export const CRON_SCHEDULE = `0 ${CRON_FIRE_HOUR} * * *`;

export function nextDailyFireAt(hour: number, fromMs: number): number {
  const fire = new Date(fromMs);
  fire.setHours(hour, 0, 0, 0);
  if (fire.getTime() <= fromMs) fire.setDate(fire.getDate() + 1);
  return fire.getTime();
}

@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);
  private readonly tasks: CronTask[] = [];
  private job: import("bun").CronJob | undefined;
  private timer: Timer | undefined;

  onModuleInit(): void {
    this.startSchedule();
    const mode = this.job ? "Bun.cron" : "таймер";
    this.logger.log(
      `Планировщик запущен (${mode}): ежедневный прогон в ` +
        `${String(CRON_FIRE_HOUR).padStart(2, "0")}:00, задач: ${this.tasks.length}`,
    );
  }

  onModuleDestroy(): void {
    this.job?.stop();
    this.job = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  registerTasks(...newTasks: CronTask[]): void {
    this.tasks.push(...newTasks);
  }

  async runAll(): Promise<void> {
    for (const task of this.tasks) {
      try {
        await task.run();
      } catch (err) {
        this.logger.error({ err, task: task.name }, `Задача "${task.name}" упала`);
      }
    }
  }

  private startSchedule(): void {
    try {
      this.job = Bun.cron(CRON_SCHEDULE, () => this.runAll()).unref();
    } catch {
      this.scheduleNextFire();
    }
  }

  private scheduleNextFire(): void {
    const delay = nextDailyFireAt(CRON_FIRE_HOUR, Date.now()) - Date.now();
    this.timer = setTimeout(() => {
      void this.runAll().then(() => this.scheduleNextFire());
    }, delay);
    this.timer.unref();
  }
}
