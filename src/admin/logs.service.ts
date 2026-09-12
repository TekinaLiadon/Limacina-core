import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { createReadStream, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { LOG_DATE_PATTERN } from "./dto/dto";

const LOGS_DIR = join(process.cwd(), "logs");

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

  async getLines(
    date: string,
    offset: number,
    limit: number,
    filter?: LogsFilter,
  ): Promise<{ lines: string[]; total: number }> {
    this.validateDate(date);

    const filePath = join(LOGS_DIR, `${date}.log`);
    const total = await this.countMatchedLines(filePath, filter);
    const lines = await this.collectMatchedLines(filePath, filter, offset, limit);

    return { lines, total };
  }

  private async countMatchedLines(filePath: string, filter?: LogsFilter): Promise<number> {
    let total = 0;
    try {
      for await (const line of this.readLines(filePath)) {
        if (this.isMatchedRequestLine(line, filter)) total++;
      }
    } catch {
      this.logger.warn({ filePath }, "Лог-файл не прочитан");
    }
    return total;
  }

  private async collectMatchedLines(
    filePath: string,
    filter: LogsFilter | undefined,
    offset: number,
    limit: number,
  ): Promise<string[]> {
    const lines: string[] = [];
    let matchedBeforePage = 0;
    try {
      for await (const line of this.readLines(filePath)) {
        if (!this.isMatchedRequestLine(line, filter)) continue;
        if (matchedBeforePage < offset) {
          matchedBeforePage++;
          continue;
        }
        lines.push(line);
        if (lines.length >= limit) break;
      }
    } catch {
      this.logger.warn({ filePath }, "Лог-файл не прочитан");
    }
    return lines;
  }

  private readLines(filePath: string): ReturnType<typeof createInterface> {
    return createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
  }

  private isMatchedRequestLine(line: string, filter?: LogsFilter): boolean {
    const entry = this.parseLogLine(line);
    if (!entry?.res?.statusCode) {
      return false;
    }
    return this.matchesFilter(entry, filter);
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

  private validateDate(date: string): void {
    if (!LOG_DATE_PATTERN.test(date)) {
      throw new BadRequestException("Дата должна быть в формате YYYY-MM-DD");
    }
  }
}
