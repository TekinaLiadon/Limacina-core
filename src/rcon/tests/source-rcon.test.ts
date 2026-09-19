import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import {
  bodyByteLength,
  decodeRconPacket,
  encodeRconPacket,
  packetSize,
  packetWireLength,
  type RconPacket,
} from "../source-rcon";

describe("encodeRconPacket", () => {
  it("кодирует пакет с непустым телом", () => {
    const bytes = encodeRconPacket({ id: 1, type: 2, body: "say hello" });

    expect(bytes.length).toBe(4 + 8 + "say hello".length + 2);
    expect(decodeRconPacket(bytes)).toEqual({ id: 1, type: 2, body: "say hello" });
  });

  it("кодирует кириллическое тело по байтам, а не по символам", () => {
    const body = "Сервер: Hello world";
    const bytes = encodeRconPacket({ id: 1, type: 0, body });

    expect(bodyByteLength(body)).toBeGreaterThan(body.length);
    expect(bytes.length).toBe(4 + 8 + bodyByteLength(body) + 2);
    expect(packetSize(body)).toBe(bytes.length - 4);
    expect(decodeRconPacket(bytes)).toEqual({ id: 1, type: 0, body });
  });

  it("два пакета подряд с кириллицей разбираются по проволочной длине", () => {
    const first = encodeRconPacket({ id: 1, type: 0, body: "Сервер: привет" });
    const second = encodeRconPacket({ id: 2, type: 0, body: "ответ" });
    const merged = new Uint8Array(first.length + second.length);
    merged.set(first, 0);
    merged.set(second, first.length);

    expect(packetWireLength(merged)).toBe(first.length);
    expect(decodeRconPacket(merged)).toEqual({ id: 1, type: 0, body: "Сервер: привет" });

    const rest = merged.subarray(first.length);
    expect(packetWireLength(rest)).toBe(second.length);
    expect(decodeRconPacket(rest)).toEqual({ id: 2, type: 0, body: "ответ" });
  });

  it("кодирует пакет с пустым телом", () => {
    const bytes = encodeRconPacket({ id: 7, type: 0, body: "" });

    expect(bytes.length).toBe(4 + 8 + 0 + 2);
    expect(decodeRconPacket(bytes)).toEqual({ id: 7, type: 0, body: "" });
  });

  it("пишет little-endian длину, id и тип", () => {
    const bytes = encodeRconPacket({ id: 1, type: 2, body: "" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getInt32(0, true)).toBe(10);
    expect(view.getInt32(4, true)).toBe(1);
    expect(view.getInt32(8, true)).toBe(2);
  });
});

describe("decodeRconPacket", () => {
  it("читает пакет из префикса большего буфера", () => {
    const bytes = encodeRconPacket({ id: 3, type: 2, body: "list" });
    const merged = new Uint8Array(bytes.length + 5);
    merged.set(bytes, 0);
    merged.set(Uint8Array.from([1, 2, 3, 4, 5]), bytes.length);

    expect(decodeRconPacket(merged)).toEqual({ id: 3, type: 2, body: "list" });
  });

  it("null-терминатор обрезает тело", () => {
    const bytes = encodeRconPacket({ id: 1, type: 2, body: "kick" });
    bytes[12 + "kick".length] = 0;

    expect(decodeRconPacket(bytes)).toEqual({ id: 1, type: 2, body: "kick" });
  });

  it("отвергает пакет меньше заголовка", () => {
    expect(decodeRconPacket(new Uint8Array(13))).toBe(null);
    expect(decodeRconPacket(new Uint8Array(4 + 8 + 1))).toBe(null);
  });

  it("отвергает усечённый пакет", () => {
    const bytes = encodeRconPacket({ id: 1, type: 2, body: "op player" });
    const truncated = bytes.subarray(0, bytes.length - 3);

    expect(decodeRconPacket(truncated)).toBe(null);
  });

  it("отвергает длину меньше заголовка", () => {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setInt32(0, 7, true);

    expect(decodeRconPacket(bytes)).toBe(null);
  });

  it("сохраняет тело без null-терминатора", () => {
    const packet: RconPacket = { id: 2, type: 0, body: "raw-body" };
    const view = new Uint8Array(4 + 8 + packet.body.length);
    new DataView(view.buffer).setInt32(0, 8 + packet.body.length, true);
    new DataView(view.buffer).setInt32(4, packet.id, true);
    new DataView(view.buffer).setInt32(8, packet.type, true);
    view.set(new TextEncoder().encode(packet.body), 12);

    expect(decodeRconPacket(view)).toEqual(packet);
  });
});
