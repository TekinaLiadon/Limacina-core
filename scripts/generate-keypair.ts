import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
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

  console.log(`Private key: ${privateKeyPath}`);
  console.log(`Public key: ${publicKeyPath}`);
  console.log(
    `\nThe server reads keys from ${KEYS_DIR} automatically. Set KEYS_DIR only when the server runs from another working directory.`,
  );
}

main();
