import { crc32, deflateSync } from "node:zlib";
import { assertPngLevel, DEFAULT_CANVAS_PNG_LEVEL, type PgsDisplaySet } from "@bdmv2web/media-export";

export interface PgsTrackPackageInput { playlistId: string; playlistNumber: number; playItemIndex: number; clipId: string; pid: number; streamNumber: number; language: string; sourceIn90k: string; sourceOut90k: string; source: string; path: string; displaySets: PgsDisplaySet[] }

export function serializePgsTrack(track: PgsTrackPackageInput, pngLevel: number | undefined) {
  if (!Number.isSafeInteger(track.pid) || !Number.isSafeInteger(track.streamNumber) || track.streamNumber <= 0 || !Number.isSafeInteger(track.playItemIndex) || track.playItemIndex < 0) throw new TypeError("PGS package track has invalid PID, stream number, or PlayItem index.");
  if (BigInt(track.sourceOut90k) <= BigInt(track.sourceIn90k)) throw new TypeError("PGS package track has an invalid source interval.");
  return {
    playlistId: track.playlistId, playlistNumber: track.playlistNumber, playItemIndex: track.playItemIndex,
    clipId: track.clipId, pid: track.pid, streamNumber: track.streamNumber, language: track.language,
    sourceIn90k: track.sourceIn90k, sourceOut90k: track.sourceOut90k, source: track.source, path: track.path,
    displaySets: track.displaySets.map((set) => ({
      pts90k: set.pts90k, width: set.width, height: set.height, compositionNumber: set.compositionNumber,
      compositionState: set.compositionState, paletteId: set.paletteId,
      palette: [...set.palette].map(([index, rgba]) => [index, [...rgba]]),
      bitmaps: [...set.bitmaps.values()].map((bitmap) => ({ objectId: bitmap.objectId, width: bitmap.width, height: bitmap.height })),
      imageBase64: encodePgsDisplayPng(set, pngLevel),
      placements: set.placements,
    })),
  };
}

function encodePgsDisplayPng(set: PgsDisplaySet, pngLevel: number | undefined): string {
  const rgba = new Uint8Array(set.width * set.height * 4);
  for (const placement of set.placements) {
    const bitmap = set.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const pixels = bitmap.pixels;
    const { width, height } = bitmap;
    const crop = placement.crop ?? { x: 0, y: 0, width, height };
    for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
      const sourceX = crop.x + x, sourceY = crop.y + y;
      const targetX = placement.x + x, targetY = placement.y + y;
      if (sourceX >= width || sourceY >= height || targetX < 0 || targetY < 0 || targetX >= set.width || targetY >= set.height) continue;
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (targetY * set.width + targetX) * 4;
      const sourceAlpha = pixels[sourceOffset + 3]! / 255;
      if (sourceAlpha === 0) continue;
      const targetAlpha = rgba[targetOffset + 3]! / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel++) {
        rgba[targetOffset + channel] = Math.round((pixels[sourceOffset + channel]! * sourceAlpha + rgba[targetOffset + channel]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      rgba[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
  const scanlines = Buffer.alloc(set.height * (set.width * 4 + 1));
  for (let y = 0; y < set.height; y++) scanlines.set(rgba.subarray(y * set.width * 4, (y + 1) * set.width * 4), y * (set.width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(set.width, 0); header.writeUInt32BE(set.height, 4); header[8] = 8; header[9] = 6;
  const level = assertPngLevel(pngLevel ?? DEFAULT_CANVAS_PNG_LEVEL);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines, { level })), pngChunk("IEND", Buffer.alloc(0))]);
  return png.toString("base64");
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const contents = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); contents.copy(chunk, 4); chunk.writeUInt32BE(crc32(contents), data.length + 8);
  return chunk;
}
