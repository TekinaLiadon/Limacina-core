import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOGS_DIR = join(process.cwd(), "logs");
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  lines: string[];
  expiresAt: number;
}

export interface LogsFilter {
  statusCode?: number | undefined;
  url?: string | undefined;
  ip?: string | undefined;
}

interface RequestLogEntry {
  req?: { url?: string; remoteAddress?: string };
  res?: { statusCode?: number };
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
        .toSorted()
        .toReversed();
      if (!dates.includes(today)) {
        dates.unshift(today);
      }
      return dates;
    } catch {
      return [today];
    }
  }

  getLines(
    date: string,
    offset: number,
    limit: number,
    filter?: LogsFilter,
  ): { lines: string[]; total: number } {
    this.validateDate(date);

    const allLines = this.getCachedLines(date);
    const matchedLines = this.filterRequestLines(allLines, filter);

    return {
      lines: matchedLines.slice(offset, offset + limit),
      total: matchedLines.length,
    };
  }

  private getCachedLines(date: string): string[] {
    const cached = this.cache.get(date);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.lines;
    }

    const lines = this.readLogFile(date);
    this.cache.set(date, { lines, expiresAt: now + CACHE_TTL_MS });
    return lines;
  }

  private filterRequestLines(lines: string[], filter?: LogsFilter): string[] {
    const matchedLines: string[] = [];

    for (const line of lines) {
      const entry = this.parseLogLine(line);
      if (!entry?.res?.statusCode) {
        continue;
      }
      if (!this.matchesFilter(entry, filter)) {
        continue;
      }
      matchedLines.push(line);
    }

    return matchedLines;
  }

  private parseLogLine(line: string): RequestLogEntry | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) {
        return undefined;
      }
      return parsed as RequestLogEntry;
    } catch {
      return undefined;
    }
  }

  private matchesFilter(entry: RequestLogEntry, filter?: LogsFilter): boolean {
    const statusCode = filter?.statusCode;
    if (statusCode !== undefined && entry.res?.statusCode !== statusCode) {
      return false;
    }

    const url = filter?.url;
    if (url !== undefined && !entry.req?.url?.toLowerCase().includes(url.toLowerCase())) {
      return false;
    }

    const ip = filter?.ip;
    if (ip !== undefined && !entry.req?.remoteAddress?.toLowerCase().includes(ip.toLowerCase())) {
      return false;
    }

    return true;
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
