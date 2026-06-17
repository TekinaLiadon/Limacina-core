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

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const bunSql: BunSqlFn = ((await import("bun")) as unknown as { sql: BunSqlFn }).sql;

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

interface InsertAfterValues {
  returning: (...ret: string[]) => WithBuild;
  build: () => BuiltQuery;
}

interface WhereAndNext {
  and: (condition: string, ...args: SqlValue[]) => WithBuild;
  build: () => BuiltQuery;
}

interface SelectFrom {
  where: (condition: string, ...args: SqlValue[]) => WhereAndNext;
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

export function selectQuery(...columns: string[]): {
  from: (table: string) => SelectFrom;
} {
  const cols = columns.length > 0 ? columns.join(", ") : "*";

  return {
    from: (table: string) => {
      const state = createQueryBuilder();
      state.parts.push(`SELECT ${cols} FROM ${table}`);

      return {
        where: (condition: string, ...args: SqlValue[]) => {
          addWhere(state, condition, ...args);

          return {
            and: (condition: string, ...args: SqlValue[]) => {
              addAnd(state, condition, ...args);

              return {
                build: () => {
                  const whereClause = buildWhereClause(state);
                  const baseSql = state.parts[0]!;
                  return {
                    sql: `${baseSql}${whereClause}`,
                    values: state.values,
                  };
                },
              };
            },
            build: () => {
              const whereClause = buildWhereClause(state);
              const baseSql = state.parts[0]!;
              return {
                sql: `${baseSql}${whereClause}`,
                values: state.values,
              };
            },
          };
        },
        build: () => ({
          sql: state.parts[0]!,
          values: [],
        }),
      };
    },
  };
}

export function insertQuery(
  table: string,
  ...columns: string[]
): {
  values: (...vals: SqlValue[]) => InsertAfterValues;
} {
  const allValues: SqlValue[][] = [];

  return {
    values: (...vals: SqlValue[]) => {
      allValues.push(vals);

      return {
        returning: (...ret: string[]) => {
          return {
            build: () => {
              const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
              const rows = allValues.map(() => `(${placeholders})`).join(", ");
              const sqlStr = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${rows} RETURNING ${ret.join(", ")}`;
              return { sql: sqlStr, values: allValues.flat() };
            },
          };
        },
        build: () => {
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
          const rows = allValues.map(() => `(${placeholders})`).join(", ");
          const sqlStr = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${rows}`;
          return { sql: sqlStr, values: allValues.flat() };
        },
      };
    },
  };
}

export function updateQuery(table: string): {
  set: (column: string, value: SqlValue) => UpdateSet;
} {
  const setClauses: string[] = [];
  const values: SqlValue[] = [];
  const whereState = createQueryBuilder();

  const buildUpdate = (): BuiltQuery => {
    const whereClause = buildWhereClause(whereState);
    const sqlStr = `UPDATE ${table} SET ${setClauses.join(", ")}${whereClause}`;
    return { sql: sqlStr, values };
  };

  const addSet = (column: string, value: SqlValue): UpdateSet => {
    setClauses.push(`${column} = $${values.length + 1}`);
    values.push(value);

    return {
      set: addSet,
      where: (condition: string, ...args: SqlValue[]) => {
        addWhere(whereState, condition, ...args);

        return {
          returning: (...ret: string[]) => ({
            build: () => ({
              sql: `${buildUpdate().sql} RETURNING ${ret.join(", ")}`,
              values,
            }),
          }),
          build: buildUpdate,
        };
      },
      build: buildUpdate,
    };
  };

  return { set: addSet };
}

export function deleteQuery(table: string): DeleteBuilder {
  const state = createQueryBuilder();

  return {
    where: (condition: string, ...args: SqlValue[]) => {
      addWhere(state, condition, ...args);

      return {
        build: () => {
          const whereClause = buildWhereClause(state);
          return {
            sql: `DELETE FROM ${table}${whereClause}`,
            values: state.values,
          };
        },
      };
    },
    build: () => ({
      sql: `DELETE FROM ${table}`,
      values: [],
    }),
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
