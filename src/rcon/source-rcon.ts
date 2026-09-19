export interface RconPacket {
  id: number;
  type: number;
  body: string;
}

const SIZE_BYTES = 4;
const HEADER_BYTES = 8;
const NULL_BYTES = 2;
const MIN_SIZE = HEADER_BYTES + NULL_BYTES;

export function bodyByteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

export function packetSize(body: string): number {
  return MIN_SIZE + bodyByteLength(body);
}

export function packetWireLength(bytes: Uint8Array): number | undefined {
  if (bytes.length < SIZE_BYTES) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getInt32(0, true);
  if (size < MIN_SIZE) return undefined;

  return SIZE_BYTES + size;
}

export function encodeRconPacket(packet: RconPacket): Uint8Array {
  const bodyBytes = new TextEncoder().encode(packet.body);
  const size = MIN_SIZE + bodyBytes.length;
  const bytes = new Uint8Array(SIZE_BYTES + size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  view.setInt32(0, size, true);
  view.setInt32(SIZE_BYTES, packet.id, true);
  view.setInt32(SIZE_BYTES + 4, packet.type, true);
  bytes.set(bodyBytes, SIZE_BYTES + HEADER_BYTES);

  return bytes;
}

export function decodeRconPacket(bytes: Uint8Array): RconPacket | null {
  const wireLength = packetWireLength(bytes);
  if (wireLength === undefined) return null;
  if (bytes.length < wireLength) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getInt32(0, true);
  const id = view.getInt32(SIZE_BYTES, true);
  const type = view.getInt32(SIZE_BYTES + 4, true);
  const terminator = findTerminator(bytes, SIZE_BYTES + HEADER_BYTES, SIZE_BYTES + size);
  const body = new TextDecoder().decode(bytes.subarray(SIZE_BYTES + HEADER_BYTES, terminator));

  return { id, type, body };
}

function findTerminator(bytes: Uint8Array, start: number, end: number): number {
  for (let index = start; index < end; index++) {
    if (bytes[index] === 0) return index;
  }
  return end;
}
