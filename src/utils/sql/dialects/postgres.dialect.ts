import type { QueryResult, SqlValue } from "../types";
import { queryRowsFromResult, renderReturningClause, type SqlDialect } from "./dialect";

interface PgResult {
  count?: number;
}

export const postgresDialect: SqlDialect = {
  name: "postgres",
  toClientQuery(sql: string, values: SqlValue[]): { sql: string; values: unknown[] } {
    return { sql, values };
  },
  toQueryResult(raw: unknown): QueryResult<Record<string, unknown>> {
    const rows = queryRowsFromResult(raw);
    const count = rows.length > 0 ? rows.length : ((raw as PgResult).count ?? 0);
    return { rows, count };
  },
  renderReturning(columns: string[]): string | null {
    return renderReturningClause(columns);
  },
};
