import { Socket } from "node:net";
import { concatBytes } from "../utils/bytes";
import {
  decodeRconPacket,
  encodeRconPacket,
  packetWireLength,
  type RconPacket,
} from "./source-rcon";

export const RCON_AUTH = 3;
export const RCON_AUTH_RESPONSE = 2;
export const RCON_EXECCOMMAND = 2;
export const RCON_RESPONSE_VALUE = 0;

const CONNECT_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 500;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_PACKET_SIZE = 4096;

export interface RconTarget {
  host: string;
  port: number;
  password: string;
}

export interface RconTimeouts {
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export type RconResult = { ok: true; output: string } | { ok: false; error: string };

export class RconTransportError extends Error {}

export class SourceRconClient {
  private readonly connectTimeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly target: RconTarget,
    timeouts: RconTimeouts = {},
  ) {
    this.connectTimeoutMs = timeouts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.readTimeoutMs = timeouts.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.idleTimeoutMs = timeouts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  }

  async checkAvailable(): Promise<boolean> {
    try {
      await this.runSession(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  async executeCommand(command: string): Promise<RconResult> {
    try {
      const output = await this.runSession((connection) => connection.execute(command));
      return { ok: true, output };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  private async runSession(
    action: (connection: RconConnection) => string | void | Promise<string | void>,
  ): Promise<string> {
    const socket = await connectRcon(this.target, this.connectTimeoutMs);
    const connection = new RconConnection(socket, this.readTimeoutMs, this.idleTimeoutMs);
    try {
      await connection.authenticate(this.target.password);
      return ((await action(connection)) as string | undefined) ?? "";
    } finally {
      connection.close();
    }
  }
}

async function connectRcon(target: RconTarget, connectTimeoutMs: number): Promise<Socket> {
  const socket = new Socket();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(RCON_CONNECT_TIMEOUT_MESSAGE));
    }, connectTimeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(new Error("RCON-сервер недоступен: соединение отклонено"));
    });
    socket.connect(target.port, target.host);
  });
  socket.setNoDelay(true);
  return socket;
}

const RCON_CONNECT_TIMEOUT_MESSAGE = "Таймаут подключения к RCON-серверу";
const RCON_READ_TIMEOUT_MESSAGE = "Таймаут чтения ответа RCON";
const RCON_CLOSED_MESSAGE = "Соединение с RCON закрыто до получения ответа";
const RCON_TOO_LARGE_MESSAGE = "Ответ RCON превышает допустимый размер";
const RCON_AUTH_MESSAGE = "Неверный пароль RCON";

class RconConnection {
  private readonly chunks: Uint8Array[] = [];
  private received = 0;
  private settled = false;
  private waiter: ((result: RconPacket | Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly socket: Socket,
    private readonly readTimeoutMs: number,
    private readonly idleTimeoutMs: number,
  ) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", () => this.fail(new RconTransportError(RCON_CLOSED_MESSAGE)));
    socket.on("close", () => this.fail(new RconTransportError(RCON_CLOSED_MESSAGE)));
  }

  async authenticate(password: string): Promise<void> {
    this.write({ id: 1, type: RCON_AUTH, body: password });
    let response = await this.readPacket();
    while (response.type === RCON_RESPONSE_VALUE) {
      response = await this.readPacket();
    }
    if (response.type !== RCON_AUTH_RESPONSE || response.id !== 1) {
      throw new Error(RCON_AUTH_MESSAGE);
    }
    this.drainTrailingResponseValues();
  }

  async execute(command: string): Promise<string> {
    await this.writeDrained({ id: 1, type: RCON_EXECCOMMAND, body: command });

    const parts: string[] = [];
    let answered = false;
    while (true) {
      try {
        const packet = await this.readPacket(answered ? this.idleTimeoutMs : this.readTimeoutMs);
        answered = true;
        if (packet.body.length > MAX_PACKET_SIZE) {
          throw new Error(RCON_TOO_LARGE_MESSAGE);
        }
        parts.push(packet.body);
      } catch (error) {
        if (!answered || !(error instanceof RconTransportError)) throw error;
        break;
      }
    }
    return parts.join("");
  }

  private drainTrailingResponseValues(): void {
    while (true) {
      const buffered = this.takeBufferedPacket();
      if (!buffered || buffered.type !== RCON_RESPONSE_VALUE) break;
    }
  }

  close(): void {
    this.clearTimer();
    this.socket.destroy();
  }

  private write(packet: RconPacket): void {
    this.socket.write(encodeRconPacket(packet));
  }

  private writeDrained(packet: RconPacket): Promise<void> {
    return new Promise<void>((resolve) => {
      this.socket.write(encodeRconPacket(packet), () => resolve());
    });
  }

  private async readPacket(timeoutMs: number = this.readTimeoutMs): Promise<RconPacket> {
    const buffered = this.takeBufferedPacket();
    if (buffered) return buffered;

    return new Promise<RconPacket>((resolve, reject) => {
      this.timer = setTimeout(() => {
        this.fail(new RconTransportError(RCON_READ_TIMEOUT_MESSAGE));
      }, timeoutMs);
      this.waiter = (result) => {
        this.clearTimer();
        this.waiter = undefined;
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
    });
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private takeBufferedPacket(): RconPacket | undefined {
    const { packet, rest } = readCompletePacket(this.chunks);
    if (!packet) return undefined;
    this.chunks.length = 0;
    this.received = rest.reduce((sum, chunk) => sum + chunk.length, 0);
    for (const chunk of rest) this.chunks.push(chunk);
    return packet;
  }

  private onData(chunk: Buffer): void {
    if (this.received + chunk.length > MAX_RESPONSE_BYTES) {
      this.fail(new Error(RCON_TOO_LARGE_MESSAGE));
      return;
    }

    this.chunks.push(new Uint8Array(chunk));
    this.received += chunk.length;

    const packet = this.takeBufferedPacket();
    if (packet) this.deliver(packet);
  }

  private deliver(packet: RconPacket): void {
    if (this.waiter) this.waiter(packet);
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    if (this.waiter) this.waiter(error);
  }
}

function readCompletePacket(chunks: Uint8Array[]): {
  packet: RconPacket | null;
  rest: Uint8Array[];
} {
  const merged = concatBytes(chunks);
  const packet = decodeRconPacket(merged);
  if (!packet) return { packet: null, rest: chunks };

  const consumed = packetWireLength(merged);
  if (consumed === undefined) return { packet: null, rest: chunks };

  return {
    packet,
    rest: merged.length > consumed ? [merged.subarray(consumed)] : [],
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
