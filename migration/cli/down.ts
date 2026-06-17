import path from "node:path";
import { getDatabaseUrl } from "../core/env.js";
import { createDriver } from "../core/driver.js";
import { resolveListDir } from "../core/fs.js";
import { log, fatal } from "../core/console.js";

try {
  const url = getDatabaseUrl();
  const driver = await createDriver(url);
  const listDir = resolveListDir();

  const executed = await driver.listExecuted();
  if (executed.length === 0) {
    log({ text: "No migrations to rollback.", type: "warn" });
    await driver.close();
    process.exit(0);
  }

  const file = executed[executed.length - 1]!;
  const mod = await import(path.join(listDir, file));

  if (typeof mod.down !== "function") {
    log({ text: `${file} has no down() export`, type: "warn" });
    const prompt = "Continue and remove tracking record? [y/N] ";
    process.stdout.write(prompt);
    const line = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });
    if (line === "y") {
      await driver.remove(file);
      log({ text: `${file} tracking record removed`, type: "success" });
    }
    await driver.close();
    process.exit(0);
  }

  await mod.down();
  await driver.remove(file);
  log({ text: `${file} rolled back`, type: "success" });
  await driver.close();
} catch (error) {
  fatal("Migration down failed", error);
}
