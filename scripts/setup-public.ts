import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const DIRECTORIES = ["launcher", "launcher/mods", "releases", "textures", "capes", "models"];

function main() {
  let created = 0;

  for (const dir of DIRECTORIES) {
    const fullPath = join(PUBLIC_DIR, dir);
    if (existsSync(fullPath)) continue;

    mkdirSync(fullPath, { recursive: true });
    console.log(`Created: ${dir}`);
    created++;
  }

  if (created === 0) {
    console.log("All directories already exist");
  } else {
    console.log(`Created ${created} items`);
  }
}

main();
