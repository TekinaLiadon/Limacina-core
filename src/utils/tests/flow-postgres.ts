/**
 * Харнес сквозных флоу-тестов (src/e2e/flows/): реальное приложение (bootstrap из src/main.ts)
 * против одноразовой БД limacina_flow на локальном дев-постгресе.
 *
 * Файлы скипаются без DATABASE_URL (как в CI) и при нелокальном хосте БД или SKIP_FLOW_TESTS=1.
 * Каждый файл получает чистую БД (DROP + CREATE + миграции сабпроцессом) — порядок файлов не важен.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import type { INestApplication } from "@nestjs/common";
import { bootstrap } from "../../main";
import { AuthPostgresStore } from "../../auth/service/auth_postgres_store";
import { generateUuid } from "../uuid";
import { overrideSqlClient, resetSqlClient, type SqlClient } from "../sql";
import { setupTestEnv } from "./test-env";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
export const FLOW_DB_NAME = "limacina_flow";
export const BOOTSTRAP_TOKEN_PATH = join(REPO_ROOT, "bootstrap.token");
const TEXTURE_DIRS = ["textures", "capes", "models"].map((dir) => join(REPO_ROOT, "public", dir));

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Имя одноразовой БД — уникально на процесс, чтобы файлы можно было гнать параллельно. */
export function flowDbName(): string {
  return `${FLOW_DB_NAME}_${process.pid}`;
}

/** Флоу-тесты выполняются только против локального постгреса и не запускаются в CI. */
export function flowTestsEnabled(): boolean {
  if (process.env["SKIP_FLOW_TESTS"] === "1") return false;
  const url = process.env["DATABASE_URL"];
  if (!url || !url.startsWith("postgres:")) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function serverUrlFrom(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString().replace(/\/$/, "");
}

export function flowDbUrlFrom(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${flowDbName()}`;
  return url.toString().replace(/\/$/, "");
}

async function dropFlowDb(adminUrl: string): Promise<void> {
  const admin = new SQL(adminUrl) as unknown as SqlClient;
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${flowDbName()} WITH (FORCE)`, []);
  } finally {
    await admin.close().catch(() => {});
  }
}

async function runMigrations(flowUrl: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "migrate:up"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: flowUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Миграции флоу-БД упали (код ${exitCode}):\n${stderr}`);
  }
}

/** Бэкап/восстановление gitignored-файлов репо, которые флоу-тесты мутируют. */
export class RepoFileBackup {
  private readonly saved = new Map<string, string | null>();

  /** Переместить файл/каталог в сторону (запомнив состояние) до мутаций теста. */
  moveAside(path: string): void {
    if (this.saved.has(path)) return;
    if (existsSync(path)) {
      const stash = `${path}.flowbak`;
      rmSync(stash, { force: true, recursive: true });
      renameSync(path, stash);
      this.saved.set(path, stash);
    } else {
      this.saved.set(path, null);
    }
  }

  restore(): void {
    for (const [path, stash] of [...this.saved.entries()].toReversed()) {
      if (stash === null) {
        rmSync(path, { force: true, recursive: true });
        continue;
      }
      if (existsSync(path)) rmSync(path, { force: true, recursive: true });
      renameSync(stash, path);
    }
    this.saved.clear();
  }
}

export interface FlowApp {
  app: INestApplication;
  baseUrl: string;
  /** URL одноразовой БД — для прямых SQL-манипуляций (через execute() utils/sql). */
  dbUrl: string;
  /** Овнер из options.owner, залогиненный по HTTP (фикстура для сценариев файла). */
  owner?: AuthData | undefined;
  cleanup(): Promise<void>;
}

export interface BootFlowOptions {
  /** Дополнительные env-переменные приложения (задаются до bootstrap, читаются при старте). */
  env?: Record<string, string>;
  /** Дополнительно убрать в сторону перед стартом (пути от корня репо). */
  moveAside?: string[];
  /**
   * Засидировать овнера прямым сохранением через AuthPostgresStore до старта приложения
   * (тогда bootstrap.token не создаётся) и залогинить его по HTTP. Файлам, где init-owner —
   * не тестируемый сценарий, это даёт овнера-фикстуру без общего файла токена.
   */
  owner?: { username: string; password: string };
}

/**
 * Поднять реальное приложение против свежей флоу-БД.
 * Вызывать в beforeAll; cleanup() — в afterAll.
 */
export async function bootFlowApp(options: BootFlowOptions = {}): Promise<FlowApp> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl || !flowTestsEnabled()) {
    throw new Error("bootFlowApp вызван при выключенных флоу-тестах (flowTestsEnabled() = false)");
  }

  setupTestEnv();
  const flowUrl = flowDbUrlFrom(databaseUrl);
  const savedEnv: Record<string, string | undefined> = { ...process.env };

  await dropFlowDb(serverUrlFrom(databaseUrl));
  const created = new SQL(serverUrlFrom(databaseUrl)) as unknown as SqlClient;
  try {
    await created.unsafe(`CREATE DATABASE ${flowDbName()}`, []);
  } finally {
    await created.close().catch(() => {});
  }
  await runMigrations(flowUrl);

  const backup = new RepoFileBackup();
  backup.moveAside(BOOTSTRAP_TOKEN_PATH);
  for (const relative of options.moveAside ?? []) {
    backup.moveAside(join(REPO_ROOT, relative));
  }

  process.env["DB_DRIVER"] = "postgres";
  process.env["DATABASE_URL"] = flowUrl;
  process.env["PORT"] = "0";
  // Флоу не тестируют rate limit (у него свои e2e) — высокий бакет убирает мерцание.
  process.env["RATE_LIMIT_AUTH_MAX"] = "1000";
  process.env["RATE_LIMIT_AUTH_WINDOW"] = "60000";
  for (const [key, value] of Object.entries(options.env ?? {})) {
    process.env[key] = value;
  }

  const flowClient = new SQL(flowUrl) as unknown as SqlClient;
  overrideSqlClient(flowClient, "postgres");

  if (options.owner) {
    const saved = await new AuthPostgresStore().saveUser({
      uuid: generateUuid(),
      username: options.owner.username,
      passwordHash: await Bun.password.hash(options.owner.password),
      role: "owner",
      approved: true,
      banned: false,
    });
    if (!saved) throw new Error(`не удалось засидировать овнера ${options.owner.username}`);
  }

  const snapshots = TEXTURE_DIRS.map((dir) => ({
    dir,
    before: new Set(existsSync(dir) ? readdirSync(dir) : []),
  }));

  const app = await bootstrap();
  const url = new URL(await app.getUrl());
  url.hostname = "127.0.0.1";
  const baseUrl = url.toString().replace(/\/$/, "");

  let owner: AuthData | undefined;
  if (options.owner) {
    owner = await loginViaApi(baseUrl, options.owner.username, options.owner.password);
    if (!owner) throw new Error("логин сидированного овнера не выполнен");
  }

  const cleanup = async (): Promise<void> => {
    await app?.close().catch(() => {});
    resetSqlClient();
    await flowClient.close().catch(() => {});
    await dropFlowDb(serverUrlFrom(databaseUrl));
    for (const { dir, before } of snapshots) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (!before.has(entry)) rmSync(join(dir, entry), { force: true, recursive: true });
      }
    }
    backup.restore();
    for (const key of Object.keys(savedEnv)) {
      if (process.env[key] !== savedEnv[key]) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    }
  };

  return { app, baseUrl, dbUrl: flowUrl, owner, cleanup };
}

export interface Api {
  get(path: string, token?: string): Promise<Response>;
  post(path: string, body?: unknown, token?: string): Promise<Response>;
  patch(path: string, body?: unknown, token?: string): Promise<Response>;
  del(path: string, token?: string): Promise<Response>;
  /** PATCH c multipart-телом (FormData) — так панель публикует релизы и конфиг. */
  patchForm(path: string, form: FormData, token?: string): Promise<Response>;
}

export function api(baseUrl: string): Api {
  const request = (
    method: string,
    path: string,
    body?: string | FormData,
    token?: string,
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (body !== undefined && !(body instanceof FormData))
      headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${path}`, { method, headers, body });
  };
  return {
    get: (path, token) => request("GET", path, undefined, token),
    post: (path, body, token) =>
      request("POST", path, body ? JSON.stringify(body) : undefined, token),
    patch: (path, body, token) =>
      request("PATCH", path, body ? JSON.stringify(body) : undefined, token),
    del: (path, token) => request("DELETE", path, undefined, token),
    patchForm: (path, form, token) => {
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      return fetch(`${baseUrl}${path}`, { method: "PATCH", headers, body: form });
    },
  };
}

