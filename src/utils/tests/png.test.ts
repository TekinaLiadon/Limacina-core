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

describe("validatePngStructure — поля IHDR и порядок чанков", (): void => {
  interface IhdrOptions {
    bitDepth?: number;
    colorType?: number;
    compression?: number;
    filterMethod?: number;
    interlace?: number;
    length?: number;
  }

  function ihdrData(options: IhdrOptions = {}): Buffer {
    const data = Buffer.alloc(13);
    data.writeUInt32BE(64, 0);
    data.writeUInt32BE(64, 4);
    data[8] = options.bitDepth ?? 8;
    data[9] = options.colorType ?? 6;
    data[10] = options.compression ?? 0;
    data[11] = options.filterMethod ?? 0;
    data[12] = options.interlace ?? 0;
    return data;
  }

  function buildFromChunks(chunks: Buffer[]): Buffer {
    return Buffer.concat([TEST_PNG_SIGNATURE, ...chunks]);
  }

  function expectRejects(file: Buffer, message: string): void {
    expect(() => validatePngStructure(file)).toThrow(PngStructureError);
    expect(() => validatePngStructure(file)).toThrow(message);
  }

  it("отклоняет невалидную глубину цвета", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth: 3 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid bit depth 3");
  });

  it("отклоняет невалидный тип цвета", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 1 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid color type 1");
  });

  it("отклоняет невалидный метод сжатия", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ compression: 1 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid compression method");
  });

  it("отклоняет невалидный метод фильтрации", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ filterMethod: 1 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid filter method");
  });

  it("отклоняет невалидный метод интерлейса", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ interlace: 2 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid interlace method");
  });

  it("отклоняет невалидную длину IHDR", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", Buffer.alloc(12)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid IHDR length");
  });

  it("отклоняет чанк с не-буквенным типом", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData()),
      pngChunk("IH@R", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "invalid chunk type");
  });

  it("отклоняет повторный IHDR", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData()),
      pngChunk("IHDR", ihdrData()),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "duplicate IHDR");
  });

  it("отклоняет файл без IEND-чанка", (): void => {
    const file = buildFromChunks([pngChunk("IHDR", ihdrData()), pngChunk("IDAT", Buffer.alloc(4))]);
    expectRejects(file, "IEND chunk not found");
  });
});
