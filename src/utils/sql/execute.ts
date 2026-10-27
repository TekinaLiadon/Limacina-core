import { Logger } from "@nestjs/common";
import { currentDialect, currentSqlClient, sqlQueryTimeoutMs } from "./client";
import type { BuiltQuery, QueryResult, SqlQuery, SqlResult, SqlValue } from "./types";

const sqlLogger = new Logger("Sql");

type UnsafeExecutor = { unsafe: (sql: string, values: unknown[]) => SqlQuery };

function cancelQuery(query: SqlQuery): void {
  void Promise.resolve(query.cancel?.()).catch(() => undefined);
}

async function runTimedQuery(
  executor: UnsafeExecutor,
  querySql: string,
  values: unknown[],
): Promise<SqlResult> {
  const query = executor.unsafe(querySql, values);
  const timeoutMs = sqlQueryTimeoutMs();
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancelQuery(query);
          reject(new Error(`SQL-запрос прерван по таймауту ${String(timeoutMs)} мс`));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function execute<T extends Record<string, unknown>>(
  querySql: string,
  values: SqlValue[],
): Promise<QueryResult<T>> {
  try {
    const adapted = currentDialect().toClientQuery(querySql, values);
    const result = await runTimedQuery(currentSqlClient(), adapted.sql, adapted.values);
    return currentDialect().toQueryResult(result) as QueryResult<T>;
  } catch (error) {
    sqlLogger.error({ err: error, sql: querySql }, "SQL-запрос не выполнен");
    throw error;
  }
}

export async function executeInTransaction(statements: BuiltQuery[]): Promise<void> {
  try {
    await currentSqlClient().begin(async (tx) => {
      for (const statement of statements) {
        const adapted = currentDialect().toClientQuery(statement.sql, statement.values);
        await runTimedQuery(tx, adapted.sql, adapted.values);
      }
    });
  } catch (error) {
    sqlLogger.error({ err: error, statements: statements.length }, "SQL-транзакция не выполнена");
    throw error;
  }
}

export async function executeInTransactionReturning<T extends Record<string, unknown>>(
  statements: BuiltQuery[],
): Promise<QueryResult<T>[]> {
  const results: QueryResult<T>[] = [];
  try {
    await currentSqlClient().begin(async (tx) => {
      for (const statement of statements) {
        const adapted = currentDialect().toClientQuery(statement.sql, statement.values);
        const result = await runTimedQuery(tx, adapted.sql, adapted.values);
        results.push(currentDialect().toQueryResult(result) as QueryResult<T>);
      }
    });
  } catch (error) {
    sqlLogger.error({ err: error, statements: statements.length }, "SQL-транзакция не выполнена");
    throw error;
  }
  return results;
}
