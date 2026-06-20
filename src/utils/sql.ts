type BunSqlFn = {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{
    rows: Record<string, unknown>[];
    count: number;
  }>;
  unsafe(
    sql: string,
    values: unknown[],
  ): Promise<{
    rows: Record<string, unknown>[];
    count: number;
  }>;
};

const bunSql: BunSqlFn = ((await import("bun")) as unknown as { sql: BunSqlFn }).sql;

export const TABLES = {
  users: "users",
  refresh_tokens: "refresh_tokens",
  user_textures: "user_textures",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

export type SqlValue = string | number | boolean | null | Date;

export interface QueryResult<T> {
  rows: T[];
  count: number;
}

interface BuiltQuery {
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
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface WhereAndNext {
  and: (condition: string, ...args: SqlValue[]) => WithLimit;
  limit: (n: number) => WithBuild;
  build: () => BuiltQuery;
}

interface SelectFrom {
  join: (type: string, table: TableName, alias: string, on: string) => SelectFrom;
  where: (condition: string, ...args: SqlValue[]) => WhereAndNext;
  limit: (n: number) => WithBuild;
  build: () => BuiltQuery;
}

interface WithLimit {
  limit: (n: number) => WithBuild;
  build: () => BuiltQuery;
}

interface UpdateSet {
  set: (column: string, value: SqlValue) => UpdateSet;
  where: (condition: string, ...args: SqlValue[]) => WithReturning;
  build: () => BuiltQuery;
}

interface DeleteBuilder {
  where: (condition: string, ...args: SqlValue[]) => WithLimit;
  limit: (n: number) => WithBuild;
  build: () => BuiltQuery;
}

function createQueryBuilder(): { parts: string[]; values: SqlValue[] } {
  return { parts: [], values: [] };
}

function addWhere(
  state: { parts: string[]; values: SqlValue[] },
  condition: string,
  ...args: SqlValue[]
): void {
  state.parts.push(condition);
  state.values.push(...args);
}

function addAnd(
  state: { parts: string[]; values: SqlValue[] },
  condition: string,
  ...args: SqlValue[]
): void {
  if (state.parts.length > 0) {
    state.parts.push("AND");
  }
  state.parts.push(condition);
  state.values.push(...args);
}

function buildWhereClause(state: { parts: string[]; values: SqlValue[] }): string {
  return state.parts.length > 0 ? ` WHERE ${state.parts.join(" ")}` : "";
}

function createLimitMethod(
  setLimit: (n: number) => void,
  buildFn: () => BuiltQuery,
): (n: number) => WithBuild {
  return (n) => {
    setLimit(n);
    return { build: buildFn };
  };
}

function buildWithWhere(
  baseSql: string,
  state: { parts: string[]; values: SqlValue[] },
  limit?: number,
): BuiltQuery {
  const whereClause = buildWhereClause(state);
  const limitClause = limit !== undefined ? ` LIMIT ${limit}` : "";
  return {
    sql: `${baseSql}${whereClause}${limitClause}`,
    values: state.values,
  };
}

function buildInsert(
  table: TableName,
  columns: string[],
  allValues: SqlValue[][],
  returning?: string[],
): BuiltQuery {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const rows = allValues.map(() => `(${placeholders})`).join(", ");
  const base = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${rows}`;
  const sqlStr = returning ? `${base} RETURNING ${returning.join(", ")}` : base;
  return { sql: sqlStr, values: allValues.flat() };
}

export function selectQuery(...columns: string[]): {
  from: (table: TableName, alias?: string) => SelectFrom;
} {
  const cols = columns.length > 0 ? columns.join(", ") : "*";

  return {
    from: (table: TableName, alias?: string) => {
      const state = createQueryBuilder();
      const tableRef = alias ? `${table} ${alias}` : table;
      let fromClause = `SELECT ${cols} FROM ${tableRef}`;
      let limitValue: number | undefined;

      const buildSelect = (): BuiltQuery => {
        const whereClause = buildWhereClause(state);
        const limitClause = limitValue !== undefined ? ` LIMIT ${limitValue}` : "";
        return {
          sql: `${fromClause}${whereClause}${limitClause}`,
          values: state.values,
        };
      };

      const buildWhereChain = () => ({
        and: (condition: string, ...args: SqlValue[]) => {
          addAnd(state, condition, ...args);
          return {
            limit: limitMethod,
            build: buildSelect,
          };
        },
        limit: limitMethod,
        build: buildSelect,
      });

      const limitMethod = createLimitMethod((n) => {
        limitValue = n;
      }, buildSelect);

      const selectFromMethods: SelectFrom = {
        join: (type: string, joinTable: TableName, joinAlias: string, on: string) => {
          fromClause += ` ${type} ${joinTable} ${joinAlias} ON ${on}`;
          return selectFromMethods;
        },
        where: (condition: string, ...args: SqlValue[]) => {
          addWhere(state, condition, ...args);
          return buildWhereChain();
        },
        limit: limitMethod,
        build: buildSelect,
      };

      return selectFromMethods;
    },
  };
}

export function insertQuery(...columns: string[]): {
  from: (table: TableName) => InsertFrom;
} {
  return {
    from: (table: TableName) => {
      const allValues: SqlValue[][] = [];

      return {
        values: (...vals: SqlValue[]) => {
          allValues.push(vals);

          return {
            returning: (...ret: string[]) => ({
              build: () => buildInsert(table, columns, allValues, ret),
            }),
            build: () => buildInsert(table, columns, allValues),
          };
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
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(value);

        return {
          set: addSet,
          where: (condition: string, ...args: SqlValue[]) => {
            const offset = values.length;
            const renumbered = condition.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
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
      let limitValue: number | undefined;

      const buildDelete = (): BuiltQuery =>
        buildWithWhere(`DELETE FROM ${table}`, state, limitValue);
      const limitMethod = createLimitMethod((n) => {
        limitValue = n;
      }, buildDelete);

      return {
        where: (condition: string, ...args: SqlValue[]) => {
          addWhere(state, condition, ...args);

          return {
            limit: limitMethod,
            build: buildDelete,
          };
        },
        limit: limitMethod,
        build: buildDelete,
      };
    },
  };
}

export async function execute<T extends Record<string, unknown>>(
  querySql: string,
  values: SqlValue[],
): Promise<QueryResult<T>> {
  const result = await bunSql.unsafe(querySql, values as unknown[]);
  return {
    rows: result.rows as T[],
    count: result.count,
  };
}

export async function executeTemplate<T extends Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<T>> {
  const result = await bunSql(strings, ...values);
  return {
    rows: result.rows as T[],
    count: result.count,
  };
}
