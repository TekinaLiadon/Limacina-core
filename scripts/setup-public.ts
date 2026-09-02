import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OLD_VERSIONS_DIR, SUPPORTED_PLATFORMS } from "../src/launcher/launcher-files";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const PLATFORM_DIRECTORIES = Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
  archs.flatMap((arch) => [join(os, arch), join(os, arch, OLD_VERSIONS_DIR)]),
);

const DIRECTORIES = ["launcher", "launcher/mods", ...PLATFORM_DIRECTORIES, "textures", "models"];

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
