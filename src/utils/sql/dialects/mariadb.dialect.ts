import type { QueryResult, SqlValue } from "../types";
import type { SqlDialect } from "./dialect";

interface MariaResult {
  rows?: Record<string, unknown>[];
  count?: number;
  affectedRows?: number;
}

export const mariadbDialect: SqlDialect = {
  name: "mariadb",
  toClientQuery(sql: string, values: SqlValue[]): { sql: string; values: unknown[] } {
    const adaptedValues: unknown[] = [];
    const adaptedSql = sql.replace(/\$(\d+)/g, (_match, index: string) => {
      adaptedValues.push(values[Number(index) - 1]);
      return "?";
    });
    return { sql: adaptedSql, values: adaptedValues };
  },
  toQueryResult(raw: unknown): QueryResult<Record<string, unknown>> {
    const rows = Array.isArray(raw) ? raw : ((raw as MariaResult).rows ?? []);
    const affectedRows = (raw as MariaResult).affectedRows;
    const count = rows.length > 0 ? rows.length : (affectedRows ?? (raw as MariaResult).count ?? 0);
    return { rows, count };
  },
  renderReturning(columns: string[]): string | null {
    return ` RETURNING ${columns.join(", ")}`;
  },
};
