import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const DIRECTORIES = [
  "launcher",
  "launcher/mods",
  "linux/x86_64",
  "linux/aarch64",
  "windows/x86_64",
  "textures",
];

const VERSION_FILE = join(PUBLIC_DIR, "version.json");
const DEFAULT_VERSION = { version: "0.0.0" };

function main() {
  let created = 0;

  for (const dir of DIRECTORIES) {
    const fullPath = join(PUBLIC_DIR, dir);
    if (existsSync(fullPath)) continue;

    mkdirSync(fullPath, { recursive: true });
    console.log(`Created: ${dir}`);
    created++;
  }

  if (!existsSync(VERSION_FILE)) {
    writeFileSync(VERSION_FILE, JSON.stringify(DEFAULT_VERSION, null, 2));
    console.log("Created: version.json");
    created++;
  }

  if (created === 0) {
    console.log("All directories already exist");
  } else {
    console.log(`Created ${created} items`);
  }
}

main();
