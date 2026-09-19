import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Logger, NotFoundException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { isMissingFileError } from "./fs";

const logger = new Logger("FileStream");

export interface ByteRange {
  start: number;
  end: number;
}

export interface FileStreamOptions {
  contentType: string;
  contentDisposition: string;
  notFoundMessage: string;
  fileLabel: string;
  rangeHeader?: string | undefined;
}

export function parseByteRange(header: string, size: number): ByteRange | "unsatisfiable" | null {
  const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (rangeMatch) {
    const [, rawStart, rawEnd] = rangeMatch;
    const start = Number(rawStart);
    if (start >= size) return "unsatisfiable";

    if (rawEnd === "") return { start, end: size - 1 };

    const end = Number(rawEnd);
    if (end < start) return null;
    return { start, end: Math.min(end, size - 1) };
  }

  const suffixMatch = /^bytes=-(\d+)$/.exec(header.trim());
  if (suffixMatch) {
    const [, rawLength] = suffixMatch;
    const length = Number(rawLength);
    if (length === 0) return "unsatisfiable";
    const start = Math.max(0, size - length);
    return { start, end: size - 1 };
  }

  return null;
}

export async function streamFileToReply(
  reply: FastifyReply,
  filePath: string,
  options: FileStreamOptions,
): Promise<void> {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new NotFoundException(options.notFoundMessage);
    }
    throw error;
  }

  let closed = false;
  const closeHandle = (): void => {
    if (closed) return;
    closed = true;
    void handle
      .close()
      .catch((closeError: unknown) =>
        logger.error(
          { err: closeError, file: options.fileLabel },
          "Не удалось закрыть файл лаунчера",
        ),
      );
  };

  try {
    const { size } = await handle.stat();
    const range =
      options.rangeHeader === undefined ? null : parseByteRange(options.rangeHeader, size);

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", options.contentType);
    reply.header("Content-Disposition", options.contentDisposition);

    if (range === "unsatisfiable") {
      closeHandle();
      reply.code(416).header("Content-Range", `bytes */${size}`).send();
      return;
    }

    reply.raw.once("close", closeHandle);
    if (range) {
      reply.code(206);
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      reply.header("Content-Length", String(range.end - range.start + 1));
      reply.send(
        toNodeStream(
          Bun.file(handle.fd)
            .slice(range.start, range.end + 1)
            .stream(),
          options.fileLabel,
        ),
      );
      return;
    }

    reply.header("Content-Length", String(size));
    reply.send(toNodeStream(Bun.file(handle.fd).stream(), options.fileLabel));
  } catch (error) {
    closeHandle();
    throw error;
  }
}

function toNodeStream(stream: ReadableStream, fileLabel: string): Readable {
  const nodeStream = Readable.fromWeb(stream as unknown as NodeWebReadableStream);
  nodeStream.on("error", (error: Error) => {
    logger.error({ err: error, file: fileLabel }, "Ошибка отдачи файла лаунчера");
  });
  return nodeStream;
}
