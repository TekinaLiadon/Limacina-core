import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { resolveKeysDir } from "../service/yggdrasil.service";

describe("resolveKeysDir", (): void => {
  it("KEYS_DIR из env переопределяет путь", (): void => {
    process.env["KEYS_DIR"] = "/tmp/opencode/custom-keys";
    expect(resolveKeysDir()).toBe("/tmp/opencode/custom-keys");
    delete process.env["KEYS_DIR"];
  });

  it("относительный KEYS_DIR резолвится от cwd", (): void => {
    process.env["KEYS_DIR"] = "custom-keys";
    expect(resolveKeysDir()).toBe(resolve("custom-keys"));
    delete process.env["KEYS_DIR"];
  });

  it("без KEYS_DIR возвращает каталог keys проекта", (): void => {
    const dir = resolveKeysDir();
    expect(dir.endsWith("keys")).toBe(true);
  });
});
