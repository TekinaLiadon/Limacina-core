import { Logger } from "@nestjs/common";
import { unlink } from "node:fs/promises";
import { sha256Hex } from "./texture";

export const TEXTURE_DIRECTORIES = ["textures", "capes"] as const;

export interface ContentFileLocation {
  filename: string;
  url: string;
  path: string;
}

export function buildContentLocation(
  baseUrl: string,
  directory: string,
  prefix: string,
  content: Uint8Array,
  extension: string,
): ContentFileLocation {
  const filename = `${prefix}-${sha256Hex(content)}.${extension}`;
  return {
    filename,
    url: `${baseUrl}/${directory}/${filename}`,
    path: `public/${directory}/${filename}`,
  };
}

export function resolvePublicContentPath(
  baseUrl: string,
  url: string,
  directories: readonly string[],
): string | undefined {
  const baseUrlPrefix = `${baseUrl}/`;
  if (!url.startsWith(baseUrlPrefix)) return undefined;
  const relative = url.slice(baseUrlPrefix.length);
  const [directory, ...restSegments] = relative.split("/");
  if (directory === undefined || restSegments.length === 0) return undefined;
  if (!directories.includes(directory)) return undefined;
  if (restSegments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return `public/${relative}`;
}

export interface ContentFileRelease {
  logger: Logger;
  baseUrl: string;
  url: string;
  directories: readonly string[];
  referenceCount: number;
}

export async function releaseContentFile(release: ContentFileRelease): Promise<boolean> {
  const { logger, baseUrl, url, directories, referenceCount } = release;
  if (referenceCount > 0) {
    logger.debug({ url, referenceCount }, "Файл контента ещё используется, не удаляется");
    return false;
  }
  const localPath = resolvePublicContentPath(baseUrl, url, directories);
  if (!localPath) {
    logger.warn({ url }, "URL контента вне публичных каталогов, файл не удаляется");
    return false;
  }
  try {
    await unlink(localPath);
    logger.debug({ url, localPath }, "Файл контента удалён");
    return true;
  } catch (error) {
    logger.error({ err: error, path: localPath }, "Не удалось удалить файл контента");
    return false;
  }
}
