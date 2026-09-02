export const LAUNCHER_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

export const OLD_VERSIONS_DIR = "old";

export const SUPPORTED_PLATFORMS: Record<string, string[]> = {
  linux: ["x86_64", "aarch64"],
  macos: ["arm64"],
  windows: ["x86_64"],
};

export const SUPPORTED_OS: string[] = Object.keys(SUPPORTED_PLATFORMS);

export const SUPPORTED_ARCHS: string[] = [...new Set(Object.values(SUPPORTED_PLATFORMS).flat())];

export const PLATFORM_FIELD_NAMES: string[] = Object.entries(SUPPORTED_PLATFORMS).flatMap(
  ([os, archs]) => archs.map((arch) => `${os}_${arch}`),
);

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
