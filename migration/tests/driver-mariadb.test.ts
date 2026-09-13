import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDriver } from "../core/driver.js";

const ENV_FILE = join(import.meta.dir, "..", "..", ".env");

function loadDatabaseUrl(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  if (!existsSync(ENV_FILE)) return undefined;
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const [name, value] = line.split("=", 2);
    if (name === "DATABASE_URL") return value?.trim();
  }
  return undefined;
}

function isMariaDbUrl(url: string | undefined): url is string {
  return url !== undefined && /^mariadb:|^mysql:/.test(new URL(url).protocol);
}

const DATABASE_URL = loadDatabaseUrl();
const itWithMariaDb = it.skipIf(!isMariaDbUrl(DATABASE_URL));

describe("MigrationDriver — MariaDB (интеграция)", () => {
  itWithMariaDb(
    "install/listExecuted/record/setChecksum/remove/close проходят на реальной базе",
    async () => {
      const driver = await createDriver(DATABASE_URL as string);
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
