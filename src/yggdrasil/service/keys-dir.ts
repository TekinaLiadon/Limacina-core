import { join, resolve } from "node:path";

export function resolveKeysDir(envKeysDir?: string): string {
  if (envKeysDir) return resolve(envKeysDir);

  if (import.meta.dir.startsWith("/$bunfs")) return join(process.cwd(), "keys");

  return join(import.meta.dir, "..", "..", "..", "keys");
}
