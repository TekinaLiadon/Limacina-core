import type { MemoryInstallIdRecord } from "../memory/memory-db";

export type InstallIdRecord = MemoryInstallIdRecord;

export function parseInstallIdHistory(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function toInstallIdList(record: InstallIdRecord): string[] {
  return [record.current, ...record.history.filter((id) => id !== record.current)];
}
