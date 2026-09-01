import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LogsService } from "../logs.service";

const TEST_DATE = "2099-12-31";
const TEST_LOG_FILE = join(process.cwd(), "logs", `${TEST_DATE}.log`);

function requestLine(id: string, url: string, remoteAddress: string, statusCode: number): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    name: "Limacina",
    req: { id, method: "GET", url, remoteAddress, remotePort: 12345 },
    res: { statusCode, headers: {} },
    msg: "request completed",
    responseTime: 1,
  });
}

const loginLine = requestLine("req-1", "/v1/common/auth/login", "127.0.0.1", 200);
const registrationLine = requestLine("req-2", "/v1/common/auth/registration", "192.168.1.10", 400);
const panelLogsLine = requestLine("req-3", "/v1/panel/logs?date=2099-12-31", "10.0.0.5", 500);

const logFileContent = [
  JSON.stringify({ level: 30, time: 1, name: "Limacina", context: "App", msg: "Идет запуск..." }),
  loginLine,
  registrationLine,
  JSON.stringify({ level: 40, time: 2, name: "Limacina", context: "Fetch", msg: "Предупреждение" }),
  panelLogsLine,
  JSON.stringify({
    level: 30,
    time: 3,
    name: "Limacina",
    req: { id: "req-4", method: "GET", url: "/health", remoteAddress: "127.0.0.1" },
    res: { headers: {} },
    msg: "request without status code",
  }),
  "not-a-json-line",
].join("\n");

describe("LogsService — фильтрация логов запросов", (): void => {
  beforeAll(() => {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    writeFileSync(TEST_LOG_FILE, logFileContent);
  });

  afterAll(() => {
    rmSync(TEST_LOG_FILE, { force: true });
  });

  it("не отдаёт строки без кода статуса", () => {
    const service = new LogsService();
    const { lines, total } = service.getLines(TEST_DATE, 0, 100);

    expect(total).toBe(3);
    expect(lines).toEqual([loginLine, registrationLine, panelLogsLine]);
    for (const line of lines) {
      expect(JSON.parse(line).res.statusCode).toBeDefined();
    }
  });

  it("фильтрует по статус-коду", () => {
    const service = new LogsService();
    const { lines, total } = service.getLines(TEST_DATE, 0, 100, { statusCode: 400 });

    expect(total).toBe(1);
    expect(lines).toEqual([registrationLine]);
  });

  it("фильтрует по url как по подстроке без учёта регистра", () => {
    const byPath = new LogsService().getLines(TEST_DATE, 0, 100, { url: "/common/auth" });
    expect(byPath.total).toBe(2);
    expect(byPath.lines).toEqual([loginLine, registrationLine]);

    const caseInsensitive = new LogsService().getLines(TEST_DATE, 0, 100, { url: "REGISTRATION" });
    expect(caseInsensitive.total).toBe(1);
    expect(caseInsensitive.lines).toEqual([registrationLine]);
  });

  it("фильтрует по ip как по подстроке", () => {
    const exact = new LogsService().getLines(TEST_DATE, 0, 100, { ip: "127.0.0.1" });
    expect(exact.total).toBe(1);
    expect(exact.lines).toEqual([loginLine]);

    const subnet = new LogsService().getLines(TEST_DATE, 0, 100, { ip: "192.168." });
    expect(subnet.total).toBe(1);
    expect(subnet.lines).toEqual([registrationLine]);
  });

  it("комбинирует фильтры", () => {
    const service = new LogsService();
    const { lines, total } = service.getLines(TEST_DATE, 0, 100, {
      statusCode: 200,
      ip: "127.0.0.1",
      url: "login",
    });

    expect(total).toBe(1);
    expect(lines).toEqual([loginLine]);
  });

  it("возвращает пустой результат, если ничего не совпало", () => {
    const service = new LogsService();
    const { lines, total } = service.getLines(TEST_DATE, 0, 100, { statusCode: 404 });

    expect(total).toBe(0);
    expect(lines).toEqual([]);
  });

  it("пагинует после фильтрации", () => {
    const service = new LogsService();
    const { lines, total } = service.getLines(TEST_DATE, 1, 1, { url: "/common/auth" });

    expect(total).toBe(2);
    expect(lines).toEqual([registrationLine]);
  });
});
