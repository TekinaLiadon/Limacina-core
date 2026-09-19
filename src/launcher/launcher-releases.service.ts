import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import type {
  UpdaterLatestDto,
  UpdaterPlatformReleaseDto,
  UpdaterReleaseInfoDto,
  UpdaterReleasesListDto,
} from "./dto/dto";
import {
  LAUNCHER_VERSION_REGEX,
  PUBLIC_DIR,
  RELEASES_DIR,
  UPDATER_PLATFORMS,
  VERSION_FORMAT_MESSAGE,
  buildUpdaterArtifactName,
  compareVersions,
} from "./launcher-files";

interface CollectedPlatform {
  key: string;
  release: UpdaterPlatformReleaseDto;
  mtimeMs: number;
}

@Injectable()
export class LauncherReleasesService {
  private readonly logger = new Logger(LauncherReleasesService.name);

  constructor(@Inject(AppConfigToken) private readonly config: AppConfigType) {}

  getLatest(version?: string): UpdaterLatestDto {
    if (version && !LAUNCHER_VERSION_REGEX.test(version)) {
      throw new BadRequestException(VERSION_FORMAT_MESSAGE);
    }

    const target = version || this.resolveLatestVersion();
    const platforms = this.collectPlatforms(target);
    if (platforms.length === 0) {
      throw new NotFoundException(
        version
          ? `Релиз ${target} не найден или не содержит полных пар артефакт+подпись`
          : "Релизы лаунчера не найдены",
      );
    }

    const newestMtime = Math.max(...platforms.map((platform) => platform.mtimeMs));
    return {
      version: target,
      pub_date: new Date(newestMtime).toISOString(),
      platforms: Object.fromEntries(platforms.map((platform) => [platform.key, platform.release])),
    };
  }

  listReleases(): UpdaterReleasesListDto {
    const root = this.releasesRoot();
    if (!existsSync(root)) return { releases: [] };

    const releases: UpdaterReleaseInfoDto[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !LAUNCHER_VERSION_REGEX.test(entry.name)) continue;

      const platforms = this.collectPlatforms(entry.name);
      if (platforms.length === 0) continue;

      const newestMtime = Math.max(...platforms.map((platform) => platform.mtimeMs));
      releases.push({
        version: entry.name,
        pubDate: new Date(newestMtime).toISOString(),
        platforms: platforms.map((platform) => platform.key),
      });
    }

    return { releases: releases.toSorted((a, b) => compareVersions(b.version, a.version)) };
  }

  private resolveLatestVersion(): string {
    const root = this.releasesRoot();
    if (!existsSync(root)) {
      throw new NotFoundException("Релизы лаунчера не найдены");
    }

    const versions = readdirSync(root).filter(
      (entry) => LAUNCHER_VERSION_REGEX.test(entry) && this.collectPlatforms(entry).length > 0,
    );
    if (versions.length === 0) {
      throw new NotFoundException("Релизы лаунчера не найдены");
    }

    return versions.reduce((newest, version) =>
      compareVersions(version, newest) > 0 ? version : newest,
    );
  }

  private collectPlatforms(version: string): CollectedPlatform[] {
    const dir = this.releaseDir(version);
    if (!existsSync(dir)) return [];

    const collected: CollectedPlatform[] = [];
    for (const platform of UPDATER_PLATFORMS) {
      for (const suffix of platform.artifactSuffixes) {
        const artifactName = buildUpdaterArtifactName(version, platform.key, suffix);
        const artifactPath = join(dir, artifactName);
        const signaturePath = `${artifactPath}.sig`;
        if (!existsSync(artifactPath) || !existsSync(signaturePath)) continue;

        try {
          const signature = readFileSync(signaturePath, "utf-8");
          if (signature.trim().length === 0) {
            this.logger.warn(
              { file: `${artifactName}.sig` },
              "Платформа релиза пропущена: пустая подпись",
            );
            break;
          }
          const release: UpdaterPlatformReleaseDto = {
            url: `${this.config.BASE_URL}/releases/${version}/${artifactName}`,
            signature,
          };
          collected.push({
            key: platform.key,
            release,
            mtimeMs: statSync(artifactPath).mtimeMs,
          });
        } catch (error) {
          this.logger.warn(
            { err: error, file: artifactName },
            "Не удалось прочитать артефакт релиза",
          );
        }
        break;
      }
    }
    return collected;
  }

  private releasesRoot(): string {
    return join(PUBLIC_DIR, RELEASES_DIR);
  }

  private releaseDir(version: string): string {
    return join(PUBLIC_DIR, RELEASES_DIR, version);
  }
}
