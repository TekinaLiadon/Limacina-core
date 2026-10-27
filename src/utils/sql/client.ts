import { Logger } from "@nestjs/common";
import { SQL } from "bun";
import { mariadbDialect } from "./dialects/mariadb.dialect";
import { postgresDialect } from "./dialects/postgres.dialect";
import type { SqlDialect, SqlDialectName } from "./dialects/dialect";
import type { SqlClient } from "./types";
import { mergeSecretsIntoEnv } from "../../config/zod-env";

const sqlLogger = new Logger("Sql");

const DIALECTS: Record<SqlDialectName, SqlDialect> = {
  postgres: postgresDialect,
  mariadb: mariadbDialect,
};

export const SQL_QUERY_TIMEOUT_MS = 30_000;

export interface SqlPoolOptions {
  max: number;
  idleTimeout: number;
  connectionTimeout: number;
}

export const SQL_POOL_OPTIONS: SqlPoolOptions = {
  max: 10,
  idleTimeout: 60,
  connectionTimeout: 15,
};

type SqlPoolConstructor = new (connectionString: string, options: SqlPoolOptions) => SqlClient;

export function createSqlPoolClient(
  databaseUrl: string,
  sqlConstructor: SqlPoolConstructor,
): SqlClient {
  return new sqlConstructor(databaseUrl, { ...SQL_POOL_OPTIONS });
}

function createDefaultSqlClient(databaseUrl: string): SqlClient {
  return createSqlPoolClient(databaseUrl, SQL as unknown as SqlPoolConstructor);
}

let sqlPoolClient: SqlClient | undefined;
let sqlClientOverride: SqlClient | undefined;
let dialectOverride: SqlDialectName | undefined;
let cachedDialect: SqlDialect | undefined;
let sqlQueryTimeoutOverrideMs: number | undefined;

function assertTestRuntime(): void {
  if (!Bun.main.endsWith(".test.ts")) {
    throw new Error("Подмена SQL-клиента доступна только в тестовом окружении (bun:test)");
  }
}

export function overrideSqlClient(client: SqlClient, dialect?: SqlDialectName): void {
  assertTestRuntime();
  sqlClientOverride = client;
  dialectOverride = dialect;
  cachedDialect = undefined;
}

export function resetSqlClient(): void {
  assertTestRuntime();
  sqlClientOverride = undefined;
  dialectOverride = undefined;
  cachedDialect = undefined;
}

export function overrideSqlQueryTimeoutMs(timeoutMs: number): void {
  assertTestRuntime();
  sqlQueryTimeoutOverrideMs = timeoutMs;
}

export function resetSqlQueryTimeoutMs(): void {
  assertTestRuntime();
  sqlQueryTimeoutOverrideMs = undefined;
}

export function sqlQueryTimeoutMs(): number {
  return sqlQueryTimeoutOverrideMs ?? SQL_QUERY_TIMEOUT_MS;
}

function resolveDatabaseUrl(): string {
  const url = mergeSecretsIntoEnv()["DATABASE_URL"];
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("DATABASE_URL не задан — SQL-пул не может быть создан");
  }
  return url;
}

export function currentSqlClient(): SqlClient {
  if (sqlClientOverride) return sqlClientOverride;
  sqlPoolClient ??= createDefaultSqlClient(resolveDatabaseUrl());
  return sqlPoolClient;
}

export function currentDialect(): SqlDialect {
  if (dialectOverride) return DIALECTS[dialectOverride];
  if (sqlClientOverride) return DIALECTS.postgres;
  cachedDialect ??= detectDialect();
  return cachedDialect;
}

export function sqlDialect(): SqlDialectName {
  return currentDialect().name;
}

function detectDialect(): SqlDialect {
  return resolveSqlDialect(mergeSecretsIntoEnv());
}

export function resolveSqlDialect(env: Record<string, unknown>): SqlDialect {
  const url = env["DATABASE_URL"];
  return typeof url === "string" && /^(mariadb|mysql):/.test(url)
    ? DIALECTS.mariadb
    : DIALECTS.postgres;
}

export async function closeSqlPool(): Promise<void> {
  const pool = sqlPoolClient;
  if (!pool) return;
  sqlPoolClient = undefined;
  try {
    await pool.close();
  } catch (error) {
    sqlLogger.error({ err: error }, "Не удалось закрыть пул SQL-соединений");
  }
}
