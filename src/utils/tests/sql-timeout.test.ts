import { afterAll, describe, expect, it } from "bun:test";
import { installFakeSqlClient } from "./sql-fake";
import {
  createSqlPoolClient,
  execute,
  executeInTransaction,
  overrideSqlClient,
  overrideSqlQueryTimeoutMs,
  resetSqlClient,
  resetSqlQueryTimeoutMs,
  SQL_POOL_OPTIONS,
  type SqlClient,
  type SqlQuery,
} from "../sql";

const HUNG_TIMEOUT_MS = 50;

function createHungQuery(cancelled: { count: number }): SqlQuery {
  const query = new Promise<never>(() => {}) as unknown as SqlQuery;
  query.cancel = (): SqlQuery => {
    cancelled.count += 1;
    return query;
  };
  return query;
}

function createHungSqlClient(): { client: SqlClient; cancelCount: () => number } {
  const cancelled = { count: 0 };
  const client = (async () => ({ rows: [], count: 0 })) as unknown as SqlClient;
  client.unsafe = () => createHungQuery(cancelled);
  client.begin = async (callback) =>
    await callback({
      unsafe: () => createHungQuery(cancelled),
    } as unknown as Parameters<typeof callback>[0]);
  client.close = async () => {};
  return { client, cancelCount: () => cancelled.count };
}

describe("таймаут SQL-запросов", () => {
  afterAll(() => {
    resetSqlClient();
    resetSqlQueryTimeoutMs();
  });

  it("зависший запрос в execute прерывается по таймауту, cancel вызывается", async () => {
    const { client, cancelCount } = createHungSqlClient();
    overrideSqlClient(client);
    overrideSqlQueryTimeoutMs(HUNG_TIMEOUT_MS);

    try {
      await expect(execute("select 1", [])).rejects.toThrow("таймаут");
      expect(cancelCount()).toBe(1);
    } finally {
      resetSqlClient();
      resetSqlQueryTimeoutMs();
    }
  });

  it("зависший стейтмент в транзакции прерывается по таймауту", async () => {
    const { client, cancelCount } = createHungSqlClient();
    overrideSqlClient(client);
    overrideSqlQueryTimeoutMs(HUNG_TIMEOUT_MS);

    try {
      await expect(executeInTransaction([{ sql: "select 1", values: [] }])).rejects.toThrow(
        "таймаут",
      );
      expect(cancelCount()).toBe(1);
    } finally {
      resetSqlClient();
      resetSqlQueryTimeoutMs();
    }
  });

  it("запрос, уложившийся в таймаут, выполняется как обычно", async () => {
    installFakeSqlClient();
    overrideSqlQueryTimeoutMs(HUNG_TIMEOUT_MS);

    try {
      const result = await execute("select 1", []);

      expect(result.rows).toEqual([]);
      expect(result.count).toBe(0);
    } finally {
      resetSqlClient();
      resetSqlQueryTimeoutMs();
    }
  });
});

describe("опции пула SQL", () => {
  it("SQL_POOL_OPTIONS задаёт max/idleTimeout/connectionTimeout явно", () => {
    expect(SQL_POOL_OPTIONS.max).toBeGreaterThan(0);
    expect(SQL_POOL_OPTIONS.idleTimeout).toBeGreaterThan(0);
    expect(SQL_POOL_OPTIONS.connectionTimeout).toBeGreaterThan(0);
  });

  it("createSqlPoolClient передаёт опции пула в конструктор клиента", () => {
    const constructed: Array<{ url: string; options: Record<string, unknown> }> = [];
    const sqlConstructor = function (url: string, options: Record<string, unknown>) {
      constructed.push({ url, options });
      return {};
    } as unknown as new (connectionString: string, options: typeof SQL_POOL_OPTIONS) => SqlClient;

    const client = createSqlPoolClient("postgres://localhost:5432/limacina", sqlConstructor);

    expect(constructed[0]?.url).toBe("postgres://localhost:5432/limacina");
    expect(constructed[0]?.options).toEqual({ ...SQL_POOL_OPTIONS });
    expect(client).toBeDefined();
  });
});
