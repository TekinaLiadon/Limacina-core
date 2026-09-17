import { describe, expect, it } from "bun:test";
import {
  buildHandshakePacket,
  buildStatusRequestPacket,
  parseMinecraftTarget,
  readVarInt,
} from "../minecraft-slp";

describe("buildHandshakePacket", () => {
  it("кодирует длину, id, протокол -1, хост, порт и next-state 1", () => {
    const packet = buildHandshakePacket("mc.example.com", 25565);
    const bytes = [...packet];

    const packetLength = readVarInt(packet, 0);
    const packetId = readVarInt(packet, packetLength.offset);
    const protocol = readVarInt(packet, packetId.offset);
    const hostLength = readVarInt(packet, protocol.offset);
    const hostStart = hostLength.offset;
    const hostEnd = hostStart + hostLength.value;
    const portStart = hostEnd;
    const stateStart = portStart + 2;

    expect(bytes.length).toBe(25);
    expect(packetLength.value).toBe(24);
    expect(packetId.value).toBe(0);
    expect(protocol.value).toBe(-1);
    expect(hostLength.value).toBe(14);
    expect(new TextDecoder().decode(packet.subarray(hostStart, hostEnd))).toBe("mc.example.com");
    expect(bytes[portStart]).toBe(0x63);
    expect(bytes[portStart + 1]).toBe(0xdd);
    expect(bytes[stateStart]).toBe(1);
  });

  it("кодирует короткий хост", () => {
    const packet = buildHandshakePacket("mc", 1234);
    const bytes = [...packet];

    const packetLength = readVarInt(packet, 0);
    const hostLength = readVarInt(packet, packetLength.offset + 1 + 5);

    expect(packetLength.value).toBe(12);
    expect(hostLength.value).toBe(2);
    expect(
      new TextDecoder().decode(packet.subarray(hostLength.offset, hostLength.offset + 2)),
    ).toBe("mc");
    expect(bytes[packetLength.offset + packetLength.value - 3]).toBe(0x04);
    expect(bytes[packetLength.offset + packetLength.value - 2]).toBe(0xd2);
    expect(bytes[packetLength.offset + packetLength.value - 1]).toBe(1);
  });
});

describe("buildStatusRequestPacket", () => {
  it("это длина 1 и id 0", () => {
    const packet = buildStatusRequestPacket();
    const packetLength = readVarInt(packet, 0);
    const packetId = readVarInt(packet, packetLength.offset);

    expect(packetLength.value).toBe(1);
    expect(packetId.value).toBe(0);
    expect(packet.length).toBe(2);
  });
});

describe("parseMinecraftTarget", () => {
  it("хост без порта — дефолт 25565", () => {
    expect(parseMinecraftTarget("mc.example.com")).toEqual({
      host: "mc.example.com",
      port: 25565,
    });
  });

  it("хост с портом", () => {
    expect(parseMinecraftTarget("mc.example.com:25577")).toEqual({
      host: "mc.example.com",
      port: 25577,
    });
  });

  it("IPv4 без порта", () => {
    expect(parseMinecraftTarget("192.168.1.10")).toEqual({ host: "192.168.1.10", port: 25565 });
  });

  it("IPv4 с портом", () => {
    expect(parseMinecraftTarget("192.168.1.10:25577")).toEqual({
      host: "192.168.1.10",
      port: 25577,
    });
  });

  it("IPv6 в скобках с портом", () => {
    expect(parseMinecraftTarget("[::1]:25577")).toEqual({ host: "::1", port: 25577 });
  });

  it("IPv6 без порта и скобок", () => {
    expect(parseMinecraftTarget("::1")).toEqual({ host: "::1", port: 25565 });
  });

  it("невалидный порт — null", () => {
    expect(parseMinecraftTarget("mc.example.com:abc")).toBeNull();
  });

  it("порт вне диапазона — null", () => {
    expect(parseMinecraftTarget("mc.example.com:0")).toBeNull();
    expect(parseMinecraftTarget("mc.example.com:65536")).toBeNull();
  });

  it("пустой порт — null", () => {
    expect(parseMinecraftTarget("mc.example.com:")).toBeNull();
  });
});