export interface AuthData {
  tokens: { access_token: string; refresh_token: string };
  uuid: string;
  username: string;
  role: string;
}

/** Прочитать bootstrap-токен, созданный приложением при старте без овнера. */
export function readBootstrapToken(): string {
  if (!existsSync(BOOTSTRAP_TOKEN_PATH)) {
    throw new Error(`${BOOTSTRAP_TOKEN_PATH} не создан при старте без овнера`);
  }
  return readTokenFile();
}

function readTokenFile(): string {
  return readFileSync(BOOTSTRAP_TOKEN_PATH, "utf-8").trim();
}

/** Инициализировать овнера через реальный bootstrap-флоу (setup для остальных сценариев файла). */
export async function initOwnerViaApi(
  baseUrl: string,
  username: string,
  password: string,
): Promise<AuthData> {
  const token = readBootstrapToken();
  const response = await api(baseUrl).post("/v1/panel/users/init-owner", {
    username,
    password,
    token,
  });
  if (response.status !== 201) {
    throw new Error(`init-owner ответил ${response.status}: ${await response.text()}`);
  }
  return (await loginViaApi(baseUrl, username, password)) as AuthData;
}

export async function loginViaApi(
  baseUrl: string,
  username: string,
  password: string,
): Promise<AuthData | undefined> {
  const response = await api(baseUrl).post("/v1/common/auth/login", { username, password });
  if (response.status !== 201) return undefined;
  return (await response.json()) as AuthData;
}

/** Регистрация + одобрение через панель — готовый одобренный игрок. */
export async function createApprovedPlayer(
  baseUrl: string,
  owner: AuthData,
  username: string,
  password: string,
): Promise<AuthData> {
  const registration = await api(baseUrl).post("/v1/common/auth/registration", {
    username,
    password,
  });
  if (registration.status !== 201) {
    throw new Error(`регистрация ${username} ответила ${registration.status}`);
  }
  const approve = await api(baseUrl).patch(
    "/v1/panel/users/approve",
    { username, approved: true },
    owner.tokens.access_token,
  );
  if (approve.status !== 200) {
    throw new Error(`approve ${username} ответил ${approve.status}`);
  }
  const player = await loginViaApi(baseUrl, username, password);
  if (!player) throw new Error(`логин ${username} после approve не выполнен`);
  return player;
}
