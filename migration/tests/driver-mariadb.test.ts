import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDriver } from "../core/driver.js";

const ENV_FILE = join(import.meta.dir, "..", "..", ".env");

function loadMariaDbUrl(): string | undefined {
  if (process.env["MARIADB_URL"]) return process.env["MARIADB_URL"];
  if (!existsSync(ENV_FILE)) return undefined;
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const [name, value] = line.split("=", 2);
    if (name === "MARIADB_URL") return value?.trim();
  }
  return undefined;
}

const MARIADB_URL = loadMariaDbUrl();
const itWithMariaDb = it.skipIf(MARIADB_URL === undefined);

describe("MigrationDriver — MariaDB (интеграция)", () => {
  itWithMariaDb(
    "install/listExecuted/record/setChecksum/remove/close проходят на реальной базе",
    async () => {
      const driver = await createDriver(MARIADB_URL as string);
      try {
        await driver.install();
        await driver.install();

        expect(await driver.listExecuted()).toEqual([]);

        await driver.record("0001-test", "checksum-1");
        await driver.record("0001-test", "checksum-duplicate");

        let executed = await driver.listExecuted();
        expect(executed).toEqual([{ name: "0001-test", checksum: "checksum-1" }]);

        await driver.setChecksum("0001-test", "checksum-2");
        executed = await driver.listExecuted();
        expect(executed[0]?.checksum).toBe("checksum-2");

        await driver.remove("0001-test");
        expect(await driver.listExecuted()).toEqual([]);
      } finally {
        await driver.close();
      }
    },
  );
});
