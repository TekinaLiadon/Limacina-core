import { describe, expect, it } from "bun:test";
import { sanitizeFilePrefix } from "./file-prefix";

describe("sanitizeFilePrefix", (): void => {
  it("оставляет безопасные символы без изменений", (): void => {
    expect(sanitizeFilePrefix("Steve_123", "fallback")).toBe("Steve_123");
  });

  it("вырезает символы path traversal и разделители", (): void => {
    expect(sanitizeFilePrefix("../etc/passwd", "fallback")).toBe("etcpasswd");
  });

  it("возвращает fallback для полностью небезопасного значения", (): void => {
    expect(sanitizeFilePrefix("игрок★", "fallback")).toBe("fallback");
  });

  it("возвращает fallback для пустой строки", (): void => {
    expect(sanitizeFilePrefix("", "fallback")).toBe("fallback");
  });

  it("ограничивает длину префикса", (): void => {
    expect(sanitizeFilePrefix("a".repeat(100), "fallback")).toHaveLength(64);
  });
});
