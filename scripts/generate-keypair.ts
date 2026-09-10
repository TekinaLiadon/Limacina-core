import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveKeysDir } from "../src/yggdrasil/service/keys-dir";

const KEYS_DIR = resolveKeysDir(process.env["KEYS_DIR"]);

function main() {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }

  const privateKeyPath = join(KEYS_DIR, "private.pem");
  const publicKeyPath = join(KEYS_DIR, "public.pem");

  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    console.error(`Keys already exist in ${KEYS_DIR}. Delete them first to regenerate.`);
    process.exit(1);
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey);

  chmodSync(privateKeyPath, 0o600);
  if (statSync(KEYS_DIR).isDirectory() === false) {
    process.exit(1);
  }

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
