import { mariadbDialect } from "./dialects/mariadb.dialect";
import { postgresDialect } from "./dialects/postgres.dialect";
import type { SqlDialect, SqlDialectName } from "./dialects/dialect";
import type { SqlClient } from "./types";
import { mergeSecretsIntoEnv } from "../../config/zod-env";

const DIALECTS: Record<SqlDialectName, SqlDialect> = {
  postgres: postgresDialect,
  mariadb: mariadbDialect,
};

const bunSql: SqlClient = ((await import("bun")) as unknown as { sql: SqlClient }).sql;

let sqlClientOverride: SqlClient | undefined;
let dialectOverride: SqlDialectName | undefined;
let cachedDialect: SqlDialect | undefined;

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

export function currentSqlClient(): SqlClient {
  return sqlClientOverride ?? bunSql;
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
