import path from "node:path";
import { getDatabaseUrl } from "../core/env.js";
import { createDriver } from "../core/driver.js";
import { listFiles, resolveListDir } from "../core/fs.js";
import { log, fatal } from "../core/console.js";

try {
  const url = getDatabaseUrl();
  const driver = await createDriver(url);
  const listDir = resolveListDir();

  const allFiles = await listFiles(listDir, "js");
  const executed = await driver.listExecuted();
  const executedSet = new Set(executed);

  const pending = allFiles.filter((file) => !executedSet.has(file));

  if (pending.length === 0) {
    log({ text: "No pending migrations.", type: "warn" });
    await driver.close();
    process.exit(0);
  }

  for (const file of pending) {
    try {
      const mod = await import(path.join(listDir, file));
      if (typeof mod.up !== "function") {
        log({ text: `${file} has no up() export, skipping`, type: "warn" });
        continue;
      }
      await mod.up();
      await driver.record(file);
      log({ text: `${file} migrated up`, type: "success" });
    } catch (error) {
      log({ text: `${file} migration failed`, type: "error", error });
    }
  }

  await driver.close();
} catch (error) {
  fatal("Migration up failed", error);
}
