import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

export interface CronTask {
  name: string;
  run: () => void | Promise<void>;
}

export const CRON_FIRE_HOUR = 4;

export const CRON_SCHEDULE = `0 ${CRON_FIRE_HOUR} * * *`;

export const CRON_TASK_TIMEOUT_MS = 10 * 60_000;

export function nextDailyFireAt(hour: number, fromMs: number): number {
  const fire = new Date(fromMs);
  fire.setHours(hour, 0, 0, 0);
  if (fire.getTime() <= fromMs) fire.setDate(fire.getDate() + 1);
  return fire.getTime();
}

@Injectable()
export class CronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);
  private readonly tasks: CronTask[] = [];
  private readonly zombieRuns = new Set<Promise<void>>();
  private running = false;
  private job: import("bun").CronJob | undefined;
  private timer: Timer | undefined;

  constructor(@Optional() private readonly taskTimeoutMs: number = CRON_TASK_TIMEOUT_MS) {}

  onApplicationBootstrap(): void {
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
    if (this.running) {
      this.logger.warn("Пропуск прогона cron-задач: предыдущий прогон ещё выполняется");
      return;
    }
    if (this.zombieRuns.size > 0) {
      this.logger.warn(
        "Пропуск прогона cron-задач: задача прошлого прогона всё ещё выполняется после таймаута",
      );
      return;
    }
    this.running = true;
    try {
      for (const task of this.tasks) {
        try {
          await this.runWithTimeout(task);
        } catch (err) {
          this.logger.error({ err, task: task.name }, `Задача "${task.name}" упала`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private runWithTimeout(task: CronTask): Promise<void> {
    const taskRun = Promise.resolve().then(task.run);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.trackZombieRun(task.name, taskRun);
        reject(
          new Error(`Задача "${task.name}" не завершилась за ${String(this.taskTimeoutMs)} мс`),
        );
      }, this.taskTimeoutMs);
      timer.unref();

      taskRun.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private trackZombieRun(taskName: string, taskRun: Promise<void>): void {
    const zombie = taskRun.then(
      () => undefined,
      (err: unknown) => {
        this.logger.error(
          { err, task: taskName },
          `Задача "${taskName}" упала после срабатывания таймаута`,
        );
      },
    );
    this.zombieRuns.add(zombie);
    void zombie.then(() => {
      this.zombieRuns.delete(zombie);
    });
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
      void this.runAll()
        .catch((error: unknown) => {
          this.logger.error({ err: error }, "Ошибка прогона cron-задач");
        })
        .then(() => this.scheduleNextFire());
    }, delay);
    this.timer.unref();
  }
}
