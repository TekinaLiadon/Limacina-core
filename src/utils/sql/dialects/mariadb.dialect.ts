import type { QueryResult, SqlValue } from "../types";
import { replaceSqlPlaceholders } from "../placeholders";
import {
  renderReturningClause,
  queryRowsFromResult,
  type ReturningStatement,
  type SqlDialect,
} from "./dialect";

interface MariaResult {
  count?: number;
  affectedRows?: number;
}

const STRING_LITERAL_PATTERN = String.raw`'(?:[^'\\]|''|\\[\s\S])*'`;

export const mariadbDialect: SqlDialect = {
  name: "mariadb",
  stringLiteralPattern: STRING_LITERAL_PATTERN,
  toClientQuery(sql: string, values: SqlValue[]): { sql: string; values: unknown[] } {
    const adaptedValues: unknown[] = [];
    let maxPlaceholderIndex = 0;
    const adaptedSql = replaceSqlPlaceholders(
      sql,
      (index) => {
        const value = values[index - 1];
        if (value === undefined) {
          throw new Error(
            `Плейсхолдеру $${index} не соответствует значение (передано значений: ${values.length})`,
          );
        }
        maxPlaceholderIndex = Math.max(maxPlaceholderIndex, index);
        adaptedValues.push(value);
        return "?";
      },
      STRING_LITERAL_PATTERN,
    );
    if (maxPlaceholderIndex !== values.length) {
      throw new Error(
        `Число значений (${values.length}) не совпадает с плейсхолдерами SQL (максимальный $${maxPlaceholderIndex})`,
      );
    }
    return { sql: adaptedSql, values: adaptedValues };
  },
  toQueryResult(raw: unknown): QueryResult<Record<string, unknown>> {
    const rows = queryRowsFromResult(raw);
    const { affectedRows } = raw as MariaResult;
    const count = rows.length > 0 ? rows.length : (affectedRows ?? (raw as MariaResult).count ?? 0);
    return { rows, count };
  },
  renderReturning(columns: string[], statement: ReturningStatement): string | null {
    if (statement === "update") return null;
    return renderReturningClause(columns);
  },
};
