import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
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

async function cleanupOldLogs(): Promise<void> {
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const files = await readdir(LOGS_DIR);
    await Promise.all(
      files.map(async (file) => {
        if (!file.endsWith(".log")) return;
        const fileDate = new Date(file.replace(".log", ""));
        if (Number.isNaN(fileDate.getTime())) return;
        if (fileDate < cutoff) await unlink(join(LOGS_DIR, file));
      }),
    );
  } catch (error) {
    logToStderr(`ошибка очистки старых логов: ${String(error)}`);
  }
}

async function ensureLogsDir(): Promise<void> {
  try {
    await readdir(LOGS_DIR);
  } catch {
    try {
      await mkdir(LOGS_DIR, { recursive: true });
    } catch (error) {
      logToStderr(`ошибка создания каталога логов: ${String(error)}`);
    }
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
  void ensureLogsDir();
  void cleanupOldLogs();

  let currentDate = today();
  let stream = openLogStream(currentDate);
  let streamFailed = false;

  const cleanupTimer = setInterval(() => {
    void cleanupOldLogs();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const fileCheckTimer = setInterval(() => {
    stat(currentLogPath(currentDate))
      .then(() => {
        if (!streamFailed) return;
        streamFailed = false;
        closeLogStream(stream);
        stream = openLogStream(currentDate);
      })
      .catch(() => {
        streamFailed = true;
      });
  }, FILE_CHECK_INTERVAL_MS);
  fileCheckTimer.unref();

  const wrapper = new Writable({
    write(chunk, encoding, callback) {
      const date = today();
      if (date !== currentDate || streamFailed) {
        closeLogStream(stream);
        currentDate = date;
        void ensureLogsDir();
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
