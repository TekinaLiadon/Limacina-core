import { createWriteStream, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

const LOGS_DIR = join(import.meta.dir, "../../logs");
const RETENTION_DAYS = 14;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanupOldLogs(): void {
  try {
    const now = Date.now();
    const maxAge = RETENTION_DAYS * 86400_000;
    for (const file of readdirSync(LOGS_DIR)) {
      if (!file.endsWith(".log")) continue;
      const fullPath = join(LOGS_DIR, file);
      const age = now - statSync(fullPath).mtimeMs;
      if (age > maxAge) unlinkSync(fullPath);
    }
  } catch {}
}

function ensureLogsDir(): void {
  try {
    readdirSync(LOGS_DIR);
  } catch {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

export function createLogStream(): Writable {
  ensureLogsDir();
  cleanupOldLogs();

  let currentDate = today();
  let stream = createWriteStream(join(LOGS_DIR, `${currentDate}.log`), { flags: "a" });

  return new Writable({
    write(chunk, encoding, callback) {
      const d = today();
      if (d !== currentDate) {
        stream.end();
        currentDate = d;
        stream = createWriteStream(join(LOGS_DIR, `${currentDate}.log`), { flags: "a" });
      }
      stream.write(chunk, encoding, callback);
    },
  });
}
