import { Logger } from "@nestjs/common";

const sqlLogger = new Logger("Sql");

interface SqlResult {
  rows: Record<string, unknown>[];
  count: number;
}

type BunSqlClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlResult>;
  unsafe(sql: string, values: unknown[]): Promise<SqlResult>;
};

type BunSqlFn = BunSqlClient & {
  begin(callback: (tx: BunSqlClient) => Promise<unknown>): Promise<unknown>;
  close(options?: { timeout?: number }): Promise<void>;
};

const bunSql: BunSqlFn = ((await import("bun")) as unknown as { sql: BunSqlFn }).sql;

export const TABLES = {
  users: "users",
  refresh_tokens: "refresh_tokens",
  user_textures: "user_textures",
  user_skins: "user_skins",
  user_models: "user_models",
  user_capes: "user_capes",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

export type SqlValue = string | number | boolean | null | Date;

export interface QueryResult<T> {
  rows: T[];
  count: number;
}

export interface BuiltQuery {
  sql: string;
  values: SqlValue[];
}

interface WithBuild {
  build: () => BuiltQuery;
}

interface WithReturning {
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface InsertFrom {
  values: (...vals: SqlValue[]) => InsertAfterValues;
}

interface InsertAfterValues {
  values: (...vals: SqlValue[]) => InsertAfterValues;
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

export type OrderDirection = "asc" | "desc";

export interface SelectBuilder {
  join: (type: string, table: TableName, alias: string, on: string) => SelectBuilder;
  where: (condition: string, ...args: SqlValue[]) => SelectBuilder;
  and: (condition: string, ...args: SqlValue[]) => SelectBuilder;
  orderBy: (column: string, direction?: OrderDirection) => SelectBuilder;
  limit: (n: number) => SelectBuilder;
  offset: (n: number) => SelectBuilder;
  forUpdate: () => SelectBuilder;
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

const FORBIDDEN_FRAGMENT_SEQUENCES = [";", "--", "/*"] as const;

function assertStaticFragment(fragment: string): void {
  for (const sequence of FORBIDDEN_FRAGMENT_SEQUENCES) {
    if (fragment.includes(sequence)) {
      throw new Error(
        `Фрагмент SQL содержит запрещённую последовательность "${sequence}" — значения передаются через плейсхолдеры`,
      );
    }
  }
}

function createQueryBuilder(): { parts: string[]; values: SqlValue[] } {
  return { parts: [], values: [] };
}

function addWhere(
  state: { parts: string[]; values: SqlValue[] },
  condition: string,
  ...args: SqlValue[]
): void {
  assertStaticFragment(condition);
  state.parts.push(condition);
  state.values.push(...args);
}

function addAnd(
  state: { parts: string[]; values: SqlValue[] },
  condition: string,
  ...args: SqlValue[]
): void {
  assertStaticFragment(condition);
  if (state.parts.length > 0) {
    state.parts.push("AND");
  }
  state.parts.push(condition);
  state.values.push(...args);
}

function buildWhereClause(state: { parts: string[]; values: SqlValue[] }): string {
  return state.parts.length > 0 ? ` WHERE ${state.parts.join(" ")}` : "";
}

function buildWithWhere(
  baseSql: string,
  state: { parts: string[]; values: SqlValue[] },
): BuiltQuery {
  const whereClause = buildWhereClause(state);
  return {
    sql: `${baseSql}${whereClause}`,
    values: state.values,
  };
}

function buildInsert(
  table: TableName,
  columns: string[],
  allValues: SqlValue[][],
  returning?: string[],
): BuiltQuery {
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
  const sqlStr = returning ? `${base} RETURNING ${returning.join(", ")}` : base;
  return { sql: sqlStr, values: allValues.flat() };
}

export function selectQuery(...columns: string[]): {
  from: (table: TableName, alias?: string) => SelectBuilder;
} {
  const cols = columns.length > 0 ? columns.join(", ") : "*";

  return {
    from: (table: TableName, alias?: string) => {
      const state = createQueryBuilder();
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
          limitValue = n;
          return builder;
        },
        offset: (n: number) => {
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
        values: (...vals: SqlValue[]) => {
          allValues.push(vals);
          return withRows();
        },
        returning: (...ret: string[]) => ({
          build: () => buildInsert(table, columns, allValues, ret),
        }),
        build: () => buildInsert(table, columns, allValues),
      });

      return {
        values: (...vals: SqlValue[]) => {
          allValues.push(vals);
          return withRows();
        },
      };
    },
  };
}

export function updateQuery(): {
  from: (table: TableName) => { set: (column: string, value: SqlValue) => UpdateSet };
} {
  return {
    from: (table: TableName) => {
      const setClauses: string[] = [];
      const values: SqlValue[] = [];
      const whereState = createQueryBuilder();

      const buildUpdate = (): BuiltQuery => {
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
            const renumbered = condition.replace(
              /'(?:[^']|'')*'|\$(\d+)/g,
              (match, placeholder?: string) =>
                placeholder === undefined ? match : `$${Number(placeholder) + offset}`,
            );
            addWhere(whereState, renumbered, ...args);

            return {
              returning: (...ret: string[]) => ({
                build: () => {
                  const built = buildUpdate();
                  return {
                    sql: `${built.sql} RETURNING ${ret.join(", ")}`,
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

      return { set: addSet };
    },
  };
}

export function deleteQuery(): {
  from: (table: TableName) => DeleteBuilder;
} {
  return {
    from: (table: TableName) => {
      const state = createQueryBuilder();

      const buildDelete = (): BuiltQuery => buildWithWhere(`DELETE FROM ${table}`, state);

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

export async function execute<T extends Record<string, unknown>>(
  querySql: string,
  values: SqlValue[],
): Promise<QueryResult<T>> {
  try {
    const result = await bunSql.unsafe(querySql, values as unknown[]);
    const rows = (Array.isArray(result) ? result : (result?.rows ?? [])) as T[];
    const count = Array.isArray(result) ? result.length : (result?.count ?? 0);
    return { rows, count };
  } catch (error) {
    sqlLogger.error({ err: error, sql: querySql }, "SQL-запрос не выполнен");
    throw error;
  }
}

export async function executeInTransaction(statements: BuiltQuery[]): Promise<void> {
  await runTransaction(statements);
}

export async function executeInTransactionReturning<T extends Record<string, unknown>>(
  statements: BuiltQuery[],
): Promise<QueryResult<T>[]> {
  const results: QueryResult<T>[] = [];
  try {
    await bunSql.begin(async (tx) => {
      for (const statement of statements) {
        const result = await tx.unsafe(statement.sql, statement.values as unknown[]);
        const rows = (Array.isArray(result) ? result : (result?.rows ?? [])) as T[];
        results.push({ rows, count: rows.length });
      }
    });
  } catch (error) {
    sqlLogger.error({ err: error, statements: statements.length }, "SQL-транзакция не выполнена");
    throw error;
  }
  return results;
}

async function runTransaction(statements: BuiltQuery[]): Promise<void> {
  try {
    await bunSql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement.sql, statement.values as unknown[]);
      }
    });
  } catch (error) {
    sqlLogger.error({ err: error, statements: statements.length }, "SQL-транзакция не выполнена");
    throw error;
  }
}

export async function closeSqlPool(): Promise<void> {
  try {
    await bunSql.close();
  } catch (error) {
    sqlLogger.error({ err: error }, "Не удалось закрыть пул SQL-соединений");
  }
}
