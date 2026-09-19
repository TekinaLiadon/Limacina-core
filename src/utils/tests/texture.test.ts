import { describe, expect, it } from "bun:test";
import { buildTestPng } from "./test-png";
import {
  buildDefaultSkinUrl,
  isSkinModel,
  pngStructureErrorMessage,
  sha256Hex,
  textureDimensionsErrorMessage,
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

  it("textureDimensionsErrorMessage пропускает допустимые размеры скина и плаща", () => {
    for (const size of [
      { width: 64, height: 32 },
      { width: 64, height: 64 },
    ]) {
      expect(textureDimensionsErrorMessage(buildTestPng(size), "skin")).toBeNull();
    }
    for (const size of [
      { width: 64, height: 32 },
      { width: 22, height: 17 },
    ]) {
      expect(textureDimensionsErrorMessage(buildTestPng(size), "cape")).toBeNull();
    }
  });

  it("textureDimensionsErrorMessage отклоняет недопустимые размеры", () => {
    const square = buildTestPng({ width: 128, height: 128 });
    expect(textureDimensionsErrorMessage(square, "skin")).toMatch(
      /dimensions 128x128 \(allowed: 64x32, 64x64\)/,
    );
    expect(textureDimensionsErrorMessage(square, "cape")).toMatch(/allowed: 64x32, 22x17/);
  });

  it("buildDefaultSkinUrl склеивает base URL и путь дефолтного скина", () => {
    expect(buildDefaultSkinUrl("http://localhost:3005")).toBe(
      "http://localhost:3005/textures/default.png",
    );
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
