import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, describe, expect, it } from "bun:test";
import { resetSqlClient, sqlDialect } from "../sql";

describe("currentDialect — ленивый кеш диалекта", () => {
  const originalDatabaseUrl = process.env["DATABASE_URL"];
  const originalSecrets = process.env["SECRETS"];

  const restoreEnv = (): void => {
    if (originalDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = originalDatabaseUrl;
    if (originalSecrets === undefined) delete process.env["SECRETS"];
    else process.env["SECRETS"] = originalSecrets;
    resetSqlClient();
  };

  afterAll(restoreEnv);

  it("вычисляет диалект один раз и сбрасывает кеш в resetSqlClient", () => {
    process.env["DATABASE_URL"] = "mariadb://user:pass@localhost:3306/db";
    delete process.env["SECRETS"];
    resetSqlClient();

    expect(sqlDialect()).toBe("mariadb");

    process.env["DATABASE_URL"] = "postgres://user:pass@localhost:5432/db";
    expect(sqlDialect()).toBe("mariadb");

    resetSqlClient();
    expect(sqlDialect()).toBe("postgres");

    restoreEnv();
  });

  it("mergeSecretsIntoEnv не вызывается на каждый SQL-вызов — один раз на кеш", () => {
    delete process.env["DATABASE_URL"];
    process.env["SECRETS"] = JSON.stringify({
      DATABASE_URL: "mariadb://user:pass@localhost:3306/db",
    });
    resetSqlClient();

    const originalParse = JSON.parse;
    let parseCount = 0;
    JSON.parse = ((
      text: string,
      reviver?: (this: unknown, key: string, value: unknown) => unknown,
    ) => {
      parseCount++;
      return originalParse(text, reviver);
    }) as typeof JSON.parse;

    try {
      expect(sqlDialect()).toBe("mariadb");
      expect(sqlDialect()).toBe("mariadb");
      expect(sqlDialect()).toBe("mariadb");
      expect(parseCount).toBe(1);
    } finally {
      JSON.parse = originalParse;
      restoreEnv();
    }
  });
});
