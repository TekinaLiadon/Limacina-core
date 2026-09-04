process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { readVarInt, status, writeVarInt } from "../minecraft-slp";
import { MinecraftStatusService } from "../minecraft-status.service";
import { CacheMapStore } from "../../memory/cache-map.store";
import { MemoryDb } from "../../memory/memory-db";
import type { AppConfigType } from "../../config/global-config";

type SocketWriter = (write: (chunk: Uint8Array) => boolean, end: () => void) => void;

interface HostileServer {
  server: Server;
  port: number;
  connectionCount: () => number;
}

function startHostileServer(writer: SocketWriter): Promise<HostileServer> {
  let connections = 0;
  return new Promise((resolveStart) => {
    const server = createServer((socket) => {
      connections++;
      let responded = false;
      socket.on("data", () => {
        if (responded) return;
        responded = true;
        writer(
          (chunk) => socket.write(chunk),
          () => socket.end(),
        );
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolveStart({ server, port, connectionCount: () => connections });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolveStop) => {
    server.close(() => resolveStop());
  });
}

function buildStatusResponse(payload: object): Uint8Array {
  const json = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(json);
  const idBytes = Uint8Array.from([0]);
  const lengthBytes = writeVarInt(jsonBytes.length);

  const body = new Uint8Array(idBytes.length + lengthBytes.length + jsonBytes.length);
  body.set(idBytes, 0);
  body.set(lengthBytes, idBytes.length);
  body.set(jsonBytes, idBytes.length + lengthBytes.length);

  const header = writeVarInt(body.length);
  const packet = new Uint8Array(header.length + body.length);
  packet.set(header, 0);
  packet.set(body, header.length);
  return packet;
}

function buildConfig(host: string): AppConfigType {
  return { MINECRAFT_HOST: host } as unknown as AppConfigType;
}

describe("readVarInt — границы формата", (): void => {
  it("принимает максимальный 5-байтовый VarInt", () => {
    expect(readVarInt(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x0f]), 0).value).toBe(-1);
  });

  it("отклоняет 6-байтовый VarInt вместо порчи значения", () => {
    expect(() => readVarInt(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0)).toThrow(
      "VarInt too long",
    );
  });

  it("отклоняет усечённый VarInt", () => {
    expect(() => readVarInt(Uint8Array.from([0x80]), 0)).toThrow("VarInt truncated");
  });
});

describe("status — недоверенный игровой сервер", (): void => {
  let running: Server | undefined;

  afterEach(async () => {
    if (running) {
      await stopServer(running);
      running = undefined;
    }
  });

  it("отклоняет заявленную длину больше лимита вместо буферизации потока", async () => {
    const hostile = await startHostileServer((write) => {
      write(writeVarInt(0x7fffffff));
      for (let sent = 0; sent < 16; sent++) {
        write(new Uint8Array(64 * 1024));
      }
    });
    running = hostile.server;

    const result = await status("127.0.0.1", hostile.port);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Некорректная длина");
  });

  it("обрывает поток, превышающий лимит размера ответа", async () => {
    const hostile = await startHostileServer((write) => {
      write(writeVarInt(256 * 1024));
      for (let sent = 0; sent < 300; sent++) {
        write(new Uint8Array(1024));
      }
    });
    running = hostile.server;

    const started = Date.now();
    const result = await status("127.0.0.1", hostile.port);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("превышает допустимый размер");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("отклоняет пакет, длина JSON которого больше принятого пакета", async () => {
    const hostile = await startHostileServer((write, end) => {
      const body = new Uint8Array([0, 0x7f]);
      const header = writeVarInt(body.length);
      const packet = new Uint8Array(header.length + body.length);
      packet.set(header, 0);
      packet.set(body, header.length);
      write(packet);
      end();
    });
    running = hostile.server;

    const result = await status("127.0.0.1", hostile.port);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("exceeds received");
  });

  it("собирает ответ, разбитый на отдельные байты", async () => {
    const packet = buildStatusResponse({
      version: { name: "1.21.4" },
      players: { online: 3, max: 20 },
    });
    const hostile = await startHostileServer((write, end) => {
      for (const byte of packet) {
        write(Uint8Array.from([byte]));
      }
      end();
    });
    running = hostile.server;

    const result = await status("127.0.0.1", hostile.port);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.online).toBe(3);
  });
});

describe("MinecraftStatusService — дедупликация пинга", (): void => {
  it("параллельные запросы при промахе кеша дают один пинг", async () => {
    const packet = buildStatusResponse({
      version: { name: "1.21.4" },
      players: { online: 5, max: 20 },
    });
    const hostile = await startHostileServer((write, end) => {
      write(packet);
      end();
    });

    const service = new MinecraftStatusService(
      buildConfig(`127.0.0.1:${hostile.port}`),
      new CacheMapStore(new MemoryDb()),
    );

    const results = await Promise.all(Array.from({ length: 10 }, () => service.getOnline()));

    expect(results.every((item) => item.online === 5)).toBe(true);
    expect(hostile.connectionCount()).toBe(1);

    await stopServer(hostile.server);
  });
});
