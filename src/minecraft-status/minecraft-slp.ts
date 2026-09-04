import { Socket } from "node:net";

export interface MinecraftStatus {
  online: number;
  max: number;
  version: string;
}

export type StatusResult = { ok: true; status: MinecraftStatus } | { ok: false; error: string };

interface MinecraftStatusRaw {
  version?: { name?: string; protocol?: number };
  players?: { max?: number; online?: number };
  description?: unknown;
  favicon?: string;
}

const CONNECT_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const DEFAULT_MINECRAFT_PORT = 25565;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_VARINT_BYTES = 5;
const MAX_ACCUMULATED_BYTES = MAX_RESPONSE_BYTES + MAX_VARINT_BYTES;

export interface MinecraftTarget {
  host: string;
  port: number;
}

export function parseMinecraftTarget(value: string): MinecraftTarget | null {
  if (value.length === 0) return null;

  const bracketed = /^\[(.+)\](?::(\d+))?$/.exec(value);
  if (bracketed) {
    const port = parsePort(bracketed[2]);
    return port === null ? null : { host: bracketed[1]!, port };
  }

  const firstColon = value.indexOf(":");
  const lastColon = value.lastIndexOf(":");
  if (firstColon === -1) {
    return { host: value, port: DEFAULT_MINECRAFT_PORT };
  }

  if (firstColon === lastColon) {
    const host = value.slice(0, lastColon);
    const port = parsePort(value.slice(lastColon + 1));
    if (port === null || host.length === 0) return null;

    return { host, port };
  }

  return { host: value, port: DEFAULT_MINECRAFT_PORT };
}

function parsePort(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_MINECRAFT_PORT;
  if (raw.length === 0) return null;
  if (!/^\d+$/.test(raw)) return null;

  const port = Number(raw);
  if (port < 1 || port > 65535) return null;
  return port;
}

export function writeVarInt(value: number): Uint8Array {
  let unsigned = value >>> 0;
  const bytes: number[] = [];
  while (true) {
    if ((unsigned & ~0x7f) === 0) {
      bytes.push(unsigned);
      return Uint8Array.from(bytes);
    }
    bytes.push((unsigned & 0x7f) | 0x80);
    unsigned >>>= 7;
  }
}

export function readVarInt(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < bytes.length) {
    const byte = bytes[cursor] as number;
    cursor++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, offset: cursor };
    }
    shift += 7;
    if (shift >= MAX_VARINT_BYTES * 7) throw new Error("VarInt too long");
  }

  throw new Error("VarInt truncated");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

export function buildHandshakePacket(host: string, port: number): Uint8Array {
  const hostBytes = new TextEncoder().encode(host);
  const body = concat(
    writeVarInt(-1),
    writeVarInt(hostBytes.length),
    hostBytes,
    Uint8Array.from([(port >> 8) & 0xff, port & 0xff]),
    writeVarInt(1),
  );
  return concat(writeVarInt(body.length), Uint8Array.from([0]), body);
}

export function buildStatusRequestPacket(): Uint8Array {
  return Uint8Array.from([0]);
}

export function extractStatusJson(jsonBytes: Uint8Array): MinecraftStatus {
  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as MinecraftStatusRaw;

  const online = parsed.players?.online;
  if (typeof online !== "number") {
    throw new Error("Status response missing players.online");
  }
  const max = parsed.players?.max;
  if (typeof max !== "number") {
    throw new Error("Status response missing players.max");
  }

  return { online, max, version: parsed.version?.name ?? "unknown" };
}

function parseStatusResponse(response: Uint8Array): MinecraftStatus {
  const packetLength = readVarInt(response, 0);
  assertLength(packetLength.value, response.length - packetLength.offset, "packet");

  const packet = response.subarray(packetLength.offset, packetLength.offset + packetLength.value);
  const packetId = readVarInt(packet, 0);
  if (packetId.value !== 0) throw new Error(`Unexpected status packet id: ${packetId.value}`);

  const stringLength = readVarInt(packet, packetId.offset);
  assertLength(stringLength.value, packet.length - stringLength.offset, "json string");

  const jsonBytes = packet.subarray(stringLength.offset, stringLength.offset + stringLength.value);
  return extractStatusJson(jsonBytes);
}

function assertLength(declared: number, available: number, label: string): void {
  if (declared < 0) throw new Error(`Negative ${label} length: ${declared}`);
  if (declared > available) {
    throw new Error(`Declared ${label} length ${declared} exceeds received ${available}`);
  }
}

function readResponseHeader(chunks: Uint8Array[], received: number): number | null | undefined {
  try {
    const header = readVarInt(concat(...chunks), 0);
    if (header.value < 0 || header.value > MAX_RESPONSE_BYTES) return null;
    return header.offset + header.value;
  } catch {
    return received < MAX_VARINT_BYTES ? undefined : null;
  }
}

export async function status(host: string, port: number): Promise<StatusResult> {
  const socket = new Socket();
  let settled = false;

  const finish = (result: StatusResult): StatusResult => {
    if (!settled) {
      settled = true;
      socket.destroy();
    }
    return result;
  };

  return new Promise<StatusResult>((resolve) => {
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.setTimeout(RESPONSE_TIMEOUT_MS);
      socket.write(buildHandshakePacket(host, port));
      socket.write(buildStatusRequestPacket());
    });

    socket.once("timeout", () => {
      resolve(finish({ ok: false, error: "Таймаут соединения с игровым сервером" }));
    });

    socket.once("error", (error: Error) => {
      resolve(finish({ ok: false, error: error.message }));
    });

    socket.once("close", () => {
      resolve(finish({ ok: false, error: "Соединение закрыто до получения статуса" }));
    });

    const chunks: Uint8Array[] = [];
    let received = 0;
    let expectedTotal: number | undefined;

    socket.on("data", (chunk: Buffer) => {
      try {
        if (received + chunk.length > MAX_ACCUMULATED_BYTES) {
          resolve(
            finish({ ok: false, error: "Ответ игрового сервера превышает допустимый размер" }),
          );
          return;
        }

        chunks.push(new Uint8Array(chunk));
        received += chunk.length;

        if (expectedTotal === undefined) {
          const header = readResponseHeader(chunks, received);
          if (header === undefined) return;
          if (header === null) {
            resolve(finish({ ok: false, error: "Некорректная длина ответа игрового сервера" }));
            return;
          }
          expectedTotal = header;
        }

        if (received < expectedTotal) return;

        resolve(finish({ ok: true, status: parseStatusResponse(concat(...chunks)) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve(finish({ ok: false, error: `Некорректный ответ игрового сервера: ${message}` }));
      }
    });

    socket.connect(port, host);
  });
}
