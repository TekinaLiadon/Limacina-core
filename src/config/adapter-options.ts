import type { AppConfigType } from "./global-config";

export const DEFAULT_BODY_LIMIT_BYTES = Math.round(1.3 * 1024 * 1024);

export interface AdapterOptions {
  bodyLimit: number;
  trustProxy?: string | boolean;
}

export function buildAdapterOptions(config: AppConfigType): AdapterOptions {
  if (!config.BEHIND_PROXY) {
    return { bodyLimit: DEFAULT_BODY_LIMIT_BYTES };
  }
  return {
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY && config.TRUST_PROXY.length > 0 ? config.TRUST_PROXY : true,
  };
}
