import { currentDialect } from "./client";
import type { ReturningStatement } from "./dialects/dialect";
import {
  addAnd,
  addWhere,
  assertStaticFragment,
  buildWhereClause,
  buildWithWhere,
  createWhereState,
  type WhereState,
} from "./fragments";
import { renumberSqlPlaceholders } from "./placeholders";
import type { BuiltQuery, OrderDirection, SelectBuilder, SqlValue, TableName } from "./types";

interface WithBuild {
  build: () => BuiltQuery;
}

interface WithReturning {
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface InsertFrom {
  values: (...vals: SqlValue[]) => InsertAfterValues;
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface InsertAfterValues {
  values: (...vals: SqlValue[]) => InsertAfterValues;
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface UpdateFrom {
  set: (column: string, value: SqlValue) => UpdateSet;
  build: () => BuiltQuery;
}

interface UpdateSet {
  set: (column: string, value: SqlValue) => UpdateSet;
  where: (condition: string, ...args: SqlValue[]) => WithReturning;
  build: () => BuiltQuery;
}

interface DeleteBuilder {
  where: (condition: string, ...args: SqlValue[]) => WithBuild;
  build: () => BuiltQuery;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name}: ожидается неотрицательное целое число, получено ${value}`);
  }
}

function assertHasWhere(parts: string[], statement: string): void {
  if (parts.length === 0) {
    throw new Error(
      `${statement} без where() запрещён — условие должно ограничивать область изменения`,
    );
  }
}

function appendReturning(
  baseSql: string,
  columns: string[],
  statement: ReturningStatement,
): string {
  for (const column of columns) assertStaticFragment(column);
  const clause = currentDialect().renderReturning(columns, statement);
  if (clause === null) {
    throw new Error(
      `Диалект "${currentDialect().name}" не поддерживает RETURNING — используйте SELECT после записи`,
    );
  }
  return `${baseSql}${clause}`;
}

function buildInsert(
  table: TableName,
  columns: string[],
  allValues: SqlValue[][],
  returning?: string[],
): BuiltQuery {
  if (columns.length === 0) {
    throw new Error("INSERT без колонок — перечислите колонки в insertQuery()");
  }
  if (allValues.length === 0) {
    throw new Error("INSERT без значений — вызовите values()");
  }
  for (const column of columns) assertStaticFragment(column);
  const rows: string[] = [];
  let placeholderIndex = 0;
  for (const rowValues of allValues) {
    if (rowValues.length !== columns.length) {
      throw new Error(
        `INSERT ожидает ${columns.length} значений на строку, получено ${rowValues.length}`,
      );
    }
    const placeholders = rowValues.map(() => `$${++placeholderIndex}`).join(", ");
    rows.push(`(${placeholders})`);
  }
  const base = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${rows.join(", ")}`;
  const sqlStr = returning ? appendReturning(base, returning, "insert") : base;
  return { sql: sqlStr, values: allValues.flat() };
}

export function selectQuery(...columns: string[]): {
  from: (table: TableName, alias?: string) => SelectBuilder;
} {
  for (const column of columns) assertStaticFragment(column);
  const cols = columns.length > 0 ? columns.join(", ") : "*";

  return {
    from: (table: TableName, alias?: string) => {
      const state = createWhereState();
      const orderParts: string[] = [];
      const tableRef = alias ? `${table} ${alias}` : table;
      let fromClause = `SELECT ${cols} FROM ${tableRef}`;
      let limitValue: number | undefined;
      let offsetValue: number | undefined;
      let forUpdateValue = false;

      const buildSelect = (): BuiltQuery => {
        const whereClause = buildWhereClause(state);
        const orderClause = orderParts.length > 0 ? ` ORDER BY ${orderParts.join(", ")}` : "";
        const limitClause = limitValue !== undefined ? ` LIMIT ${limitValue}` : "";
        const offsetClause = offsetValue !== undefined ? ` OFFSET ${offsetValue}` : "";
        const forUpdateClause = forUpdateValue ? " FOR UPDATE" : "";
        return {
          sql: `${fromClause}${whereClause}${orderClause}${limitClause}${offsetClause}${forUpdateClause}`,
          values: state.values,
        };
      };

      const builder: SelectBuilder = {
        join: (type: string, joinTable: TableName, joinAlias: string, on: string) => {
          assertStaticFragment(type);
          assertStaticFragment(on);
          fromClause += ` ${type} ${joinTable} ${joinAlias} ON ${on}`;
          return builder;
        },
        where: (condition: string, ...args: SqlValue[]) => {
          if (state.parts.length === 0) {
            addWhere(state, condition, ...args);
          } else {
            addAnd(state, condition, ...args);
          }
          return builder;
        },
        and: (condition: string, ...args: SqlValue[]) => {
          addAnd(state, condition, ...args);
          return builder;
        },
        orderBy: (column: string, direction: OrderDirection = "asc") => {
          assertStaticFragment(column);
          orderParts.push(`${column} ${direction.toUpperCase()}`);
          return builder;
        },
        limit: (n: number) => {
          assertNonNegativeInteger(n, "limit");
          limitValue = n;
          return builder;
        },
        offset: (n: number) => {
          assertNonNegativeInteger(n, "offset");
          offsetValue = n;
          return builder;
        },
        forUpdate: () => {
          forUpdateValue = true;
          return builder;
        },
        build: buildSelect,
      };

      return builder;
    },
  };
}

export function insertQuery(...columns: string[]): {
  from: (table: TableName) => InsertFrom;
} {
  return {
    from: (table: TableName) => {
      const allValues: SqlValue[][] = [];

      const withRows = (): InsertAfterValues => ({
        values: pushRow,
        returning: (...ret: string[]) => ({
          build: () => buildInsert(table, columns, allValues, ret),
        }),
        build: () => buildInsert(table, columns, allValues),
      });

      const pushRow = (...vals: SqlValue[]): InsertAfterValues => {
        allValues.push(vals);
        return withRows();
      };

      return {
        values: pushRow,
        returning: (...ret: string[]) => ({
          build: () => buildInsert(table, columns, allValues, ret),
        }),
        build: () => buildInsert(table, columns, allValues),
      };
    },
  };
}

export function updateQuery(): {
  from: (table: TableName) => UpdateFrom;
} {
  return {
    from: (table: TableName) => {
      const setClauses: string[] = [];
      const values: SqlValue[] = [];
      const whereState: WhereState = createWhereState();

      const buildUpdate = (): BuiltQuery => {
        if (setClauses.length === 0) {
          throw new Error("UPDATE без set() запрещён — укажите изменяемые колонки");
        }
        assertHasWhere(whereState.parts, "UPDATE");
        const whereClause = buildWhereClause(whereState);
        const sqlStr = `UPDATE ${table} SET ${setClauses.join(", ")}${whereClause}`;
        return { sql: sqlStr, values: [...values, ...whereState.values] };
      };

      const addSet = (column: string, value: SqlValue): UpdateSet => {
        assertStaticFragment(column);
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(value);

        return {
          set: addSet,
          where: (condition: string, ...args: SqlValue[]) => {
            const offset = values.length;
            const renumbered = renumberSqlPlaceholders(condition, offset);
            addWhere(whereState, renumbered, ...args);

            return {
              returning: (...ret: string[]) => ({
                build: () => {
                  const built = buildUpdate();
                  return {
                    sql: appendReturning(built.sql, ret, "update"),
                    values: built.values,
                  };
                },
              }),
              build: buildUpdate,
            };
          },
          build: buildUpdate,
        };
      };

      return { set: addSet, build: buildUpdate };
    },
  };
}

export function deleteQuery(): {
  from: (table: TableName) => DeleteBuilder;
} {
  return {
    from: (table: TableName) => {
      const state = createWhereState();

      const buildDelete = (): BuiltQuery => {
        assertHasWhere(state.parts, "DELETE");
        return buildWithWhere(`DELETE FROM ${table}`, state);
      };

      return {
        where: (condition: string, ...args: SqlValue[]) => {
          addWhere(state, condition, ...args);

          return {
            build: buildDelete,
          };
        },
        build: buildDelete,
      };
    },
  };
}

export function updateColumnQuery(
  table: TableName,
  column: string,
  value: SqlValue,
  condition: string,
  conditionValue: SqlValue,
): BuiltQuery {
  return updateQuery().from(table).set(column, value).where(condition, conditionValue).build();
}

export function setSoftDeletedQuery(
  table: TableName,
  condition: string,
  conditionValue: SqlValue,
  deleted: boolean,
): BuiltQuery {
  return updateQuery()
    .from(table)
    .set("deleted", deleted)
    .set("deleted_at", deleted ? new Date() : null)
    .where(`${condition} AND deleted = ${deleted ? "false" : "true"}`, conditionValue)
    .build();
}
