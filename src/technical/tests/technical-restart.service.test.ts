import { describe, expect, it, spyOn } from "bun:test";
import { ConflictException } from "@nestjs/common";
import { TechnicalRestartService } from "../technical-restart.service";
import type { RequestUser } from "../../common/current-user.decorator";

const actor: RequestUser = { uuid: "owner-uuid", username: "owner", role: "owner" };

describe("TechnicalRestartService", (): void => {
  it("sendShutdownSignal подаёт SIGTERM собственному процессу", () => {
    const service = new TechnicalRestartService();
    const originalKill = process.kill;
    const captured: { pid: number; signal: NodeJS.Signals | number | undefined }[] = [];
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      captured.push({ pid, signal });
    }) as typeof process.kill;
    try {
      service.sendShutdownSignal();
    } finally {
      process.kill = originalKill;
    }
    expect(captured).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
  });

  it("scheduleShutdown снимает флаг после отправки сигнала и зовёт колбэк", async () => {
    const service = new TechnicalRestartService();
    let callbackFired = false;
    service.sendShutdownSignal = () => {};

    expect(
      service.scheduleShutdown(() => {
        callbackFired = true;
      }),
    ).toBe(true);
    await Bun.sleep(400);

    expect(callbackFired).toBe(true);
    expect(service.scheduleShutdown()).toBe(true);
  });

  describe("restartServer", () => {
    it("перезапускает сервер и подаёт сигнал один раз", async () => {
      const service = new TechnicalRestartService();
      let signalCount = 0;
      service.sendShutdownSignal = () => {
        signalCount += 1;
      };

      await service.restartServer(actor);
      await Bun.sleep(400);

      expect(signalCount).toBe(1);
    });

    it("повторный запрос перезапуска отклоняется, сигнал подаётся один раз (TASK-46)", async () => {
      const service = new TechnicalRestartService();
      let signalCount = 0;
      service.sendShutdownSignal = () => {
        signalCount += 1;
      };

      await service.restartServer(actor);
      await expect(service.restartServer(actor)).rejects.toThrow(ConflictException);
      await expect(service.restartServer(actor)).rejects.toThrow("Перезапуск уже запланирован");
      await Bun.sleep(400);

      expect(signalCount).toBe(1);
    });

    it("отказ повторного перезапуска логируется на error (TASK-217.9)", async () => {
      const service = new TechnicalRestartService();
      service.sendShutdownSignal = () => {};
      const errorSpy = spyOn(
        (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        "error",
      );

      await service.restartServer(actor);
      await expect(service.restartServer(actor)).rejects.toThrow(ConflictException);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it("повторный scheduleShutdown до сигнала отклоняется", async () => {
      const service = new TechnicalRestartService();
      service.sendShutdownSignal = () => {};

      expect(service.scheduleShutdown()).toBe(true);
      expect(service.scheduleShutdown()).toBe(false);
      await Bun.sleep(400);

      expect(service.scheduleShutdown()).toBe(true);
    });
  });

  describe("гвард пересборки (TASK-267.8)", () => {
    it("отклоняет перезапуск, пока активна пересборка", async () => {
      const service = new TechnicalRestartService();
      let signalCount = 0;
      service.sendShutdownSignal = () => {
        signalCount += 1;
      };
      service.setRestartGuard(() => true);

      await expect(service.restartServer(actor)).rejects.toThrow(ConflictException);
      await expect(service.restartServer(actor)).rejects.toThrow(
        "Перезапуск отклонён: идёт пересборка",
      );
      await Bun.sleep(400);

      expect(signalCount).toBe(0);
    });

    it("пропускает перезапуск после снятия гварда", async () => {
      const service = new TechnicalRestartService();
      let signalCount = 0;
      service.sendShutdownSignal = () => {
        signalCount += 1;
      };
      let rebuildInProgress = true;
      service.setRestartGuard(() => rebuildInProgress);

      await expect(service.restartServer(actor)).rejects.toThrow(ConflictException);
      rebuildInProgress = false;
      await service.restartServer(actor);
      await Bun.sleep(400);

      expect(signalCount).toBe(1);
    });

    it("isShutdownScheduled отражает окно запланированной остановки", async () => {
      const service = new TechnicalRestartService();
      service.sendShutdownSignal = () => {};

      expect(service.isShutdownScheduled()).toBe(false);
      expect(service.scheduleShutdown()).toBe(true);
      expect(service.isShutdownScheduled()).toBe(true);
      await Bun.sleep(400);

      expect(service.isShutdownScheduled()).toBe(false);
    });
  });
});
