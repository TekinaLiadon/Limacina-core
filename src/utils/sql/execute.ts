import { Logger } from "@nestjs/common";
import { currentDialect, currentSqlClient } from "./client";
import type { BuiltQuery, QueryResult, SqlValue } from "./types";

const sqlLogger = new Logger("Sql");

export async function execute<T extends Record<string, unknown>>(
  querySql: string,
  values: SqlValue[],
): Promise<QueryResult<T>> {
  try {
    const adapted = currentDialect().toClientQuery(querySql, values);
    const result = await currentSqlClient().unsafe(adapted.sql, adapted.values);
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
        await tx.unsafe(adapted.sql, adapted.values);
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
        const result = await tx.unsafe(adapted.sql, adapted.values);
        results.push(currentDialect().toQueryResult(result) as QueryResult<T>);
      }
    });
  } catch (error) {
    sqlLogger.error({ err: error, statements: statements.length }, "SQL-транзакция не выполнена");
    throw error;
  }
  return results;
}

export async function closeSqlPool(): Promise<void> {
  try {
    await currentSqlClient().close();
  } catch (error) {
    sqlLogger.error({ err: error }, "Не удалось закрыть пул SQL-соединений");
  }
}
