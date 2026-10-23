export const LAUNCHER_ID_HEADER = "x-launcher-id";

const INSTALL_ID_PATTERN = /^v1-[0-9a-f]{32}$/;

export const INSTALL_ID_SEARCH_PATTERN = /^[0-9a-fv-]{1,35}$/i;

export function resolveLauncherInstallId(rawHeader: string | undefined): string | undefined {
  if (!rawHeader) return undefined;
  return INSTALL_ID_PATTERN.test(rawHeader) ? rawHeader : undefined;
}
