import { describe, expect, it } from "bun:test";
import { buildTestPng } from "./test-png";
import {
  buildDefaultSkinUrl,
  isSkinModel,
  MAX_TEXTURE_BYTES,
  pngStructureErrorMessage,
  sha256Hex,
  capeDimensionsErrorMessage,
  textureFileIssue,
} from "../texture";
import { lastById } from "../collection";

describe("texture utils", () => {
  it("sha256Hex стабилен и отличает содержимое", () => {
    const file = buildTestPng();
    expect(sha256Hex(file)).toBe(sha256Hex(file));
    expect(sha256Hex(file)).not.toBe(sha256Hex(buildTestPng({ variant: 7 })));
  });

  it("sha256Hex возвращает 64 hex-символа", () => {
    expect(sha256Hex(buildTestPng())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pngStructureErrorMessage возвращает null для корректного PNG", () => {
    expect(pngStructureErrorMessage(buildTestPng())).toBeNull();
  });

  it("pngStructureErrorMessage возвращает сообщение для битого PNG", () => {
    const file = buildTestPng();
    file[30] = (file[30]! + 1) & 0xff;

    expect(pngStructureErrorMessage(file)).toMatch(/CRC mismatch/);
  });

  it("pngStructureErrorMessage возвращает сообщение для не-PNG", () => {
    expect(pngStructureErrorMessage(Buffer.from("not a png at all"))).toMatch(/signature/);
  });

  it("isSkinModel принимает только classic/slim", () => {
    expect(isSkinModel("classic")).toBe(true);
    expect(isSkinModel("slim")).toBe(true);
    expect(isSkinModel("STEVE")).toBe(false);
    expect(isSkinModel("")).toBe(false);
  });

  it("capeDimensionsErrorMessage пропускает допустимые размеры плаща", () => {
    for (const size of [
      { width: 64, height: 32 },
      { width: 22, height: 17 },
    ]) {
      expect(capeDimensionsErrorMessage(buildTestPng(size))).toBeNull();
    }
  });

  it("capeDimensionsErrorMessage отклоняет недопустимые размеры плаща", () => {
    const nonCape = buildTestPng({ width: 96, height: 96 });

    expect(capeDimensionsErrorMessage(nonCape)).toMatch(
      /dimensions 96x96 \(allowed: 64x32, 22x17\)/,
    );
  });

  it("buildDefaultSkinUrl склеивает base URL и путь дефолтного скина", () => {
    expect(buildDefaultSkinUrl("http://localhost:3005")).toBe(
      "http://localhost:3005/textures/default.png",
    );
  });
});

describe("textureFileIssue", () => {
  it("возвращает null для валидного скина и плаща", () => {
    expect(textureFileIssue(buildTestPng(), "skin")).toBeNull();
    expect(textureFileIssue(buildTestPng({ width: 64, height: 32 }), "cape")).toBeNull();
  });

  it("фиксирует превышение размера до проверки структуры", () => {
    const oversized = Buffer.alloc(MAX_TEXTURE_BYTES + 1, 0);

    expect(textureFileIssue(oversized, "skin")).toEqual({
      kind: "size",
      bytes: MAX_TEXTURE_BYTES + 1,
      maxBytes: MAX_TEXTURE_BYTES,
    });
  });

  it("фиксирует битую структуру PNG", () => {
    const file = buildTestPng();
    file[30] = (file[30]! + 1) & 0xff;

    const issue = textureFileIssue(file, "skin");
    expect(issue?.kind).toBe("structure");
  });

  it("пропускает скин с любыми размерами", () => {
    for (const size of [
      { width: 96, height: 96 },
      { width: 300, height: 600 },
      { width: 1024, height: 1024 },
    ]) {
      expect(textureFileIssue(buildTestPng(size), "skin")).toBeNull();
    }
  });

  it("фиксирует недопустимые размеры плаща", () => {
    const issue = textureFileIssue(buildTestPng({ width: 96, height: 96 }), "cape");

    expect(issue?.kind).toBe("dimensions");
    if (issue?.kind === "dimensions") {
      expect(issue.message).toMatch(/dimensions 96x96/);
    }
  });
});

describe("collection utils", () => {
  it("lastById выбирает запись с наибольшим id", () => {
    const items = [{ id: 5 }, { id: 2 }, { id: 9 }];

    expect(lastById(items)).toEqual({ id: 9 });
  });

  it("lastById пустого массива возвращает undefined", () => {
    expect(lastById([])).toBeUndefined();
  });

  it("lastById не мутирует исходный массив", () => {
    const items = [{ id: 2 }, { id: 1 }];

    lastById(items);

    expect(items.map((item) => item.id)).toEqual([2, 1]);
  });
});
