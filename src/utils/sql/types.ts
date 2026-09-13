export interface SqlResult {
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

export type SqlClient = BunSqlFn;

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
