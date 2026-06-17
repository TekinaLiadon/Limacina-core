import { getDatabaseUrl } from "../core/env.js";
import { createDriver } from "../core/driver.js";
import { log, fatal } from "../core/console.js";

try {
  const url = getDatabaseUrl();
  const driver = await createDriver(url);
  await driver.install();
  log({ text: "Migration table created!", type: "success" });
  await driver.close();
} catch (error) {
  fatal("Failed to create migration table", error);
}
