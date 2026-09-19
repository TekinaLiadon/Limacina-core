import { setupTestEnv } from "../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import {
  UPDATER_PLATFORM_KEYS,
  buildUpdaterArtifactName,
  isSupportedPlatform,
  matchUpdaterArtifactSuffix,
} from "./launcher-files";

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

describe("платформы tauri-plugin-updater", (): void => {
  it("ключи выводятся из SUPPORTED_PLATFORMS с переименованием tauri", (): void => {
    expect(UPDATER_PLATFORM_KEYS).toEqual([
      "linux-x86_64",
      "linux-aarch64",
      "darwin-aarch64",
      "windows-x86_64",
    ]);
  });

  it("buildUpdaterArtifactName даёт каноническое имя артефакта", (): void => {
    expect(buildUpdaterArtifactName("1.2.3", "windows-x86_64", ".exe")).toBe(
      "Limacina-1.2.3-windows-x86_64.exe",
    );
    expect(buildUpdaterArtifactName("1.2.3", "darwin-aarch64", ".app.tar.gz")).toBe(
      "Limacina-1.2.3-darwin-aarch64.app.tar.gz",
    );
  });

  it("matchUpdaterArtifactSuffix распознаёт суффиксы платформы без учёта регистра", (): void => {
    expect(matchUpdaterArtifactSuffix("MyApp_1.2.3_x64-setup.exe", "windows-x86_64")).toBe(".exe");
    expect(matchUpdaterArtifactSuffix("limacina.AppImage", "linux-x86_64")).toBe(".AppImage");
    expect(matchUpdaterArtifactSuffix("app-1.0.app.tar.gz", "darwin-aarch64")).toBe(".app.tar.gz");
  });

  it("matchUpdaterArtifactSuffix отклоняет чужие расширения и платформы", (): void => {
    expect(matchUpdaterArtifactSuffix("setup.msi", "windows-x86_64")).toBeNull();
    expect(matchUpdaterArtifactSuffix("app.dmg", "darwin-aarch64")).toBeNull();
    expect(matchUpdaterArtifactSuffix("setup.exe", "darwin-x86_64")).toBeNull();
  });
});
