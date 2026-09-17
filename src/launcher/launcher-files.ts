import { join } from "node:path";

export const LAUNCHER_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

export const VERSION_FORMAT_MESSAGE = "Версия должна быть в формате x.x.x (например 1.2.3)";

export const PUBLIC_DIR = "public";

export const UPLOAD_TMP_DIR = join(PUBLIC_DIR, ".upload-tmp");

export const OLD_VERSIONS_DIR = "old";

export const RELEASES_DIR = "releases";

export const SUPPORTED_PLATFORMS: Record<string, string[]> = {
  linux: ["x86_64", "aarch64"],
  macos: ["arm64"],
  windows: ["x86_64"],
};

const UPDATER_OS_NAMES: Record<string, string> = { macos: "darwin" };
const UPDATER_ARCH_NAMES: Record<string, string> = { arm64: "aarch64" };

const UPDATER_ARTIFACT_SUFFIXES: Record<string, string[]> = {
  windows: [".exe"],
  linux: [".AppImage"],
  macos: [".app.tar.gz"],
};

export interface UpdaterPlatformInfo {
  os: string;
  arch: string;
  key: string;
  artifactSuffixes: string[];
}

export const UPDATER_PLATFORMS: UpdaterPlatformInfo[] = Object.entries(SUPPORTED_PLATFORMS).flatMap(
  ([os, archs]) =>
    archs.map((arch) => ({
      os,
      arch,
      key: `${UPDATER_OS_NAMES[os] ?? os}-${UPDATER_ARCH_NAMES[arch] ?? arch}`,
      artifactSuffixes: UPDATER_ARTIFACT_SUFFIXES[os] ?? [],
    })),
);

export const UPDATER_PLATFORM_KEYS: string[] = UPDATER_PLATFORMS.map((platform) => platform.key);

export function findUpdaterPlatform(key: string): UpdaterPlatformInfo | undefined {
  return UPDATER_PLATFORMS.find((platform) => platform.key === key);
}

export function buildUpdaterArtifactName(version: string, key: string, suffix: string): string {
  return `Limacina-${version}-${key}${suffix}`;
}

export function matchUpdaterArtifactSuffix(filename: string, key: string): string | null {
  const platform = findUpdaterPlatform(key);
  if (!platform) return null;

  const lower = filename.toLowerCase();
  const matched = platform.artifactSuffixes.find((suffix) => lower.endsWith(suffix.toLowerCase()));
  return matched ?? null;
}

export const SUPPORTED_OS: string[] = Object.keys(SUPPORTED_PLATFORMS);

export const SUPPORTED_ARCHS: string[] = [...new Set(Object.values(SUPPORTED_PLATFORMS).flat())];

export const PLATFORM_FIELD_NAMES: string[] = Object.entries(SUPPORTED_PLATFORMS).flatMap(
  ([os, archs]) => archs.map((arch) => `${os}_${arch}`),
);

export function isSupportedPlatform(os: string, arch: string): boolean {
  const archs = Object.hasOwn(SUPPORTED_PLATFORMS, os) ? SUPPORTED_PLATFORMS[os] : undefined;
  return archs?.includes(arch) ?? false;
}

export function buildLauncherZipName(version: string, os: string, arch: string): string {
  return `Limacina-${version}-${os}-${arch}.zip`;
}

export function parseLauncherZipName(filename: string, os: string, arch: string): string | null {
  const suffix = `-${os}-${arch}.zip`;
  if (!filename.startsWith("Limacina-") || !filename.endsWith(suffix)) return null;

  const version = filename.slice("Limacina-".length, filename.length - suffix.length);
  return LAUNCHER_VERSION_REGEX.test(version) ? version : null;
}

export function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map((part) => Number.parseInt(part, 10));
  const bParts = b.split(".").map((part) => Number.parseInt(part, 10));

  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}
