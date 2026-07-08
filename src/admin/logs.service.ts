import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOGS_DIR = join(process.cwd(), "logs");
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  lines: string[];
  expiresAt: number;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  listAvailableDates(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const dates = readdirSync(LOGS_DIR)
        .filter((f) => f.endsWith(".log"))
        .map((f) => f.replace(".log", ""))
        .sort()
        .reverse();
      if (!dates.includes(today)) {
        dates.unshift(today);
      }
      return dates;
    } catch {
      return [today];
    }
  }

  getLines(date: string, offset: number, limit: number): { lines: string[]; total: number } {
    this.validateDate(date);

    const cached = this.cache.get(date);
    const now = Date.now();

    let lines: string[];
    if (cached && cached.expiresAt > now) {
      lines = cached.lines;
    } else {
      lines = this.readLogFile(date);
      this.cache.set(date, { lines, expiresAt: now + CACHE_TTL_MS });
    }

    return {
      lines: lines.slice(offset, offset + limit),
      total: lines.length,
    };
  }

  private readLogFile(date: string): string[] {
    const filePath = join(LOGS_DIR, `${date}.log`);
    try {
      const content = readFileSync(filePath, "utf-8");
      return content.split("\n").filter((line) => line.length > 0);
    } catch {
      this.logger.warn({ date }, "Лог-файл не найден");
      return [];
    }
  }

  private validateDate(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Дата должна быть в формате YYYY-MM-DD");
    }
  }
}
