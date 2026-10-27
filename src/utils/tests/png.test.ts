import { describe, expect, it } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import {
  MAX_PNG_DIMENSION,
  PngStructureError,
  readPngDimensions,
  sanitizePng,
  validatePngStructure,
} from "../png";
import { buildTestPng, pngChunk, TEST_PNG_SIGNATURE } from "./test-png";

describe("validatePngStructure", (): void => {
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

  it("отклоняет пустой IDAT-чанк", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData()),
      pngChunk("IDAT", Buffer.alloc(0)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "empty IDAT chunk");
  });

  const expectIhdrPairRejects = (bitDepth: number, colorType: number, message: string): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth, colorType })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, message);
  };

  it("отклоняет недопустимую пару bitDepth/colorType", (): void => {
    expectIhdrPairRejects(16, 3, "invalid bit depth 16 for color type 3");
    expectIhdrPairRejects(1, 6, "invalid bit depth 1 for color type 6");
    expectIhdrPairRejects(4, 2, "invalid bit depth 4 for color type 2");
    expectIhdrPairRejects(1, 4, "invalid bit depth 1 for color type 4");
    expectIhdrPairRejects(32, 6, "invalid bit depth 32 for color type 6");
  });

  it("пропускает допустимые пары bitDepth/colorType", (): void => {
    for (const [bitDepth, colorType] of [
      [1, 0],
      [2, 0],
      [4, 0],
      [8, 0],
      [16, 0],
      [8, 2],
      [16, 2],
      [1, 3],
      [2, 3],
      [4, 3],
      [8, 3],
      [8, 4],
      [16, 4],
      [8, 6],
      [16, 6],
    ] as const) {
      const chunks = [pngChunk("IHDR", ihdrData({ bitDepth, colorType }))];
      if (colorType === 3) chunks.push(pngChunk("PLTE", Buffer.alloc(3)));
      chunks.push(pngChunk("IDAT", Buffer.alloc(4)));
      chunks.push(pngChunk("IEND", Buffer.alloc(0)));
      expect(() => validatePngStructure(buildFromChunks(chunks))).not.toThrow();
    }
  });

  it("отклоняет indexed (colorType 3) без PLTE перед IDAT", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth: 8, colorType: 3 })),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "missing PLTE for indexed color");
  });

  it("пропускает indexed с PLTE перед IDAT", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth: 8, colorType: 3 })),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(file)).not.toThrow();
  });

  it("отклоняет повторный PLTE и PLTE в grayscale", (): void => {
    const duplicated = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth: 8, colorType: 3 })),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(duplicated, "duplicate PLTE");

    const grayscale = buildFromChunks([
      pngChunk("IHDR", ihdrData({ bitDepth: 8, colorType: 0 })),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(grayscale, "PLTE not allowed for color type 0");
  });

  it("отклоняет повторный tRNS", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 0 })),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "duplicate tRNS");
  });

  it("отклоняет tRNS неверной длины для colorType 0 и 2", (): void => {
    const grayscale = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 0 })),
      pngChunk("tRNS", Buffer.alloc(3)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(grayscale, "invalid tRNS length 3 for color type 0");

    const truecolor = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 2 })),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(truecolor, "invalid tRNS length 2 for color type 2");
  });

  it("отклоняет tRNS длиннее палитры для colorType 3", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 3 })),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "tRNS length 2 exceeds palette size 1");
  });

  it("отклоняет tRNS до PLTE для colorType 3", (): void => {
    const file = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 3 })),
      pngChunk("tRNS", Buffer.alloc(1)),
      pngChunk("PLTE", Buffer.alloc(3)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expectRejects(file, "tRNS before PLTE");
  });

  it("пропускает tRNS допустимой длины для colorType", (): void => {
    const grayscale = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 0 })),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(grayscale)).not.toThrow();

    const truecolor = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 2 })),
      pngChunk("tRNS", Buffer.alloc(6)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(truecolor)).not.toThrow();

    const indexed = buildFromChunks([
      pngChunk("IHDR", ihdrData({ colorType: 3 })),
      pngChunk("PLTE", Buffer.alloc(6)),
      pngChunk("tRNS", Buffer.alloc(2)),
      pngChunk("IDAT", Buffer.alloc(4)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validatePngStructure(indexed)).not.toThrow();
  });

  it("readPngDimensions читает размеры валидного PNG", (): void => {
    const file = buildTestPng({ width: 64, height: 32 });
    expect(readPngDimensions(file)).toEqual({ width: 64, height: 32 });
  });
});

