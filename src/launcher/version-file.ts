import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCHER_VERSION_REGEX, PUBLIC_DIR } from "./launcher-files";

export const VERSION_FILE = join(PUBLIC_DIR, "version.json");

export function readLauncherVersion(): string | null {
  try {
    const data: unknown = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
    if (typeof data !== "object" || data === null) return null;
    const { version } = data as { version?: unknown };
    if (typeof version !== "string" || !LAUNCHER_VERSION_REGEX.test(version)) return null;
    return version;
  } catch {
    return null;
  }
}
