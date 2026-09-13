import { describe, expect, it } from "bun:test";
import { CronService, nextDailyFireAt } from "./cron.service";

const localDate = (iso: string): number => new Date(iso).getTime();

describe("CronService", () => {
  it("runAll выполняет все зарегистрированные задачи", async () => {
    const service = new CronService();
    const runs: string[] = [];
    service.registerTasks(
      { name: "first", run: () => void runs.push("first") },
      { name: "second", run: async () => void runs.push("second") },
    );

    await service.runAll();

    expect(runs).toEqual(["first", "second"]);
  });

  it("runAll изолирует падение задачи: остальные выполняются", async () => {
    const service = new CronService();
    const runs: string[] = [];
    service.registerTasks(
      {
        name: "broken",
        run: () => {
          throw new Error("task failed");
        },
      },
      { name: "survivor", run: async () => void runs.push("survivor") },
    );

    await service.runAll();

    expect(runs).toEqual(["survivor"]);
  });

  it("runAll отклонённый промис задачи не роняет остальные", async () => {
    const service = new CronService();
    const runs: string[] = [];
    service.registerTasks(
      { name: "rejected", run: () => Promise.reject(new Error("async failure")) },
      { name: "after", run: () => void runs.push("after") },
    );

    await service.runAll();

    expect(runs).toEqual(["after"]);
  });

  it("runAll на пустом списке задач не падает", async () => {
    const service = new CronService();

    await expect(service.runAll()).resolves.toBeUndefined();
  });

  it("задачи, зарегистрированные после старта, выполняются", async () => {
    const service = new CronService();
    service.onModuleInit();
    const runs: string[] = [];
    service.registerTasks({ name: "late", run: () => void runs.push("late") });

    await service.runAll();

    expect(runs).toEqual(["late"]);
    service.onModuleDestroy();
  });

  it("onModuleDestroy можно вызвать до старта и повторно", () => {
    const service = new CronService();

    expect(() => {
      service.onModuleDestroy();
      service.onModuleInit();
      service.onModuleDestroy();
      service.onModuleDestroy();
    }).not.toThrow();
  });

  it("nextDailyFireAt возвращает сегодняшние 04:00, если день ещё не наступил", () => {
    const fireAt = new Date(nextDailyFireAt(4, localDate("2026-09-12T03:00:00")));

    expect(fireAt.toTimeString().startsWith("04:00:00")).toBe(true);
    expect(fireAt.getDate()).toBe(new Date(localDate("2026-09-12T03:00:00")).getDate());
  });

  it("nextDailyFireAt переносит запуск на завтра после 04:00", () => {
    const from = localDate("2026-09-12T21:30:00");
    const fireAt = new Date(nextDailyFireAt(4, from));

    expect(fireAt.toTimeString().startsWith("04:00:00")).toBe(true);
    expect(fireAt.getTime() - from).toBe(6.5 * 60 * 60 * 1000);
  });

  it("nextDailyFireAt в ровно 04:00 переносит запуск на завтра", () => {
    const from = localDate("2026-09-12T04:00:00");
    const fireAt = new Date(nextDailyFireAt(4, from));

    expect(fireAt.getTime() - from).toBe(24 * 60 * 60 * 1000);
  });

  it("при недоступном Bun.cron фолбэк на таймер выполняет задачи", async (): Promise<void> => {
    const originalCron = Bun.cron;
    const realNow = Date.now;
    (Bun as unknown as { cron: () => never }).cron = (): never => {
      throw new TypeError("Bun.cron is not supported in this runtime");
    };

    const target = new Date();
    target.setHours(3, 59, 59, 998);
    let nowPatched = false;
    Date.now = (): number => {
      if (!nowPatched) {
        nowPatched = true;
        return target.getTime();
      }
      return target.getTime() + 26 * 3600 * 1000;
    };

    const service = new CronService();
    const runs: string[] = [];
    service.registerTasks({
      name: "fallback-task",
      run: (): void => {
        runs.push("run");
      },
    });
    service.onModuleInit();

    try {
      await Bun.sleep(200);
      expect(runs).toEqual(["run"]);
    } finally {
      Date.now = realNow;
      service.onModuleDestroy();
      (Bun as unknown as { cron: unknown }).cron = originalCron;
    }

    expect(runs).toEqual(["run"]);
  });
});
