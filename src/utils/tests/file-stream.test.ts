import { describe, expect, it } from "bun:test";
import { parseByteRange } from "../file-stream";

describe("parseByteRange", (): void => {
  it("парсит bytes=start-end с клампом конца по размеру файла", () => {
    expect(parseByteRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
    expect(parseByteRange("bytes=2-99", 10)).toEqual({ start: 2, end: 9 });
  });

  it("парсит открытый конец bytes=start-", () => {
    expect(parseByteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
  });

  it("парсит суффикс bytes=-N как последние N байт", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-99", 10)).toEqual({ start: 0, end: 9 });
  });

  it("start за пределами файла — unsatisfiable", () => {
    expect(parseByteRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=42-50", 10)).toBe("unsatisfiable");
  });

  it("bytes=-0 — unsatisfiable", () => {
    expect(parseByteRange("bytes=-0", 10)).toBe("unsatisfiable");
  });

  it("мусорные заголовки игнорируются (null — отдать файл целиком)", () => {
    expect(parseByteRange("bytes=abc", 10)).toBeNull();
    expect(parseByteRange("chunks=0-1", 10)).toBeNull();
    expect(parseByteRange("bytes=5-2", 10)).toBeNull();
    expect(parseByteRange("bytes=0-1,3-4", 10)).toBeNull();
  });
});
