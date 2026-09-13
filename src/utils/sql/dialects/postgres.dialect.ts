import type { QueryResult, SqlValue } from "../types";
import type { SqlDialect } from "./dialect";

interface PgResult {
  rows?: Record<string, unknown>[];
  count?: number;
}

export const postgresDialect: SqlDialect = {
  name: "postgres",
  toClientQuery(sql: string, values: SqlValue[]): { sql: string; values: unknown[] } {
    return { sql, values };
  },
  toQueryResult(raw: unknown): QueryResult<Record<string, unknown>> {
    const result = raw as PgResult;
    const rows = Array.isArray(raw) ? raw : (result.rows ?? []);
    const count = rows.length > 0 ? rows.length : (result.count ?? 0);
    return { rows, count };
  },
  renderReturning(columns: string[]): string | null {
    return ` RETURNING ${columns.join(", ")}`;
  },
};
