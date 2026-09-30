import { describe, expect, it, spyOn } from "bun:test";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InternalServerErrorException, Logger } from "@nestjs/common";
import {
  buildInstallCommand,
  buildStepEnv,
  currentRevision,
  runStep,
  terminateActiveSteps,
} from "../technical-steps";

describe("technical-steps", (): void => {
  describe("runStep", () => {
    const logger = new Logger("runStep");

    it("выполняет шаг с нулевым кодом выхода", async () => {
      await runStep(logger, "version", ["bun", "--version"], 30_000);
    });

    it("бросает 500 при ненулевом коде выхода", async () => {
      await expect(
        runStep(logger, "fail-step", ["bun", "-e", "process.exit(3)"], 30_000),
      ).rejects.toThrow(InternalServerErrorException);
      await expect(
        runStep(logger, "fail-step", ["bun", "-e", "process.exit(3)"], 30_000),
      ).rejects.toThrow("fail-step");
    });

    it("прерывает зависший шаг по таймауту", async () => {
      await expect(
        runStep(logger, "hang-step", ["bun", "-e", "await Bun.sleep(30_000)"], 300),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("отличает таймаут шага от обычного ненулевого кода выхода", async () => {
      const errorSpy = spyOn(logger, "error");
      try {
        await expect(
          runStep(logger, "hang-step", ["bun", "-e", "await Bun.sleep(30_000)"], 300),
        ).rejects.toThrow(/таймаут/);

        const [call] = errorSpy.mock.calls;
        if (!call) throw new Error("logger.error не вызван");
        const [payload, message] = call as [{ timeoutMs?: number }, string];
        expect(message).toContain("таймауту");
        expect(message).toContain("hang-step");
        expect(payload.timeoutMs).toBe(300);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("дренирует вывод болтливого шага, не обрывая его", async () => {
      await runStep(
        logger,
        "chatty-step",
        ["bun", "-e", "for (let i = 0; i < 10000; i++) console.log('x'.repeat(200))"],
        30_000,
      );
    });

    it("обрезает болтливый вывод в логе ошибки", async () => {
      const errorSpy = spyOn(logger, "error");
      try {
        await expect(
          runStep(
            logger,
            "chatty-fail",
            ["bun", "-e", "console.log('y'.repeat(10000)); process.exit(7)"],
            30_000,
          ),
        ).rejects.toThrow(InternalServerErrorException);

        const [call] = errorSpy.mock.calls;
        if (!call) throw new Error("logger.error не вызван");
        const [payload] = call as [{ stdout?: string }];
        expect(payload.stdout?.endsWith("…[обрезано]")).toBe(true);
        expect(payload.stdout?.length).toBeLessThanOrEqual(2011);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("возвращает 500 вместо сырой ошибки при отсутствии команды", async () => {
      await expect(
        runStep(logger, "missing-step", ["limacina-missing-cmd-xyz"], 5000),
      ).rejects.toThrow(InternalServerErrorException);
      await expect(
        runStep(logger, "missing-step", ["limacina-missing-cmd-xyz"], 5000),
      ).rejects.toThrow("missing-step");
    });

    it("эскалирует SIGKILL для процесса, игнорирующего SIGTERM", async () => {
      await expect(
        runStep(
          logger,
          "hang-step",
          ["bun", "-e", "process.on('SIGTERM', () => {}); await Bun.sleep(30_000)"],
          250,
          300,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("передаёт GIT_SSH_COMMAND в окружение шага", async () => {
      await runStep(
        logger,
        "env-step",
        [
          "bun",
          "-e",
          "process.exit(process.env.GIT_SSH_COMMAND === 'ssh -o BatchMode=yes' ? 0 : 9)",
        ],
        30_000,
      );
    });
  });

  describe("terminateActiveSteps", () => {
    const logger = new Logger("terminateActiveSteps");

    it("прерывает активный шаг конвейера", async () => {
      const pending = runStep(logger, "sleep-step", ["sleep", "5"], 30_000);
      pending.catch(() => {});

      await terminateActiveSteps(1000);

      const error: unknown = await pending.then(
        () => {
          throw new Error("шаг не был прерван");
        },
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).toContain("sleep-step");
    });

    it("без активных шагов завершается без действий", async () => {
      await terminateActiveSteps(100);
    });

    it("завершает внуков, переживших родительский шаг", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-grandchild-"));
      const pidPath = join(dir, "grandchild.pid");
      const script =
        'const proc = Bun.spawn(["bun", "-e", "await Bun.sleep(30000)"], ' +
        '{ stdio: ["ignore", "ignore", "ignore"] });' +
        `await Bun.write(${JSON.stringify(pidPath)}, String(proc.pid));` +
        "process.exit(0);";
      try {
        await runStep(logger, "grandchild-step", ["bun", "-e", script], 30_000);

        const grandchildPid = Number(await Bun.file(pidPath).text());
        expect(grandchildPid).toBeGreaterThan(0);
        const deadline = Date.now() + 3000;
        let alive = true;
        while (Date.now() < deadline) {
          try {
            process.kill(grandchildPid, 0);
          } catch {
            alive = false;
            break;
          }
          await Bun.sleep(50);
        }
        expect(alive).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("currentRevision", () => {
    const logger = new Logger("currentRevision");

    it("возвращает хеш текущего коммита", async () => {
      expect((await currentRevision(logger)).length).toBe(40);
    });

    it("возвращает unknown вне git-репозитория", async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "limacina-rev-"));
      try {
        expect(await currentRevision(logger, outsideDir)).toBe("unknown");
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("прерывает зависший git-процесс по таймауту с доменной ошибкой", async () => {
      let killProcess: (code: number) => void = () => {};
      const streamClosers: Array<() => void> = [];
      const makeStream = (): ReadableStream<Uint8Array> =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamClosers.push(() => controller.close());
          },
        });
      const fakeProc = {
        pid: 987_654_321,
        exited: new Promise<number>((resolve) => {
          killProcess = resolve;
        }),
        stdout: makeStream(),
        stderr: makeStream(),
        kill: (): void => {
          killProcess(-15);
          for (const close of streamClosers) close();
        },
      } as unknown as Bun.Subprocess<Bun.SpawnOptions.Writable, "pipe", "pipe">;

      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
        (() => fakeProc) as unknown as typeof Bun.spawn,
      );
      try {
        await expect(currentRevision(logger, process.cwd(), 200)).rejects.toThrow(
          InternalServerErrorException,
        );
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe("buildInstallCommand", () => {
    it("добавляет --frozen-lockfile при наличии лок-файла", () => {
      expect(buildInstallCommand(true)).toEqual(["bun", "install", "--frozen-lockfile"]);
    });

    it("без лок-файла запускает обычную установку", () => {
      expect(buildInstallCommand(false)).toEqual(["bun", "install"]);
    });
  });

  describe("buildStepEnv", () => {
    it("передаёт GIT_SSH_COMMAND и не пропускает SECRETS дочерним процессам", () => {
      const savedSecrets = process.env["SECRETS"];
      process.env["SECRETS"] = JSON.stringify({ JWT_ACCESS: "super-secret-value" });
      try {
        const stepEnv = buildStepEnv();
        expect(stepEnv["GIT_SSH_COMMAND"]).toBe("ssh -o BatchMode=yes");
        expect("SECRETS" in stepEnv).toBe(false);
        expect(JSON.stringify(stepEnv)).not.toContain("super-secret-value");
      } finally {
        if (savedSecrets === undefined) delete process.env["SECRETS"];
        else process.env["SECRETS"] = savedSecrets;
      }
    });
  });
});
