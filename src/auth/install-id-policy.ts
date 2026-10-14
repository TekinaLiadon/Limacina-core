export const LAUNCHER_ID_HEADER = "x-launcher-id";

const INSTALL_ID_PATTERN = /^v1-[0-9a-f]{32}$/;

export function resolveLauncherInstallId(rawHeader: string | undefined): string | undefined {
  if (!rawHeader) return undefined;
  return INSTALL_ID_PATTERN.test(rawHeader) ? rawHeader : undefined;
}
