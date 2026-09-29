import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as nodeFs from "node:fs";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ConfigUpdateService } from "../config-update.service";

const CONFIG_FILE = "config.toml";
const CONFIG_BACKUP = "config.toml.bak";

const validDto = {
  projectName: "AtomicProject",
  mcVersion: "1.21.1",
  modLoader: "neoforge",
  loaderVersion: "21.1.0",
  jvmArgs: ["-XX:+UseG1GC"],
  minMemory: "-Xms512M",
  maxMemory: "-Xmx2048M",
  online: true,
};

describe("ConfigUpdateService — атомарная запись config.toml (TASK-21)", (): void => {
  let configExisted = false;

  beforeAll(() => {
    configExisted = existsSync(CONFIG_FILE);
    if (configExisted) renameSync(CONFIG_FILE, CONFIG_BACKUP);
  });

  afterAll(() => {
    if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE, { force: true });
    if (existsSync(`${CONFIG_FILE}.tmp`)) rmSync(`${CONFIG_FILE}.tmp`, { force: true });
    if (configExisted && existsSync(CONFIG_BACKUP)) renameSync(CONFIG_BACKUP, CONFIG_FILE);
  });

  it("пишет конфиг через temp+rename: tmp-файла после записи нет", (): void => {
    const service = new ConfigUpdateService();

    const result = service.update(validDto);

    expect(result.projectName).toBe("AtomicProject");
    expect(readFileSync(CONFIG_FILE, "utf-8")).toContain("AtomicProject");
    expect(existsSync(`${CONFIG_FILE}.tmp`)).toBe(false);
  });

  it("при сбое переименования старый конфиг остаётся нетронутым, tmp подчищается", (): void => {
    const service = new ConfigUpdateService();
    writeFileSync(CONFIG_FILE, 'projectName = "OldProject"\n');

    const renameSpy = spyOn(nodeFs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(() => service.update(validDto)).toThrow("rename failed");
    renameSpy.mockRestore();

    expect(readFileSync(CONFIG_FILE, "utf-8")).toContain("OldProject");
    expect(existsSync(`${CONFIG_FILE}.tmp`)).toBe(false);
  });
});
