export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

export function concatByteChunks(chunks: readonly Uint8Array[], length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

// Callers validate the byte range before reading.
export function readU16BE(data: Uint8Array, offset: number): number { return (data[offset]! << 8) | data[offset + 1]!; }
export function readU24BE(data: Uint8Array, offset: number): number { return (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!; }
export function readU32BE(data: Uint8Array, offset: number): number { return (data[offset]! * 0x1000000) + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!; }
