import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const KEYS_DIR = join(import.meta.dir, "..", "keys");

function main() {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }

  const privateKeyPath = join(KEYS_DIR, "private.pem");
  const publicKeyPath = join(KEYS_DIR, "public.pem");

  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    console.error("Keys already exist in keys/ directory. Delete them first to regenerate.");
    process.exit(1);
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(privateKeyPath, privateKey);
  writeFileSync(publicKeyPath, publicKey);

  console.log(`Private key: ${privateKeyPath}`);
  console.log(`Public key: ${publicKeyPath}`);

  const pub = createPublicKey(publicKey);
  const der = pub.export({ type: "spki", format: "der" });
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;

  console.log("\nAdd to .env (SECRETS or directly):");
  console.log(`YGGDRASIL_PUBLIC_KEY=${pem}`);
}

main();
