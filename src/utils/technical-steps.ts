import { InternalServerErrorException, Logger } from "@nestjs/common";
import { join } from "node:path";

const STEP_OUTPUT_LIMIT = 2000;
const STEP_OUTPUT_CAPTURE_LIMIT = 4096;
const REVISION_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 5_000;

export function buildStepEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { SECRETS: _secrets, ...stepEnv } = env;
  return { ...stepEnv, GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

const STEP_ENV = buildStepEnv();

export function truncateOutput(output: string): string {
  if (output.length <= STEP_OUTPUT_LIMIT) return output;
  return `${output.slice(0, STEP_OUTPUT_LIMIT)}…[обрезано]`;
}

async function readStepOutput(
  stream: ReadableStream<Uint8Array>,
  captureLimit: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (output.length >= captureLimit) continue;
    output += decoder.decode(value, { stream: true });
    if (output.length > captureLimit) {
      output = output.slice(0, captureLimit);
    }
  }
  return output + decoder.decode();
}

function signalProcessGroup(proc: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessTree(proc: Bun.Subprocess, graceMs: number): Promise<void> {
  signalProcessGroup(proc, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(proc.pid)) {
      return;
    }
    await Bun.sleep(100);
  }
  signalProcessGroup(proc, "SIGKILL");
}

const activeStepProcesses = new Set<Bun.Subprocess>();

export async function terminateActiveSteps(graceMs: number = KILL_GRACE_MS): Promise<void> {
  await Promise.all([...activeStepProcesses].map((proc) => terminateProcessTree(proc, graceMs)));
}

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runCommand(
  command: string[],
  cwd: string,
  timeoutMs: number,
  killGraceMs = KILL_GRACE_MS,
): Promise<CommandRun> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: STEP_ENV,
    detached: true,
  });
  activeStepProcesses.add(proc);

  let escalation: Promise<void> | undefined;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    escalation = terminateProcessTree(proc, killGraceMs);
  }, timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      readStepOutput(proc.stdout, STEP_OUTPUT_CAPTURE_LIMIT),
      readStepOutput(proc.stderr, STEP_OUTPUT_CAPTURE_LIMIT),
    ]);
    clearTimeout(timeout);
    if (!escalation && processGroupAlive(proc.pid)) {
      escalation = terminateProcessTree(proc, killGraceMs);
    }
    if (escalation) {
      await escalation;
    }
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timeout);
    activeStepProcesses.delete(proc);
  }
}

export interface StepRunOptions {
  logger: Logger;
  step: string;
  command: string[];
  timeoutMs: number;
  cwd: string;
  killGraceMs?: number;
  logSubject: string;
  logFields?: Record<string, unknown>;
  failurePrefix: string;
  failureSuffix: string;
  createFailure: (message: string, cause?: unknown) => Error;
}

export async function runStepWithOptions(options: StepRunOptions): Promise<void> {
  const { logger, step, command, timeoutMs, cwd } = options;
  const baseLogFields = { step, command: command.join(" "), ...options.logFields };

  let run: CommandRun;
  try {
    run = await runCommand(command, cwd, timeoutMs, options.killGraceMs ?? KILL_GRACE_MS);
  } catch (error) {
    logger.error({ ...baseLogFields, err: error }, `Шаг ${options.logSubject} не запущен: ${step}`);
    throw options.createFailure(
      `${options.failurePrefix} на шаге ${step}: команда не запущена${options.failureSuffix}`,
      error,
    );
  }

  if (run.timedOut) {
    logger.error(
      {
        ...baseLogFields,
        timeoutMs,
        stdout: truncateOutput(run.stdout),
        stderr: truncateOutput(run.stderr),
      },
      `Шаг ${options.logSubject} прерван по таймауту: ${step}`,
    );
    throw options.createFailure(
      `${options.failurePrefix} на шаге ${step}: превышен таймаут ${timeoutMs} мс${options.failureSuffix}`,
    );
  }

  if (run.exitCode !== 0) {
    logger.error(
      {
        ...baseLogFields,
        exitCode: run.exitCode,
        stdout: truncateOutput(run.stdout),
        stderr: truncateOutput(run.stderr),
      },
      `Шаг ${options.logSubject} не выполнен: ${step}`,
    );
    throw options.createFailure(`${options.failurePrefix} на шаге ${step}${options.failureSuffix}`);
  }
  logger.log({ step }, `Шаг ${options.logSubject} выполнен`);
}

export async function runStep(
  logger: Logger,
  step: string,
  command: string[],
  timeoutMs: number,
  killGraceMs = KILL_GRACE_MS,
): Promise<void> {
  await runStepWithOptions({
    logger,
    step,
    command,
    timeoutMs,
    killGraceMs,
    cwd: process.cwd(),
    logSubject: "перезапуска",
    failurePrefix: "Пересборка не удалась",
    failureSuffix: ", перезапуск отменён",
    createFailure: (message) => new InternalServerErrorException(message),
  });
}

export async function currentRevision(
  logger: Logger,
  cwd: string = process.cwd(),
  timeoutMs: number = REVISION_TIMEOUT_MS,
): Promise<string> {
  let run: CommandRun;
  try {
    run = await runCommand(["git", "rev-parse", "HEAD"], cwd, timeoutMs);
  } catch (error) {
    logger.error({ err: error }, "Не удалось запустить git для определения ревизии");
    return "unknown";
  }

  if (run.timedOut) {
    logger.error({ cwd, timeoutMs }, "Превышен таймаут определения ревизии git");
    throw new InternalServerErrorException(
      "Пересборка не удалась: не удалось определить ревизию git, перезапуск отменён",
    );
  }
  if (run.exitCode !== 0) {
    logger.error(
      { cwd, exitCode: run.exitCode, stderr: truncateOutput(run.stderr) },
      "Не удалось определить ревизию git",
    );
    return "unknown";
  }
  return run.stdout.trim();
}

export function buildInstallCommand(frozenLockfile: boolean): string[] {
  return frozenLockfile ? ["bun", "install", "--frozen-lockfile"] : ["bun", "install"];
}

export const LOCKFILE_NAMES = ["bun.lock", "bun.lockb"];

export async function hasLockfile(dir: string): Promise<boolean> {
  for (const lockfileName of LOCKFILE_NAMES) {
    if (await Bun.file(join(dir, lockfileName)).exists()) {
      return true;
    }
  }
  return false;
}
