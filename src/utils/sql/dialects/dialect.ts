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

export function renderReturningClause(columns: string[]): string {
  return ` RETURNING ${columns.join(", ")}`;
}

export function queryRowsFromResult(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw;
  const { rows } = raw as { rows?: Record<string, unknown>[] };
  return rows ?? [];
}
