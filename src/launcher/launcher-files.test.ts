import { setupTestEnv } from "../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { isSupportedPlatform } from "./launcher-files";

describe("isSupportedPlatform", (): void => {
  it("известная платформа разрешена", (): void => {
    expect(isSupportedPlatform("linux", "x86_64")).toBe(true);
    expect(isSupportedPlatform("macos", "arm64")).toBe(true);
  });

  it("известная os с неизвестной arch запрещена", (): void => {
    expect(isSupportedPlatform("linux", "riscv")).toBe(false);
  });

  it("неизвестная os запрещена", (): void => {
    expect(isSupportedPlatform("templeos", "x86_64")).toBe(false);
  });

  it("прототипные ключи не проходят как os (TASK-66)", (): void => {
    expect(isSupportedPlatform("toString", "x86_64")).toBe(false);
    expect(isSupportedPlatform("constructor", "x86_64")).toBe(false);
    expect(isSupportedPlatform("hasOwnProperty", "x86_64")).toBe(false);
  });
});
