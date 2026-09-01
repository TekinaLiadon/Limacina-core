import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

const LOGS_DIR = join(process.cwd(), "logs");
const RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 3600_000;
const FILE_CHECK_INTERVAL_MS = 60_000;

function currentLogPath(date: string): string {
  return join(LOGS_DIR, `${date}.log`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function logToStderr(message: string): void {
  process.stderr.write(`[log-stream] ${message}\n`);
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
  } catch (error) {
    logToStderr(`ошибка очистки старых логов: ${String(error)}`);
  }
}

function ensureLogsDir(): void {
  try {
    readdirSync(LOGS_DIR);
  } catch {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function openLogStream(date: string): WriteStream {
  const stream = createWriteStream(currentLogPath(date), { flags: "a" });
  stream.on("error", (error: Error) => {
    logToStderr(`ошибка записи лог-файла ${date}.log: ${String(error)}`);
  });
  return stream;
}

function closeLogStream(stream: WriteStream): void {
  if (stream.destroyed || stream.closed) return;
  stream.end();
}

export function createLogStream(): Writable {
  ensureLogsDir();
  cleanupOldLogs();

  let currentDate = today();
  let stream = openLogStream(currentDate);
  let streamFailed = false;
  let lastCleanup = Date.now();
  let lastFileCheck = Date.now();

  const wrapper = new Writable({
    write(chunk, encoding, callback) {
      const now = Date.now();
      if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
        cleanupOldLogs();
        lastCleanup = now;
      }

      if (now - lastFileCheck > FILE_CHECK_INTERVAL_MS) {
        lastFileCheck = now;
        if (!existsSync(currentLogPath(currentDate))) {
          streamFailed = true;
        }
      }

      const date = today();
      if (date !== currentDate || streamFailed) {
        closeLogStream(stream);
        currentDate = date;
        stream = openLogStream(currentDate);
        streamFailed = false;
      }

      stream.write(chunk, encoding, (error) => {
        if (error) {
          streamFailed = true;
          logToStderr(`потеряна запись логов: ${String(error)}`);
        }
        callback();
      });
    },
  });

  wrapper.on("error", (error: Error) => {
    logToStderr(`ошибка потока логов: ${String(error)}`);
  });

  return wrapper;
}
