import type { MenuPackageDiagnostic } from "./types.js";

export interface SoundMetadata { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number }
export interface SoundPayload { index: number; path: string; byteLength: number; format: "wav-pcm" }

/** Convert only M1-declared 48 kHz, signed 16-bit mono/stereo PCM sample ranges. BCLK words are big-endian. */
export function convertSounds(entries: SoundMetadata[], source: Uint8Array | null, scene: unknown): { assets: SoundPayload[]; diagnostics: MenuPackageDiagnostic[]; files: Array<{ path: string; bytes: Uint8Array }> } {
  const references = getSoundReferences(scene); const declared = new Map(entries.map((entry) => [entry.index, entry]));
  const assets: SoundPayload[] = []; const diagnostics: MenuPackageDiagnostic[] = []; const files: Array<{ path: string; bytes: Uint8Array }> = [];
  const affected = (soundId: number) => references.get(soundId)?.map((ref) => `page ${ref.pageId}, button ${ref.buttonId}`).join("; ") ?? "no menu buttons";
  for (const soundId of new Set(references.keys())) {
    const entry = declared.get(soundId);
    if (!entry) { diagnostics.push({ code: "SOUND_REFERENCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but has no M1 sound entry.` }); continue; }
    if (!source) { diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but sound.bdmv bytes are unavailable.` }); continue; }
    if (entry.channels !== 1 && entry.channels !== 2 || entry.sampleRate !== 48000 || entry.bitsPerSample !== 16 || entry.channelCode !== (entry.channels === 1 ? 1 : 3) || entry.sampleRateCode !== 1 || entry.bitsPerSampleCode !== 1) {
      diagnostics.push({ code: "SOUND_FORMAT_UNSUPPORTED", message: `Sound ${soundId} referenced by ${affected(soundId)} has unsupported M1 PCM attributes (channel=${entry.channelCode}, rate=${entry.sampleRateCode}, bits=${entry.bitsPerSampleCode}).` }); continue;
    }
    const { sampleOffset, sampleByteLength } = entry;
    if (!Number.isSafeInteger(sampleOffset) || !Number.isSafeInteger(sampleByteLength) || sampleOffset < 0 || sampleByteLength < 0 || sampleOffset > source.byteLength || sampleByteLength > source.byteLength - sampleOffset || sampleByteLength % (entry.channels * 2) !== 0 || sampleByteLength > 0xffffffff - 36) {
      diagnostics.push({ code: "SOUND_RANGE_INVALID", message: `Sound ${soundId} referenced by ${affected(soundId)} has an invalid or truncated M1 sample range.` }); continue;
    }
    const wav = makePcmWav(source.subarray(sampleOffset, sampleOffset + sampleByteLength), entry.channels);
    const path = `assets/audio/sound-${soundId}.wav`; assets.push({ index: soundId, path, byteLength: wav.byteLength, format: "wav-pcm" }); files.push({ path, bytes: wav });
  }
  return { assets, diagnostics, files };
}

function makePcmWav(samples: Uint8Array, channels: number): Uint8Array {
  const wav = new Uint8Array(44 + samples.byteLength); const view = new DataView(wav.buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.byteLength, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.byteLength, true);
  for (let i = 0; i < samples.byteLength; i += 2) { wav[44 + i] = samples[i + 1]!; wav[44 + i + 1] = samples[i]!; }
  return wav;
}

function getSoundReferences(scene: unknown): Map<number, Array<{ pageId: number; buttonId: number }>> {
  const result = new Map<number, Array<{ pageId: number; buttonId: number }>>();
  if (typeof scene !== "object" || scene === null || !Array.isArray((scene as { pages?: unknown }).pages)) return result;
  for (const page of (scene as { pages: Array<{ id?: number; buttons?: Array<{ id?: number; states?: Record<string, { soundId?: number }> }> }> }).pages) for (const button of page.buttons ?? []) for (const state of Object.values(button.states ?? {})) {
    const id = state?.soundId; if (!Number.isInteger(id) || id === 0xff || id! < 0) continue;
    const refs = result.get(id!) ?? []; refs.push({ pageId: page.id ?? -1, buttonId: button.id ?? -1 }); result.set(id!, refs);
  }
  return result;
}
