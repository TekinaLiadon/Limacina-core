import { mariadbDialect } from "./dialects/mariadb.dialect";
import { postgresDialect } from "./dialects/postgres.dialect";
import type { SqlDialect, SqlDialectName } from "./dialects/dialect";
import type { SqlClient } from "./types";

const DIALECTS: Record<SqlDialectName, SqlDialect> = {
  postgres: postgresDialect,
  mariadb: mariadbDialect,
};

const bunSql: SqlClient = ((await import("bun")) as unknown as { sql: SqlClient }).sql;

let sqlClientOverride: SqlClient | undefined;
let dialectOverride: SqlDialectName | undefined;

export function overrideSqlClient(client: SqlClient, dialect?: SqlDialectName): void {
  sqlClientOverride = client;
  dialectOverride = dialect;
}

export function resetSqlClient(): void {
  sqlClientOverride = undefined;
  dialectOverride = undefined;
}

export function currentSqlClient(): SqlClient {
  return sqlClientOverride ?? bunSql;
}

export function currentDialect(): SqlDialect {
  if (dialectOverride) return DIALECTS[dialectOverride];
  if (sqlClientOverride) return DIALECTS.postgres;
  return detectDialect();
}

export function sqlDialect(): SqlDialectName {
  return currentDialect().name;
}

function detectDialect(): SqlDialect {
  const url = process.env["DATABASE_URL"] ?? "";
  return /^(mariadb|mysql):/.test(url) ? DIALECTS.mariadb : DIALECTS.postgres;
}
