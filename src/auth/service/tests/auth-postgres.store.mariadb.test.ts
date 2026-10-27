import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, describe, expect, it } from "bun:test";
import { AuthPostgresStore } from "../auth_postgres_store";
import { installFakeSqlClient, resetSqlClient } from "../../../utils/tests/sql-fake";

const fake = installFakeSqlClient("mariadb");
afterAll(resetSqlClient);

const store = new AuthPostgresStore();

describe("AuthPostgresStore — идентификаторы установки на mariadb", () => {
  it("recordInstallId использует ON DUPLICATE KEY UPDATE и CONCAT", async () => {
    fake.onSql(() => []);

    await store.recordInstallId("uuid-1", "v1-0123456789abcdef0123456789abcdef");

    const [call] = fake.sqlCalls.slice(-1);
    expect(call?.sql).toContain("INSERT INTO user_install_ids");
    expect(call?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(call?.sql).toContain("CONCAT('%\"', install_id, '\"%')");
    expect(call?.sql).toContain("= '[]' THEN CONCAT('[\"', install_id, '\"]')");
    expect(call?.values).toEqual(["uuid-1", "v1-0123456789abcdef0123456789abcdef"]);
  });
});
