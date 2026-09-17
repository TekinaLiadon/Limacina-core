import { baseRequiredEnv, setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import GlobalConfig, { type AppConfigType } from "../global-config";
import { DEFAULT_BODY_LIMIT_BYTES, buildAdapterOptions } from "../adapter-options";

function rawEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseRequiredEnv(), ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function parseWith(overrides: Record<string, string | undefined>): AppConfigType {
  return GlobalConfig.parseEnvOrExit(rawEnv(overrides));
}

describe("BEHIND_PROXY и лимиты в AppConfig", (): void => {
  it("BEHIND_PROXY по умолчанию true (деплой за reverse-proxy)", (): void => {
    expect(parseWith({}).BEHIND_PROXY).toBe(true);
  });

  it("BEHIND_PROXY=false отключает доверие прокси", (): void => {
    expect(parseWith({ BEHIND_PROXY: "false" }).BEHIND_PROXY).toBe(false);
  });

  it("BEHIND_PROXY отличное от true/false валит старт", (): void => {
    const result = GlobalConfig.tryParseEnv(rawEnv({ BEHIND_PROXY: "yes" }));
    expect(result.success).toBe(false);
  });

  it("RATE_LIMIT_AUTH_IP_MAX по умолчанию 10, переопределяется env", (): void => {
    expect(parseWith({}).RATE_LIMIT_AUTH_IP_MAX).toBe(10);
    expect(parseWith({ RATE_LIMIT_AUTH_IP_MAX: "25" }).RATE_LIMIT_AUTH_IP_MAX).toBe(25);
  });

  it("RATE_LIMIT_GLOBAL_MAX/WINDOW по умолчанию 600/60000", (): void => {
    expect(parseWith({}).RATE_LIMIT_GLOBAL_MAX).toBe(600);
    expect(parseWith({}).RATE_LIMIT_GLOBAL_WINDOW).toBe(60_000);
    expect(parseWith({ RATE_LIMIT_GLOBAL_MAX: "1000" }).RATE_LIMIT_GLOBAL_MAX).toBe(1000);
  });

  it("TRUST_PROXY без BEHIND_PROXY=true валит старт", (): void => {
    const result = GlobalConfig.tryParseEnv(
      rawEnv({ BEHIND_PROXY: "false", TRUST_PROXY: "10.0.0.1" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("buildAdapterOptions", (): void => {
  it("за прокси без TRUST_PROXY — доверять всем (nginx на том же хосте из коробки)", (): void => {
    const config = { BEHIND_PROXY: true } as unknown as AppConfigType;
    expect(buildAdapterOptions(config)).toEqual({
      bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
      trustProxy: true,
    });
  });

  it("за прокси с TRUST_PROXY — доверять только указанному адресу", (): void => {
    const config = { BEHIND_PROXY: true, TRUST_PROXY: "10.0.0.1" } as unknown as AppConfigType;
    expect(buildAdapterOptions(config)).toEqual({
      bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
      trustProxy: "10.0.0.1",
    });
  });

  it("без прокси — trustProxy не выставляется, X-Forwarded-For игнорируется", (): void => {
    const config = { BEHIND_PROXY: false, TRUST_PROXY: "10.0.0.1" } as unknown as AppConfigType;
    const options = buildAdapterOptions(config);

    expect("trustProxy" in options).toBe(false);
    expect(options.bodyLimit).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });
});
