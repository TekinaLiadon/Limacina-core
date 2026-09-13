import path from "node:path";
import { getDatabaseUrl } from "../core/env.js";
import { createDriver } from "../core/driver.js";
import { checksumFile, listFiles, resolveListDir } from "../core/fs.js";
import { log, fatal } from "../core/console.js";

try {
  const url = getDatabaseUrl();
  const driver = await createDriver(url);
  const listDir = resolveListDir();

  await driver.install();

  const allFiles = await listFiles(listDir, "js");
  const checksums = new Map<string, string>();
  for (const file of allFiles) {
    checksums.set(file, await checksumFile(path.join(listDir, file)));
  }

  const executed = await driver.listExecuted();
  const executedByName = new Map(executed.map((entry) => [entry.name, entry]));

  for (const file of allFiles) {
    const record = executedByName.get(file);
    if (!record) continue;

    const checksum = checksums.get(file);
    if (!checksum) continue;

    if (record.checksum === null) {
      await driver.setChecksum(file, checksum);
      log({ text: `${file} checksum saved (legacy record)`, type: "info" });
      continue;
    }

    if (record.checksum !== checksum) {
      log({
        text: `${file} was modified after it was applied — restore the file or resolve the drift manually`,
        type: "error",
      });
      await driver.close();
      process.exit(1);
    }
  }

  const pending = allFiles.filter((file) => !executedByName.has(file));

  if (pending.length === 0) {
    log({ text: "No pending migrations.", type: "warn" });
    await driver.close();
    process.exit(0);
  }

  for (const file of pending) {
    const checksum = checksums.get(file);
    if (!checksum) continue;
    try {
      const mod = await import(path.join(listDir, file));
      if (typeof mod.up !== "function") {
        log({ text: `${file} has no up() export, skipping`, type: "warn" });
        continue;
      }
      await mod.up();
      await driver.record(file, checksum);
      log({ text: `${file} migrated up`, type: "success" });
    } catch (error) {
      log({ text: `${file} migration failed`, type: "error", error });
      await driver.close();
      process.exit(1);
    }
  }

  await driver.close();
} catch (error) {
  fatal("Migration up failed", error);
}
