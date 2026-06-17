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

export function resolveListDir(): string {
  return path.join(import.meta.dir, "..", "list");
}
