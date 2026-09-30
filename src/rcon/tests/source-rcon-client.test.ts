import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Socket } from "node:net";
import { DEFAULT_RCON_PORT } from "../../config/global-config";
import {
  RCON_AUTH,
  RCON_AUTH_RESPONSE,
  RCON_EXECCOMMAND,
  RCON_RESPONSE_VALUE,
  SourceRconClient,
  type RconTarget,
} from "../source-rcon-client";
import {
  rconAuthHandler,
  rconExecHandler,
  rconRespond,
  rconVanillaHandler,
  startFakeRconServer,
  type FakeRconServer,
} from "./fake-rcon-server";

const PASSWORD = "test-password";
const WRONG_PASSWORD = "wrong-password";
const FAST_TIMEOUTS = { connectTimeoutMs: 250, readTimeoutMs: 250 };

function target(port: number, password = PASSWORD): RconTarget {
  return { host: "127.0.0.1", port, password };
}

describe("SourceRconClient — авторизация", () => {
  let running: FakeRconServer | undefined;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = undefined;
    }
  });

  it("успешная авторизация делает RCON доступным", async () => {
    running = await startFakeRconServer(rconAuthHandler());
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    expect(await client.checkAvailable()).toBe(true);
  });

  it("неправильный пароль — RCON недоступен", async () => {
    running = await startFakeRconServer(rconAuthHandler({ authOk: false }));
    const client = new SourceRconClient(target(running.port, WRONG_PASSWORD), FAST_TIMEOUTS);

    expect(await client.checkAvailable()).toBe(false);
  });

  it("протокольная неудача аутентификации (id=-1, пустое тело) — различимая ошибка (TASK-411.4)", async () => {
    running = await startFakeRconServer((packet, socket) => {
      if (packet.type !== RCON_AUTH) return;
      rconRespond(socket, RCON_AUTH_RESPONSE, "", -1);
    });
    const client = new SourceRconClient(target(running.port, WRONG_PASSWORD), FAST_TIMEOUTS);

    expect(await client.checkAvailable()).toBe(false);

    const result = await client.executeCommand("say hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Неверный пароль RCON");
  });

  it("соединение принято, но закрыто до ответа авторизации", async () => {
    running = await startFakeRconServer((_packet, socket) => {
      socket.destroy();
    });
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    expect(await client.checkAvailable()).toBe(false);
  });

  it("пропускает дополнительный response-value перед auth response", async () => {
    running = await startFakeRconServer((packet, socket) => {
      if (packet.type !== RCON_AUTH) return;
      rconRespond(socket, RCON_RESPONSE_VALUE, "", packet.id);
      rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
    });
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    expect(await client.checkAvailable()).toBe(true);
  });
});

describe("SourceRconClient — выполнение команд", () => {
  let running: FakeRconServer | undefined;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = undefined;
    }
  });

  it("возвращает вывод команды", async () => {
    running = await startFakeRconServer(rconExecHandler("Сервер: Hello world"));
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    const result = await client.executeCommand("say Hello world");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe("Сервер: Hello world");
  });

  it("ошибка Minecraft возвращается в output, а не как сбой клиента", async () => {
    running = await startFakeRconServer(rconExecHandler("Unknown or incomplete command"));
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    const result = await client.executeCommand("notacommand");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain("Unknown or incomplete command");
  });

  it("vanilla-сервер не отвечает на маркер type 0 и рвёт соединение — вывод команды сохраняется (TASK-437)", async () => {
    const output = "There are 0 of a max of 20 players online";
    running = await startFakeRconServer(rconVanillaHandler(output));
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    const result = await client.executeCommand("list");

    if (!result.ok) expect(result.error).not.toBe("Соединение с RCON закрыто до получения ответа");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe(output);
  });

  it("собирает мультипакетный вывод", async () => {
    const part1 = "a".repeat(1200);
    const part2 = "b".repeat(500);
    running = await startFakeRconServer((packet, socket) => {
      if (packet.type === RCON_AUTH) {
        rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
        return;
      }
      if (packet.type === RCON_EXECCOMMAND) {
        rconRespond(socket, RCON_RESPONSE_VALUE, part1, packet.id);
        rconRespond(socket, RCON_RESPONSE_VALUE, part2, packet.id);
        return;
      }
      if (packet.type === RCON_RESPONSE_VALUE) {
        rconRespond(socket, RCON_RESPONSE_VALUE, packet.body, packet.id);
      }
    });
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    const result = await client.executeCommand("long-command");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.length).toBe(part1.length + part2.length);
  });

  it("неверный пароль при execute — различимая ошибка", async () => {
    running = await startFakeRconServer(rconAuthHandler({ authOk: false }));
    const client = new SourceRconClient(target(running.port, WRONG_PASSWORD), FAST_TIMEOUTS);

    const result = await client.executeCommand("say hi");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Неверный пароль RCON");
  });

  it("сервер закрыл соединение посреди вывода", async () => {
    running = await startFakeRconServer((packet, socket) => {
      if (packet.type === RCON_AUTH) {
        rconRespond(socket, RCON_AUTH_RESPONSE, "", packet.id);
        return;
      }
      if (packet.type === RCON_EXECCOMMAND) {
        rconRespond(socket, RCON_RESPONSE_VALUE, "partial", packet.id);
        socket.destroy();
      }
    });
    const client = new SourceRconClient(target(running.port), FAST_TIMEOUTS);

    const result = await client.executeCommand("say hi");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("закрыто");
  });

  it("подключение к закрытому порту — сбой", async () => {
    const client = new SourceRconClient(
      { host: "127.0.0.1", port: 1, password: PASSWORD },
      FAST_TIMEOUTS,
    );

    expect(await client.checkAvailable()).toBe(false);

    const result = await client.executeCommand("say hi");
    expect(result.ok).toBe(false);
  });

  it("таймаут чтения при зависшем сервере", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const client = new SourceRconClient(
      { host: "127.0.0.1", port, password: PASSWORD },
      FAST_TIMEOUTS,
    );

    const started = Date.now();
    const result = await client.executeCommand("say hi");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Таймаут");
    expect(Date.now() - started).toBeLessThan(3_000);

    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("DEFAULT_RCON_PORT равен 25575", () => {
    expect(DEFAULT_RCON_PORT).toBe(25575);
  });
});
