import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { BadRequestException, Logger } from "@nestjs/common";
import {
  buildInstallCommand,
  currentRevision,
  runCommand,
  truncateOutput,
  type CommandRun,
} from "../utils/technical-steps";
import {
  DEFAULT_PANEL_BRANCH,
  DEFAULT_PANEL_PUBLIC_DIR,
  DEFAULT_PANEL_REPO_DIR,
  PANEL_DEPLOY_LOCK_TOKEN_FILENAME,
  PANEL_DIR_NAME,
  PANEL_REPO_URL,
  buildPanelBackupName,
  buildPanelDeployLockPath,
  recoverPanelBackups,
} from "./panel-deploy-dirs";

const CLONE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 60_000;
const CHECKOUT_TIMEOUT_MS = 30_000;
const BRANCH_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 300_000;
const LOCKFILE_NAMES = ["bun.lock", "bun.lockb"];
const PANEL_REF_PATTERN = /^[0-9A-Za-z._/-]+$/;
const PANEL_DEPLOY_LOCK_TIMEOUT_MS = 10_000;
export const PANEL_DEPLOY_LOCK_STALE_MS = 30 * 60_000;

export function assertValidPanelRef(ref: string): void {
  if (!ref.startsWith("-") && PANEL_REF_PATTERN.test(ref)) return;
  throw new BadRequestException(
    `Недопустимый ref для деплоя панели: ${ref}. Ожидается ветка, тег или SHA без ведущего дефиса`,
  );
}

export interface PanelDeployOptions {
  repoUrl?: string;
  repoDir?: string;
  publicDir?: string;
  lockTimeoutMs?: number;
}

export interface PanelDeployResult {
  ref: string;
  revision: string;
  panelDir: string;
}

export async function acquirePanelDeployLock(
  repoDir: string,
  timeoutMs: number,
  logger: Logger,
): Promise<string> {
  const lockDir = buildPanelDeployLockPath(repoDir);
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      mkdirSync(lockDir);
    } catch {
      if (Date.now() > deadline) {
        throw new Error(
          `Деплой панели уже выполняется (лок ${lockDir}). Дождитесь завершения активного деплоя или снимите протухший лок`,
        );
      }
      stealStalePanelDeployLock(lockDir, logger);
      await Bun.sleep(100);
      continue;
    }

    const token = randomUUID();
    writeFileSync(join(lockDir, PANEL_DEPLOY_LOCK_TOKEN_FILENAME), token);
    return token;
  }
}

export function releasePanelDeployLock(repoDir: string, token: string, logger: Logger): void {
  const lockDir = buildPanelDeployLockPath(repoDir);
  if (readPanelLockToken(lockDir) !== token) {
    logger.warn(
      { lockDir },
      "Лок деплоя панели принадлежит другому деплою — снятие чужого лока отклонено",
    );
    return;
  }

  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch (error) {
    logger.error({ err: error, lockDir }, "Не удалось снять лок деплоя панели");
  }
}

function stealStalePanelDeployLock(lockDir: string, logger: Logger): void {
  let stale = false;
  try {
    stale = Date.now() - statSync(lockDir).mtimeMs > PANEL_DEPLOY_LOCK_STALE_MS;
  } catch {
    return;
  }
  if (!stale) return;

  const stolenPath = `${lockDir}.stolen-${randomUUID()}`;
  try {
    renameSync(lockDir, stolenPath);
    logger.warn({ lockDir, stolenPath }, "Перехвачен протухший лок деплоя панели");
    rmSync(stolenPath, { recursive: true, force: true });
  } catch (error) {
    logger.warn({ err: error, lockDir }, "Не удалось перехватить протухший лок деплоя панели");
  }
}

function readPanelLockToken(lockDir: string): string | undefined {
  try {
    return readFileSync(join(lockDir, PANEL_DEPLOY_LOCK_TOKEN_FILENAME), "utf-8");
  } catch {
    return undefined;
  }
}

