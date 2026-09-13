import type { QueryResult, SqlValue } from "../types";

export type SqlDialectName = "postgres" | "mariadb";

export interface SqlDialect {
  readonly name: SqlDialectName;
  toClientQuery(sql: string, values: SqlValue[]): { sql: string; values: unknown[] };
  toQueryResult(raw: unknown): QueryResult<Record<string, unknown>>;
  renderReturning(columns: string[]): string | null;
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1;
}
