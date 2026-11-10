import { inflateSync } from "node:zlib";

/**
 * Minimal PNG reader for the two shapes this package writes: 8-bit RGBA and 8-bit
 * palette with a tRNS chunk. Tests compare decoded pixels, so the file layout the
 * encoder chooses must not leak into them.
 */
export function decodePng(input: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let width = 0, height = 0, colorType = 0;
  let palette: Buffer | null = null, transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8]!;
      if (depth !== 8 || body[12] !== 0) throw new Error(`expected 8-bit non-interlaced PNG, got depth ${depth}`);
      colorType = body[9]!;
      if (colorType !== 6 && colorType !== 3) throw new Error(`expected RGBA or palette PNG, got colour type ${colorType}`);
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (colorType === 3 && !palette) throw new Error("palette PNG without a PLTE chunk");
  const bytesPerPixel = colorType === 6 ? 4 : 1;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]!;
    const line = new Uint8Array(raw.subarray(offset, offset + stride));
    offset += stride;
    const left = bytesPerPixel;
    if (filter === 1) for (let i = left; i < stride; i++) line[i] = (line[i]! + line[i - left]!) & 255;
    else if (filter === 2) for (let i = 0; i < stride; i++) line[i] = (line[i]! + previous[i]!) & 255;
    else if (filter === 3) for (let i = 0; i < stride; i++) line[i] = (line[i]! + (((i >= left ? line[i - left]! : 0) + previous[i]!) >> 1)) & 255;
    else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= left ? line[i - left]! : 0, b = previous[i]!, c = i >= left ? previous[i - left]! : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    if (colorType === 6) rgba.set(line, y * stride);
    else for (let x = 0; x < width; x++) {
      const index = line[x]!;
      const to = (y * width + x) * 4;
      const from = index * 3;
      if (from + 2 >= palette!.length) throw new Error(`palette index ${index} exceeds the PLTE chunk`);
      rgba[to] = palette![from]!; rgba[to + 1] = palette![from + 1]!; rgba[to + 2] = palette![from + 2]!;
      rgba[to + 3] = transparency !== null && index < transparency.length ? transparency[index]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