describe("sanitizePng", (): void => {
  const buildWithMetadata = (): Buffer => {
    const source = buildTestPng({ variant: 7 });
    const idat = idatPayload(source);
    return Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("IHDR", source.subarray(16, 29)),
      pngChunk("gAMA", Buffer.alloc(4, 1)),
      pngChunk("tEXt", Buffer.from("Comment\x00junk-metadata")),
      pngChunk("IDAT", idat),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  };

  it("пересохраняет PNG без посторонних чанков", (): void => {
    const sanitized = sanitizePng(buildWithMetadata());

    expect(() => validatePngStructure(sanitized)).not.toThrow();
    const text = sanitized.toString("latin1");
    expect(text).not.toContain("tEXt");
    expect(text).not.toContain("gAMA");
    expect(text).not.toContain("junk-metadata");
  });

  it("сохраняет пиксельные данные без изменений", (): void => {
    const source = buildWithMetadata();
    const sanitized = sanitizePng(source);

    expect(inflateSync(idatPayload(sanitized)).equals(inflateSync(idatPayload(source)))).toBe(true);
  });

  it("отклоняет битый zlib-поток в IDAT", (): void => {
    const file = Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("IHDR", buildTestPng().subarray(16, 29)),
      pngChunk("tEXt", Buffer.from("Comment\x00junk")),
      pngChunk("IDAT", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => sanitizePng(file)).toThrow(PngStructureError);
  });

  const rgba64Ihdr = (): Buffer => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(64, 0);
    ihdr.writeUInt32BE(64, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return ihdr;
  };

  const withForeignChunk = (ihdr: Buffer, idat: Buffer): Buffer =>
    Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("tEXt", Buffer.from("Comment\x00junk")),
      pngChunk("IDAT", idat),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);

  it("отклоняет IDAT, распаковывающийся больше заявленных размеров IHDR", (): void => {
    const bomb = withForeignChunk(rgba64Ihdr(), deflateSync(Buffer.alloc(32 * 1024 * 1024, 0)));

    expect(() => sanitizePng(bomb)).toThrow(PngStructureError);
    expect(() => sanitizePng(bomb)).toThrow(/IDAT decompressed size exceeds image bounds/);
  });

  it("отклоняет чистый IDAT-бомбовый файл без посторонних чанков", (): void => {
    const bomb = Buffer.concat([
      TEST_PNG_SIGNATURE,
      pngChunk("IHDR", rgba64Ihdr()),
      pngChunk("IDAT", deflateSync(Buffer.alloc(32 * 1024 * 1024, 0))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);

    expect(() => sanitizePng(bomb)).toThrow(PngStructureError);
    expect(() => sanitizePng(bomb)).toThrow(/IDAT decompressed size exceeds image bounds/);
  });

  it("пропускает IDAT, распаковывающийся ровно в заявленный размер", (): void => {
    const rawImageData = Buffer.alloc(64 * (1 + 64 * 4));
    const file = withForeignChunk(rgba64Ihdr(), deflateSync(rawImageData));

    expect(() => sanitizePng(file)).not.toThrow();
  });

  it("пересохраняет interlaced PNG в пределах лимита IHDR", (): void => {
    const ihdr = rgba64Ihdr();
    ihdr[12] = 1;
    const file = withForeignChunk(ihdr, deflateSync(Buffer.alloc(1 + 4)));

    const sanitized = sanitizePng(file);
    expect(() => validatePngStructure(sanitized)).not.toThrow();
  });

  it("уже чистый файл с одним IDAT сохраняется байт-в-байт", (): void => {
    const clean = buildTestPng({ variant: 3 });
    expect(sanitizePng(clean).equals(clean)).toBe(true);
  });

  const buildWithTrns = (colorType: number): Buffer => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(64, 0);
    ihdr.writeUInt32BE(64, 4);
    ihdr[8] = 8;
    ihdr[9] = colorType;
    const chunks = [pngChunk("IHDR", ihdr)];
    if (colorType === 3) chunks.push(pngChunk("PLTE", Buffer.alloc(9)));
    chunks.push(pngChunk("tRNS", Buffer.alloc(colorType === 2 ? 6 : 2, 1)));
    chunks.push(pngChunk("IDAT", deflateSync(Buffer.alloc(4))));
    chunks.push(pngChunk("IEND", Buffer.alloc(0)));
    return Buffer.concat([TEST_PNG_SIGNATURE, ...chunks]);
  };

  it("сохраняет tRNS для colorType 0/2/3", (): void => {
    for (const colorType of [0, 2, 3]) {
      const source = buildWithTrns(colorType);
      const sanitized = sanitizePng(source);

      expect(() => validatePngStructure(sanitized)).not.toThrow();
      expect(hasChunk(sanitized, "tRNS")).toBe(true);
      expect(sanitized.equals(source)).toBe(true);
    }
  });

  it("убирает tRNS для colorType 4/6", (): void => {
    for (const colorType of [4, 6]) {
      const source = buildWithTrns(colorType);
      const sanitized = sanitizePng(source);

      expect(() => validatePngStructure(sanitized)).not.toThrow();
      expect(hasChunk(sanitized, "tRNS")).toBe(false);
      expect(sanitized.equals(source)).toBe(false);
    }
  });

  it("структурно битый файл отклоняется", (): void => {
    expect(() => sanitizePng(Buffer.from("not a png at all"))).toThrow(PngStructureError);
  });
});

function hasChunk(file: Buffer, type: string): boolean {
  let offset = 8;
  while (offset < file.length) {
    const chunkLength = file.readUInt32BE(offset);
    const chunkType = file.toString("ascii", offset + 4, offset + 8);
    if (chunkType === type) return true;
    offset += 12 + chunkLength;
    if (chunkType === "IEND") break;
  }
  return false;
}

function idatPayload(file: Buffer): Buffer {
  let offset = 8;
  const chunks: Buffer[] = [];
  while (offset < file.length) {
    const chunkLength = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      chunks.push(file.subarray(offset + 8, offset + 8 + chunkLength));
    }
    offset += 12 + chunkLength;
    if (type === "IEND") break;
  }
  return Buffer.concat(chunks);
}
