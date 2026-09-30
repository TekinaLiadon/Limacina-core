import { createServer, type Server, type Socket } from "node:net";
import {
  decodeRconPacket,
  encodeRconPacket,
  packetWireLength,
  type RconPacket,
} from "../source-rcon";
import {
  RCON_AUTH,
  RCON_AUTH_RESPONSE,
  RCON_EXECCOMMAND,
  RCON_RESPONSE_VALUE,
} from "../source-rcon-client";

export type RconHandler = (packet: RconPacket, socket: Socket) => void;

export interface FakeRconServer {
  server: Server;
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}

export function concatRconBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

export function rconRespond(socket: Socket, type: number, body: string, id: number): void {
  socket.write(encodeRconPacket({ id, type, body }));
}

export interface RconAuthHandlerOptions {
  authOk?: boolean;
}

export function rconAuthHandler(options: RconAuthHandlerOptions = {}): RconHandler {
  const authOk = options.authOk ?? true;
  return (packet, socket) => {
    if (packet.type === RCON_AUTH)
      rconRespond(socket, RCON_AUTH_RESPONSE, "", authOk ? packet.id : -1);
    if (packet.type === RCON_RESPONSE_VALUE)
      rconRespond(socket, RCON_RESPONSE_VALUE, packet.body, packet.id);
  };
}

export function rconExecHandler(output: string): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND) {
      rconRespond(socket, RCON_RESPONSE_VALUE, output, packet.id);
      return;
    }
    if (packet.type === RCON_RESPONSE_VALUE)
      rconRespond(socket, RCON_RESPONSE_VALUE, packet.body, packet.id);
  };
}

export function rconVanillaHandler(output: string): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND) {
      rconRespond(socket, RCON_RESPONSE_VALUE, output, packet.id);
      return;
    }
    socket.destroy();
  };
}

export function rconCloseAfterResponseHandler(output: string): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND && packet.id === 1) {
      rconRespond(socket, RCON_RESPONSE_VALUE, output, packet.id);
      socket.end();
    }
  };
}

export function rconCloseBeforeResponseHandler(): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      socket.end();
    }
  };
}

export function rconIgnoreMarkerHandler(output: string): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND && packet.id === 1) {
      rconRespond(socket, RCON_RESPONSE_VALUE, output, packet.id);
    }
  };
}

export function rconTrailingAuthValueHandler(output: string): RconHandler {
  return (packet, socket) => {
    if (packet.type === RCON_AUTH) {
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
      rconRespond(socket, RCON_RESPONSE_VALUE, "", packet.id);
      return;
    }
    if (packet.type === RCON_EXECCOMMAND) {
      rconRespond(socket, RCON_RESPONSE_VALUE, packet.id === 1 ? output : "unknown", packet.id);
    }
  };
}

export interface FakeRconServerOptions {
  onCoalescedChunk?: () => void;
}

export function startFakeRconServer(
  handler: RconHandler,
  options: FakeRconServerOptions = {},
): Promise<FakeRconServer> {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    connections++;
    const chunks: Uint8Array[] = [];

    socket.on("data", (chunk: Buffer) => {
      chunks.push(new Uint8Array(chunk));

      while (true) {
        const merged = concatRconBytes(chunks);
        const packet = decodeRconPacket(merged);
        if (!packet) return;

        chunks.length = 0;
        const consumed = packetWireLength(merged);
        if (consumed === undefined) return;
        const rest = merged.subarray(consumed);
        if (rest.length > 0) {
          chunks.push(rest);
          options.onCoalescedChunk?.();
        }

        handler(packet, socket);
      }
    });

    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise<FakeRconServer>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        server,
        port,
        connections: () => connections,
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
