import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { resolveKeysDir } from "../service/yggdrasil.service";

describe("resolveKeysDir", (): void => {
  it("KEYS_DIR из конфига переопределяет путь", (): void => {
    expect(resolveKeysDir("/tmp/opencode/custom-keys")).toBe("/tmp/opencode/custom-keys");
  });

  it("относительный KEYS_DIR резолвится от cwd", (): void => {
    expect(resolveKeysDir("custom-keys")).toBe(resolve("custom-keys"));
  });

  it("пустой KEYS_DIR игнорируется и используется каталог проекта", (): void => {
    const dir = resolveKeysDir("");
    expect(dir.endsWith("keys")).toBe(true);
  });

  it("без KEYS_DIR возвращает каталог keys проекта", (): void => {
    const dir = resolveKeysDir();
    expect(dir.endsWith("keys")).toBe(true);
  });
});
