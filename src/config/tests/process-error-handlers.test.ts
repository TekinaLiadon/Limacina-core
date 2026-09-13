import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import type { Logger } from "nestjs-pino";
import { createUncaughtExceptionHandler } from "../process-error-handlers";

const fakeLogger = (log: unknown[]): Logger =>
  ({ error: (data: unknown, message?: string) => log.push(message ?? data) }) as unknown as Logger;

describe("createUncaughtExceptionHandler (TASK-73)", (): void => {
  it("логирует исключение и завершает процесс с кодом 1", async (): Promise<void> => {
    const logged: unknown[] = [];
    const exitCodes: number[] = [];
    const handler = createUncaughtExceptionHandler(
      fakeLogger(logged),
      (code) => exitCodes.push(code),
      0,
    );

    handler(new Error("boom"));

    await Bun.sleep(1);

    expect(logged.length).toBe(1);
    expect(exitCodes).toEqual([1]);
  });

  it("откладывает exit, чтобы лог успел записаться", async (): Promise<void> => {
    const logged: unknown[] = [];
    const exitCodes: number[] = [];
    const handler = createUncaughtExceptionHandler(
      fakeLogger(logged),
      (code) => exitCodes.push(code),
      50,
    );

    handler(new Error("boom"));
    await Bun.sleep(1);

    expect(exitCodes).toEqual([]);
  });
});