export async function runPanelStep(
  logger: Logger,
  step: string,
  command: string[],
  timeoutMs: number,
  cwd: string,
): Promise<void> {
  let run: CommandRun;
  try {
    run = await runCommand(command, cwd, timeoutMs);
  } catch (error) {
    logger.error(
      { err: error, step, command: command.join(" "), cwd },
      `Шаг деплоя панели не запущен: ${step}`,
    );
    throw new Error(`Деплой панели не удался на шаге ${step}: команда не запущена`, {
      cause: error,
    });
  }

  if (run.timedOut) {
    logger.error(
      {
        step,
        timeoutMs,
        cwd,
        command: command.join(" "),
        stdout: truncateOutput(run.stdout),
        stderr: truncateOutput(run.stderr),
      },
      `Шаг деплоя панели прерван по таймауту: ${step}`,
    );
    throw new Error(`Деплой панели не удался на шаге ${step}: превышен таймаут ${timeoutMs} мс`);
  }

  if (run.exitCode !== 0) {
    logger.error(
      {
        step,
        exitCode: run.exitCode,
        cwd,
        command: command.join(" "),
        stdout: truncateOutput(run.stdout),
        stderr: truncateOutput(run.stderr),
      },
      `Шаг деплоя панели не выполнен: ${step}`,
    );
    throw new Error(`Деплой панели не удался на шаге ${step}`);
  }
  logger.log({ step }, "Шаг деплоя панели выполнен");
}

