import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createDriver } from "../core/driver.js";

const SQLITE_URL = "sqlite://:memory:";

let driver: Awaited<ReturnType<typeof createDriver>>;

beforeAll(async () => {
  driver = await createDriver(SQLITE_URL);
  await driver.install();
});

afterAll(async () => {
  await driver.close();
});

describe("createDriver() — SQLite", () => {
  it("создаёт драйвер из sqlite:// URL", () => {
    expect(driver).toBeDefined();
  });
});

describe("MigrationDriver.install()", () => {
  it("создаёт таблицу migrations (идемпотентно)", async () => {
    await driver.install();
    const executed = await driver.listExecuted();
    expect(executed).toEqual([]);
  });
});

describe("MigrationDriver.record() + listExecuted()", () => {
  it("записывает миграцию с checksum и находит её в списке", async () => {
    await driver.record("2025_01_01_120000_test.js", "a".repeat(64));
    const executed = await driver.listExecuted();
    expect(executed.map((entry) => entry.name)).toContain("2025_01_01_120000_test.js");

    const recorded = executed.find((entry) => entry.name === "2025_01_01_120000_test.js");
    expect(recorded?.checksum).toBe("a".repeat(64));
  });

  it("повторный record той же миграции не создаёт дубликат (UNIQUE)", async () => {
    await driver.record("2025_01_01_120000_test.js", "a".repeat(64));
    const executed = await driver.listExecuted();
    expect(executed.filter((entry) => entry.name === "2025_01_01_120000_test.js")).toHaveLength(1);
  });

  it("возвращает миграции в порядке id ASC", async () => {
    await driver.record("2025_01_01_120001_second.js", "b".repeat(64));
    const executed = await driver.listExecuted();
    expect(executed[0]?.name).toBe("2025_01_01_120000_test.js");
    expect(executed[1]?.name).toBe("2025_01_01_120001_second.js");
  });
});

describe("MigrationDriver.setChecksum()", () => {
  it("дозаполняет checksum у легаси-записи", async () => {
    await driver.setChecksum("2025_01_01_120001_second.js", "c".repeat(64));
    const executed = await driver.listExecuted();
    const updated = executed.find((entry) => entry.name === "2025_01_01_120001_second.js");
    expect(updated?.checksum).toBe("c".repeat(64));
  });
});

describe("MigrationDriver.remove()", () => {
  it("удаляет конкретную миграцию из tracking table", async () => {
    await driver.remove("2025_01_01_120001_second.js");
    const executed = await driver.listExecuted();
    expect(executed.map((entry) => entry.name)).not.toContain("2025_01_01_120001_second.js");
    expect(executed.map((entry) => entry.name)).toContain("2025_01_01_120000_test.js");
  });
});

describe("MigrationDriver.close()", () => {
  it("закрывает соединение без ошибок", async () => {
    await driver.close();
    expect(true).toBe(true);
  });
});
