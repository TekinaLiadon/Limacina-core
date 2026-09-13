import { readdir } from "node:fs/promises";
import path from "node:path";

export async function listFiles(dir: string, ext: string): Promise<string[]> {
  const matchedFiles: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(`.${ext}`)) {
      matchedFiles.push(entry.name);
    }
  }
  return matchedFiles.sort().reverse();
}

export async function checksumFile(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(filePath).arrayBuffer());
  return hasher.digest("hex");
}

export function resolveListDir(): string {
  return process.env["MIGRATION_LIST_DIR"] ?? path.join(import.meta.dir, "..", "list");
}
