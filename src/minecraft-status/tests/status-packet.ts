import { writeVarInt } from "../minecraft-slp";

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

export function buildStatusResponse(payload: object): Uint8Array {
  const json = JSON.stringify(payload);
  const body = concatBytes(
    Uint8Array.from([0]),
    writeVarInt(json.length),
    new TextEncoder().encode(json),
  );
  return concatBytes(writeVarInt(body.length), body);
}
