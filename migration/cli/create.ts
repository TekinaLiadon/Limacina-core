import path from "node:path";
import { randomName } from "../core/random-name.js";
import { log, fatal } from "../core/console.js";

export interface CreateOptions {
  name?: string;
  git?: boolean;
  listDir: string;
}

export async function createMigration(options: CreateOptions): Promise<string> {
  const name = options.name ?? randomName();
  const date = new Date();
  const pad = (value: number) => (value <= 9 ? `0${value}` : `${value}`);
  const MAX_TIME = 9999999999999;
  const invertedTime = (MAX_TIME - date.getTime()).toString().padStart(13, "0");
  const timestamp = [
    invertedTime,
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("_");

  const filename = `${timestamp}_${name}.js`;
  const filePath = path.join(options.listDir, filename);
  const stubPath = path.join(import.meta.dir, "..", "stub.js");

  const inputFile = Bun.file(stubPath);
  const outputFile = Bun.file(filePath);
  await Bun.write(outputFile, inputFile);

  if (options.git) {
    const add = Bun.spawn({
      cmd: ["git", "add", filePath],
      stdout: "pipe",
      stderr: "pipe",
    });
    await add.exited;
  }

  return filename;
}

const args = process.argv.slice(2);
const gitFlag = args.includes("--git");
const nameArg = args.find((a) => !a.startsWith("--"));
const listDir = path.join(import.meta.dir, "..", "list");

try {
  const filename = await createMigration({
    ...(nameArg ? { name: nameArg } : {}),
    git: gitFlag,
    listDir,
  });
  log({ text: `Migration created: ${filename}`, type: "success" });
  if (gitFlag) {
    log({ text: `Staged in git: ${filename}`, type: "success" });
  }
} catch (error) {
  fatal("Failed to create migration", error);
}
