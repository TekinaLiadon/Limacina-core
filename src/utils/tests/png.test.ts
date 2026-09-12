import { describe, expect, it } from "bun:test";
import { MAX_PNG_DIMENSION, PngStructureError, validatePngStructure } from "../png";
import { buildTestPng, pngChunk, TEST_PNG_SIGNATURE } from "./test-png";

describe("validatePngStructure (TASK-24)", (): void => {
  it("пропускает структурно корректный PNG", (): void => {
    expect(() => validatePngStructure(buildTestPng())).not.toThrow();
  });

  it("пропускает PNG каждого варианта содержимого", (): void => {
    for (const variant of [1, 42, 255]) {
      expect(() => validatePngStructure(buildTestPng({ variant }))).not.toThrow();
    }
  });

  it("отклоняет файл без PNG-сигнатуры", (): void => {
    expect(() => validatePngStructure(Buffer.from("not a png at all"))).toThrow(PngStructureError);
  });

  it("отклоняет обрезанный файл", (): void => {
    const file = buildTestPng();
    expect(() => validatePngStructure(file.subarray(0, 30))).toThrow(PngStructureError);
  });

  it("отклоняет битый CRC чанка", (): void => {
    const file = buildTestPng();
    file[30] = (file[30]! + 1) & 0xff;
    expect(() => validatePngStructure(file)).toThrow(/CRC mismatch/);
  });

  it("отклоняет чанк, выходящий за размер файла", (): void => {
    const fake = Buffer.concat([buildTestPng().subarray(0, 16)]);
    fake.writeUInt32BE(0xffffffff, 8);
    expect(() => validatePngStructure(fake)).toThrow(/exceeds file size/);
  });

  it("отклоняет файл без IDAT", (): void => {
    const file = Buffer.concat([buildTestPng().subarray(0, 33), pngChunk("IEND", Buffer.alloc(0))]);
    expect(() => validatePngStructure(file)).toThrow(/no IDAT/);
  });

  it("отклоняет данные после IEND", (): void => {
    const file = Buffer.concat([buildTestPng(), Buffer.from("trailing")]);
    expect(() => validatePngStructure(file)).toThrow(/after IEND/);
  });

  it("отклоняет первый чанк не IHDR", (): void => {
    const file = Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("gAMA", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(file)).toThrow(/not IHDR/);
  });

  it("отклоняет измерения больше лимита", (): void => {
    const oversized = buildTestPng({ width: MAX_PNG_DIMENSION + 1, height: 1 });
    expect(() => validatePngStructure(oversized)).toThrow(/dimensions 1025x1 exceed 1024/);
  });

  it("отклоняет нулевые измерения", (): void => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(0, 0);
    ihdr.writeUInt32BE(64, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const file = Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", Buffer.alloc(10)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(file)).toThrow(/zero dimension/);
  });
});
