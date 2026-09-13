import { overrideSqlClient, resetSqlClient, type SqlClient } from "../sql";

export interface SqlCall {
  sql: string;
  values: unknown[];
}

export type SqlRowsResolver = (call: SqlCall) => Record<string, unknown>[];

export interface FakeSqlHandle {
  sqlCalls: SqlCall[];
  onSql(resolver: SqlRowsResolver): void;
}

function createFakeClient(): {
  client: SqlClient;
  sqlCalls: SqlCall[];
  resolverRef: { current: SqlRowsResolver };
} {
  const sqlCalls: SqlCall[] = [];
  const resolverRef: { current: SqlRowsResolver } = { current: () => [] };

  const runUnsafe = async (sql: string, values: unknown[]) => {
    const call = { sql, values };
    sqlCalls.push(call);
    const rows = resolverRef.current(call);
    return { rows, count: rows.length };
  };

  const client = (async () => ({ rows: [], count: 0 })) as unknown as SqlClient;
  client.unsafe = runUnsafe;
  client.begin = async (callback) =>
    await callback({ unsafe: runUnsafe } as unknown as Parameters<typeof callback>[0]);
  client.close = async () => {};

  return { client, sqlCalls, resolverRef };
}

export function installFakeSqlClient(): FakeSqlHandle {
  const { client, sqlCalls, resolverRef } = createFakeClient();
  overrideSqlClient(client);

  return {
    sqlCalls,
    onSql(resolver: SqlRowsResolver) {
      resolverRef.current = resolver;
    },
  };
}

export { resetSqlClient };
