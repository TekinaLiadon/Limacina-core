import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const LAUNCHER_DIR = join(import.meta.dir, "..", "public", "launcher");
const GITHUB_API = "https://api.github.com/repos/yushijinhun/authlib-injector/releases";

async function getLatestVersion(): Promise<string> {
  const res = await fetch(`${GITHUB_API}/latest`);
  if (!res.ok) throw new Error(`Failed to fetch latest release: ${res.status}`);
  const data = (await res.json()) as { tag_name: string };
  return data.tag_name.replace(/^v/, "");
}

async function getDownloadUrl(version: string): Promise<string> {
  return `https://github.com/yushijinhun/authlib-injector/releases/download/v${version}/authlib-injector-${version}.jar`;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const data = new Uint8Array(await res.arrayBuffer());
  await Bun.write(dest, data);
}

function parseArgs(): { mcVersion: string; authlibVersion: string | undefined } {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run download:authlib <mc_version> [authlib_version]");
    console.error("Example: bun run download:authlib 1.20.4");
    console.error("Example: bun run download:authlib 1.20.4 1.2.7");
    process.exit(1);
  }

  return {
    mcVersion: args[0]!,
    authlibVersion: args[1],
  };
}

async function main() {
  const { mcVersion, authlibVersion } = parseArgs();

  const version = authlibVersion ?? (await getLatestVersion());
  console.log(`authlib-injector v${version} for MC ${mcVersion}`);

  const url = await getDownloadUrl(version);
  const filename = "authlib-injector.jar";
  const dest = join(LAUNCHER_DIR, filename);

  if (!existsSync(LAUNCHER_DIR)) {
    await mkdir(LAUNCHER_DIR, { recursive: true });
  }

  if (existsSync(dest)) {
    console.log(`File already exists: ${filename}`);
    return;
  }

  console.log(`Downloading from ${url}...`);
  await downloadFile(url, dest);
  console.log(`Saved to ${filename}`);
}

main();