export async function resolveDefaultBranch(logger: Logger, repoDir: string): Promise<string> {
  let run: CommandRun;
  try {
    run = await runCommand(
      ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoDir,
      BRANCH_TIMEOUT_MS,
    );
  } catch (error) {
    logger.warn(
      { err: error, repoDir },
      "Не удалось определить ветку по умолчанию панели, используется main",
    );
    return DEFAULT_PANEL_BRANCH;
  }

  const branch = run.stdout.trim().replace(/^origin\//, "");
  if (run.exitCode !== 0 || !branch) {
    logger.warn(
      { exitCode: run.exitCode, repoDir, stdout: truncateOutput(run.stdout) },
      "Не удалось определить ветку по умолчанию панели, используется main",
    );
    return DEFAULT_PANEL_BRANCH;
  }
  return branch;
}

export function swapPanelDirectory(
  logger: Logger,
  publicDir: string,
  buildOutputDir: string,
): void {
  const panelDir = join(publicDir, PANEL_DIR_NAME);
  const backupPath = join(publicDir, buildPanelBackupName(randomUUID()));
  const panelExists = existsSync(panelDir);
  if (panelExists) {
    renameSync(panelDir, backupPath);
  }
  try {
    renameSync(buildOutputDir, panelDir);
  } catch (error) {
    if (panelExists) {
      restorePanelBackup(logger, backupPath, panelDir);
    }
    throw error;
  }
  if (!panelExists) return;

  try {
    rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    logger.warn(
      { err: error, backup: backupPath },
      "Не удалось удалить резервную копию панели — каталог будет свипан при старте сервера",
    );
  }
}

function restorePanelBackup(logger: Logger, backupPath: string, panelDir: string): void {
  try {
    renameSync(backupPath, panelDir);
    logger.error(
      { backup: backupPath, panelDir },
      "Подмена каталога панели не удалась, предыдущая версия восстановлена",
    );
  } catch (error) {
    logger.error(
      { err: error, backup: backupPath },
      "Не удалось восстановить предыдущую панель — восстановление выполнит свип при старте сервера",
    );
  }
}

async function hasLockfile(repoDir: string): Promise<boolean> {
  for (const lockfileName of LOCKFILE_NAMES) {
    if (await Bun.file(join(repoDir, lockfileName)).exists()) {
      return true;
    }
  }
  return false;
}

export class TechnicalPanelDeployService {
  private readonly logger = new Logger(TechnicalPanelDeployService.name);
  private readonly repoUrl: string;
  private readonly repoDir: string;
  private readonly publicDir: string;
  private readonly lockTimeoutMs: number;

  constructor(options: PanelDeployOptions = {}) {
    this.repoUrl = options.repoUrl ?? PANEL_REPO_URL;
    this.repoDir = options.repoDir ?? DEFAULT_PANEL_REPO_DIR;
    this.publicDir = options.publicDir ?? DEFAULT_PANEL_PUBLIC_DIR;
    this.lockTimeoutMs = options.lockTimeoutMs ?? PANEL_DEPLOY_LOCK_TIMEOUT_MS;
  }

  async deploy(ref?: string): Promise<PanelDeployResult> {
    if (ref !== undefined) assertValidPanelRef(ref);
    const lockToken = await acquirePanelDeployLock(this.repoDir, this.lockTimeoutMs, this.logger);
    try {
      return await this.executeDeploy(ref);
    } finally {
      releasePanelDeployLock(this.repoDir, lockToken, this.logger);
    }
  }

  private async executeDeploy(ref?: string): Promise<PanelDeployResult> {
    recoverPanelBackups(this.publicDir, this.logger);
    const targetRef = await this.syncRepository(ref);
    await this.installDependencies();
    await this.buildPanel();
    const buildOutputDir = this.verifyBuildOutput();
    swapPanelDirectory(this.logger, this.publicDir, buildOutputDir);
    const revision = await currentRevision(this.logger, this.repoDir);
    const panelDir = join(this.publicDir, PANEL_DIR_NAME);
    this.logger.log({ ref: targetRef, revision, panelDir }, "Админ-панель развёрнута");
    return { ref: targetRef, revision, panelDir };
  }

  private async assertOriginMatches(): Promise<void> {
    let run: CommandRun;
    try {
      run = await runCommand(
        ["git", "remote", "get-url", "origin"],
        this.repoDir,
        BRANCH_TIMEOUT_MS,
      );
    } catch (error) {
      throw new Error(
        `Деплой панели прерван: не удалось проверить origin каталога ${this.repoDir}`,
        {
          cause: error,
        },
      );
    }

    const origin = run.stdout.trim();
    if (run.exitCode !== 0 || origin !== this.repoUrl) {
      throw new Error(
        `Деплой панели прерван: каталог чекаута ${this.repoDir} указывает на чужой репозиторий (origin: ${origin || "неизвестен"}), ожидался ${this.repoUrl}. Force-checkout не выполнялся`,
      );
    }
  }

  private async syncRepository(ref?: string): Promise<string> {
    await this.ensureRepositoryCloned();
    await this.assertOriginMatches();
    await runPanelStep(
      this.logger,
      "git fetch",
      ["git", "fetch", "origin", "--prune", "--tags"],
      FETCH_TIMEOUT_MS,
      this.repoDir,
    );

    if (ref) {
      await runPanelStep(
        this.logger,
        "git checkout",
        ["git", "checkout", "-f", ref],
        CHECKOUT_TIMEOUT_MS,
        this.repoDir,
      );
      return ref;
    }

    const branch = await resolveDefaultBranch(this.logger, this.repoDir);
    await runPanelStep(
      this.logger,
      "git checkout",
      ["git", "checkout", "-f", "-B", branch, `origin/${branch}`],
      CHECKOUT_TIMEOUT_MS,
      this.repoDir,
    );
    return branch;
  }

  private async ensureRepositoryCloned(): Promise<void> {
    if (existsSync(join(this.repoDir, ".git"))) return;

    try {
      await this.cloneRepository();
    } catch (error) {
      if (!existsSync(this.repoDir) || existsSync(join(this.repoDir, ".git"))) throw error;
      this.logger.warn(
        { repoDir: this.repoDir },
        "Каталог чекаута панели повреждён предыдущим прерванным clone — пересоздаётся",
      );
      rmSync(this.repoDir, { recursive: true, force: true });
      await this.cloneRepository();
    }
  }

  private async cloneRepository(): Promise<void> {
    await runPanelStep(
      this.logger,
      "git clone",
      ["git", "clone", this.repoUrl, this.repoDir],
      CLONE_TIMEOUT_MS,
      process.cwd(),
    );
  }

  private async installDependencies(): Promise<void> {
    await runPanelStep(
      this.logger,
      "bun install",
      buildInstallCommand(await hasLockfile(this.repoDir)),
      INSTALL_TIMEOUT_MS,
      this.repoDir,
    );
  }

  private async buildPanel(): Promise<void> {
    await runPanelStep(
      this.logger,
      "bun run build",
      ["bun", "run", "build"],
      BUILD_TIMEOUT_MS,
      this.repoDir,
    );
  }

  private verifyBuildOutput(): string {
    const buildOutputDir = join(this.repoDir, ".output", "public");
    if (!existsSync(join(buildOutputDir, "index.html"))) {
      throw new Error(
        `Сборка панели не содержит index.html, подмена каталога отменена: ${buildOutputDir}`,
      );
    }
    return buildOutputDir;
  }
}
