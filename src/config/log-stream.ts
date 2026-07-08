import { createWriteStream, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

const LOGS_DIR = join(import.meta.dir, "../../logs");
const RETENTION_DAYS = 7;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanupOldLogs(): void {
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    for (const file of readdirSync(LOGS_DIR)) {
      if (!file.endsWith(".log")) continue;
      const dateStr = file.replace(".log", "");
      const fileDate = new Date(dateStr);
      if (Number.isNaN(fileDate.getTime())) continue;
      if (fileDate < cutoff) unlinkSync(join(LOGS_DIR, file));
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
  let lastCleanup = Date.now();

  return new Writable({
    write(chunk, encoding, callback) {
      const now = Date.now();
      if (now - lastCleanup > 3600_000) {
        cleanupOldLogs();
        lastCleanup = now;
      }

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
