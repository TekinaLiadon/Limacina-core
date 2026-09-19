import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { Logger } from "@nestjs/common";

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

export function removeFilesQuietly(logger: Logger, paths: string[], errorMessage: string): void {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
    } catch (error) {
      logger.error({ err: error, path }, errorMessage);
    }
  }
}

export function writeFileAtomicSync(
  filePath: string,
  data: string,
  writeOptions?: { mode?: number },
): void {
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, data, writeOptions);
    renameSync(tmpPath, filePath);
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
}
