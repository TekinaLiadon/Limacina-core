import { describe, expect, it } from "bun:test";
import {
  buildHandshakePacket,
  buildStatusRequestPacket,
  parseMinecraftTarget,
} from "../minecraft-slp";

describe("buildHandshakePacket", () => {
  it("кодирует длину, id, протокол -1, хост, порт и next-state 1", () => {
    const packet = buildHandshakePacket("mc.example.com", 25565);
    const bytes = [...packet];

    expect(bytes.length).toBe(25);
    expect(bytes[0]).toBe(0x17); // body length varint (23)
    expect(bytes[1]).toBe(0); // packet id

    expect(bytes[2]).toBe(0xff); // protocol version varint (-1)
    expect(bytes[3]).toBe(0xff);
    expect(bytes[4]).toBe(0xff);
    expect(bytes[5]).toBe(0xff);
    expect(bytes[6]).toBe(0x0f);

    expect(bytes[7]).toBe(14); // length of "mc.example.com"
    expect(new TextDecoder().decode(packet.subarray(8, 22))).toBe("mc.example.com");

    expect(bytes[22]).toBe(0x63); // 25565 >> 8
    expect(bytes[23]).toBe(0xdd); // 25565 & 0xff

    expect(bytes[24]).toBe(1); // next state: status
  });

  it("кодирует короткий хост", () => {
    const packet = buildHandshakePacket("mc", 1234);
    const bytes = [...packet];

    expect(bytes[0]).toBe(0x0b); // body length varint (11)
    expect(bytes[7]).toBe(2);
    expect(bytes[8]).toBe(0x6d); // "m"
    expect(bytes[9]).toBe(0x63); // "c"

    expect(bytes[10]).toBe(0x04); // 1234 >> 8
    expect(bytes[11]).toBe(0xd2); // 1234 & 0xff
    expect(bytes[12]).toBe(1);
  });
});

describe("buildStatusRequestPacket", () => {
  it("это одиночный байт 0x00", () => {
    const packet = buildStatusRequestPacket();

    expect(packet.length).toBe(1);
    expect(packet[0]).toBe(0);
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
