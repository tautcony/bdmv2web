/** M1 synthetic octets are assembled from literal field values, without importing a parser. */
function put32(bytes: Uint8Array, offset: number, value: number): void { bytes[offset] = value >>> 24; bytes[offset + 1] = value >>> 16; bytes[offset + 2] = value >>> 8; bytes[offset + 3] = value; }
function put16(bytes: Uint8Array, offset: number, value: number): void { bytes[offset] = value >>> 8; bytes[offset + 1] = value; }
function ascii(bytes: Uint8Array, offset: number, value: string): void { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); }

function playback(type: 1 | 2, target: number | string, playbackType = 1, access?: number): Uint8Array {
  const out = new Uint8Array(12);
  out[0] = (type << 6) | ((access ?? 0) << 4);
  out[4] = playbackType << 6;
  if (type === 1) put16(out, 6, Number(target)); else ascii(out, 6, String(target));
  return out;
}

export function buildM1Index(options: {
  version?: string; first?: number; top?: number; hdmvTitle?: number; bdjTitle?: string; titleAccess?: number;
  appInfo?: { initialOutputMode?: boolean; contentExist?: boolean; initialDynamicRangeType?: number; videoFormat?: number; frameRate?: number };
  uhd?: { discType?: number; exists4k?: boolean; hdrFlags?: number; hdr10Plus?: boolean; dolbyVision?: boolean };
} = {}): Uint8Array {
  const first = options.first ?? 0; const top = options.top ?? 1; const titleCount = Number(options.hdmvTitle !== undefined) + Number(options.bdjTitle !== undefined);
  const bodySize = 92 + 26 + 12 * titleCount;
  const extensionSize = options.uhd ? 36 : 0;
  const out = new Uint8Array(bodySize + extensionSize);
  ascii(out, 0, "INDX"); ascii(out, 4, options.version ?? "0100"); put32(out, 8, 88); put32(out, 12, options.uhd ? bodySize : 0);
  put32(out, 40, 34);
  if (options.appInfo) {
    out[44] = (options.appInfo.initialOutputMode ? 0x40 : 0) | (options.appInfo.contentExist ? 0x20 : 0) | ((options.appInfo.initialDynamicRangeType ?? 0) & 0x0f);
    out[45] = (((options.appInfo.videoFormat ?? 0) & 0x0f) << 4) | ((options.appInfo.frameRate ?? 0) & 0x0f);
  }
  put32(out, 88, 26 + 12 * titleCount);
  out.set(playback(1, first), 92); out.set(playback(1, top), 104);
  put16(out, 116, titleCount);
  let p = 118;
  if (options.hdmvTitle !== undefined) { out.set(playback(1, options.hdmvTitle), p); p += 12; }
  if (options.bdjTitle !== undefined) out.set(playback(2, options.bdjTitle, 2, options.titleAccess ?? 1), p);
  if (options.uhd) {
    // Extension 3.1: 32-byte payload, one 12-byte entry at address 24, 8-byte UHD body.
    put32(out, bodySize, 32); put32(out, bodySize + 4, 24); out[bodySize + 11] = 1;
    put16(out, bodySize + 12, 3); put16(out, bodySize + 14, 1); put32(out, bodySize + 16, 24); put32(out, bodySize + 20, 12);
    put32(out, bodySize + 24, 8);
    out[bodySize + 28] = ((options.uhd.discType ?? 0) << 4) | (options.uhd.exists4k ? 1 : 0);
    out[bodySize + 30] = (options.uhd.hdr10Plus ? 0x10 : 0) | (options.uhd.dolbyVision ? 0x04 : 0) | ((options.uhd.hdrFlags ?? 0) & 0x03);
  }
  return out;
}

export function buildM1MovieObject(commands: Uint8Array[] = [Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]), Uint8Array.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c])]): Uint8Array {
  const out = new Uint8Array(54 + commands.length * 12); ascii(out, 0, "MOBJ"); ascii(out, 4, "0100");
  put32(out, 40, 10 + commands.length * 12); put16(out, 48, 1); put16(out, 52, commands.length);
  commands.forEach((command, i) => out.set(command, 54 + i * 12)); return out;
}

export function buildM1EmptyPlaylist(version = "0200"): Uint8Array {
  const out = new Uint8Array(96); ascii(out, 0, "MPLS"); ascii(out, 4, version); put32(out, 8, 80); put32(out, 12, 90); put32(out, 16, 0);
  put32(out, 40, 13); out[45] = 1; // playback type
  put32(out, 80, 6); put16(out, 86, 0); put16(out, 88, 0);
  put32(out, 90, 2); put16(out, 94, 0); return out;
}

export function buildM1PlaylistGolden(): Uint8Array {
  const out = new Uint8Array(246); ascii(out, 0, "MPLS"); ascii(out, 4, "0200"); put32(out, 8, 80); put32(out, 12, 212); put32(out, 16, 0);
  put32(out, 40, 13); out[45] = 1;
  put32(out, 80, 128); put16(out, 86, 2); put16(out, 88, 1);
  let p = 90;
  const item = (clip: string, inTime: number, outTime: number, multiAngle = false): number => {
    const bodyLength = multiAngle ? 60 : 48; put16(out, p, bodyLength); p += 2; ascii(out, p, clip); ascii(out, p + 5, "M2TS"); p += 9;
    put16(out, p, multiAngle ? 0x0011 : 0x0001); p += 2; out[p++] = 0; put32(out, p, inTime); p += 4; put32(out, p, outTime); p += 4;
    out[p] = 0x80; p += 8; p += 1; // UO mask, random access and reserved
    out[p++] = 0; put16(out, p, 0); p += 2;
    if (multiAngle) { out[p++] = 2; out[p++] = 0x03; ascii(out, p, "00002"); ascii(out, p + 5, "M2TS"); out[p + 9] = 0; p += 10; }
    put16(out, p, 14); p += 2; p += 2; p += 8; p += 4;
    return p;
  };
  p = item("00001", 0, 90_000, true); p = item("00003", 0, 45_000); if (p !== 202) throw new Error(`M1 playlist fixture size mismatch: ${p}`);
  put32(out, 202, 6); out[206] = 0; out[207] = 3; out[208] = 0x80; out[209] = 0; out[210] = 0; out[211] = 0;
  put32(out, 212, 30); put16(out, 216, 2);
  // Entry marks reference the first and second PlayItems respectively.
  out[218] = 0; out[219] = 1; put16(out, 220, 0); put32(out, 222, 0); put16(out, 226, 0x1011); put32(out, 228, 0);
  out[232] = 0; out[233] = 1; put16(out, 234, 1); put32(out, 236, 45_000); put16(out, 240, 0x1011); put32(out, 242, 0);
  return out;
}

function packBits(fields: Array<[number, number]>): Uint8Array {
  const bitLength = fields.reduce((sum, [, width]) => sum + width, 0); const out = new Uint8Array(Math.ceil(bitLength / 8)); let cursor = 0;
  for (const [value, width] of fields) for (let i = width - 1; i >= 0; i--) { if ((value >>> i) & 1) { const index = cursor >>> 3; out[index] = (out[index] ?? 0) | (1 << (7 - (cursor & 7))); } cursor++; }
  return out;
}

export function buildM1PlaylistWithAudioPid(): Uint8Array {
  const out = new Uint8Array(156); ascii(out, 0, "MPLS"); ascii(out, 4, "0200"); put32(out, 8, 80); put32(out, 12, 150);
  put32(out, 40, 13); out[45] = 1;
  put32(out, 80, 66); put16(out, 86, 1); put16(out, 88, 0);
  let p = 90; put16(out, p, 58); p += 2; ascii(out, p, "00001"); ascii(out, p + 5, "M2TS"); p += 9;
  put16(out, p, 1); p += 2; out[p++] = 0; put32(out, p, 0); p += 4; put32(out, p, 90_000); p += 4; p += 8; p += 4;
  put16(out, p, 24); p += 2; p += 2; out[p + 1] = 1; p += 8; p += 4;
  out[p++] = 3; out[p++] = 1; put16(out, p, 0x1100); p += 2; out[p++] = 5; out[p++] = 0x80; out[p++] = 0x11; ascii(out, p, "eng"); p += 3;
  if (p !== 150) throw new Error(`M1 STN fixture size mismatch: ${p}`);
  put32(out, 150, 2); put16(out, 154, 0); return out;
}

export function buildM1PlaylistWithSubPlayItem(): Uint8Array {
  return buildM1PlaylistWithSubPlayItemClips(false);
}

export function buildM1PlaylistWithMultiClipSubPlayItem(): Uint8Array {
  return buildM1PlaylistWithSubPlayItemClips(true);
}

function buildM1PlaylistWithSubPlayItemClips(multiClip: boolean): Uint8Array {
  const itemBodyLength = multiClip ? 39 : 28;
  const extraBytes = itemBodyLength + 2;
  const base = buildM1PlaylistGolden(); const out = new Uint8Array(base.length + extraBytes); out.set(base.subarray(0, 212)); out.set(base.subarray(212, 246), 212 + extraBytes);
  put32(out, 12, 212 + extraBytes); put32(out, 80, 128 + extraBytes); put32(out, 202, 6 + extraBytes); out[211] = 1;
  put16(out, 212, itemBodyLength); ascii(out, 214, "00009"); ascii(out, 219, "M2TS");
  // reserved=0, connection=1, multi_clip flag, primary STC=7
  out.set([0, 0, 0, multiClip ? 0x03 : 0x02, 7], 223);
  put32(out, 228, 90_000); put32(out, 232, 180_000); put16(out, 236, 1); put32(out, 238, 45_000);
  if (multiClip) { out[242] = 2; ascii(out, 243, "00010"); ascii(out, 248, "M2TS"); out[252] = 8; }
  return out;
}

/** HEVC STN attributes follow libbluray's MPLS field order: dynamic range, then color space. */
export function buildM1PlaylistWithHevcVideo(dynamicRangeType = 1, colorSpace = 2): Uint8Array {
  const out = buildM1PlaylistWithAudioPid();
  out[128] = 1; out[129] = 0; // One primary video stream, no audio streams.
  out[140] = 3; out[141] = 1; out[142] = 0x10; out[143] = 0x11; // Stream record and PID.
  out[144] = 5; out[145] = 0x24; out[146] = 0x11; // Attribute length, HEVC coding type, format/rate.
  out[147] = ((dynamicRangeType & 0x0f) << 4) | (colorSpace & 0x0f);
  out[148] = 0; out[149] = 0;
  return out;
}

export function buildM1ClipInfoProgramAndCpi(): Uint8Array {
  const out = new Uint8Array(114); ascii(out, 0, "HDMV"); ascii(out, 4, "0200"); put32(out, 8, 0); put32(out, 12, 60); put32(out, 16, 86); put32(out, 20, 0); put32(out, 24, 0);
  put32(out, 40, 0);
  put32(out, 60, 18); out[65] = 1; put32(out, 66, 32); put16(out, 70, 0x1000); out[72] = 1; out[73] = 0; put16(out, 74, 0x1100); out[76] = 5; out[77] = 0x80; out[78] = 0x11; ascii(out, 79, "eng");
  put32(out, 86, 24); out[90] = 0x00; out[91] = 0x10; out[92] = 0; out[93] = 1;
  out.set(packBits([[0x1100, 16], [0, 10], [1, 4], [0, 16], [1, 18], [14, 32]]), 94);
  put32(out, 106, 4); out.set(packBits([[0, 1], [0, 3], [5, 11], [7, 17]]), 110);
  return out;
}

/** CLPI HEVC coding attributes follow libbluray's CLPI order and retain the stream record offset. */
export function buildM1ClipInfoWithHevcVideo(dynamicRangeType = 1, colorSpace = 2): Uint8Array {
  const original = buildM1ClipInfoProgramAndCpi();
  const out = new Uint8Array(original.length + 4);
  out.set(original.subarray(0, 86)); out.set(original.subarray(86), 90);
  put32(out, 16, 90); // CPI follows the enlarged ProgramInfo section.
  put32(out, 60, 22); // ProgramInfo length grows by the four extra HEVC attribute bytes.
  out[76] = 9; out[77] = 0x24; // Stream attribute length and HEVC coding type.
  out[78] = 0x11; // Format and frame rate.
  out[79] = 0x12; // Aspect=1, reserved=0, oc_flag=1, cr_flag=0.
  out[80] = ((dynamicRangeType & 0x0f) << 4) | (colorSpace & 0x0f);
  out[81] = 0; // HDR10+ flag and reserved bits.
  out.fill(0, 82, 86);
  return out;
}

/** CLPI declares the audio track plus one IGS PID cue for cross-stage fixture use. */
export function buildM1ClipInfoWithIgsCue(): Uint8Array {
  const original = buildM1ClipInfoProgramAndCpi();
  const out = new Uint8Array(original.length + 8);
  out.set(original.subarray(0, 86));
  put32(out, 60, 26); // Include the additional 8-byte IGS stream record.
  out[72] = 2;
  put16(out, 82, 0x0120);
  out[84] = 5;
  out[85] = 0x91;
  out.set([0x65, 0x6e, 0x67, 0], 86);
  out.set(original.subarray(86), 94);
  put32(out, 16, 94); // CPI moves after the longer ProgramInfo record.
  return out;
}

export function buildM1SoundTwoRanges(): Uint8Array {
  const out = new Uint8Array(88); ascii(out, 0, "BCLK"); ascii(out, 4, "0100"); put32(out, 8, 80); put32(out, 40, 8); out[45] = 2;
  for (let i = 0; i < 2; i++) { const p = 46 + i * 10; out[p] = 0x11; out[p + 1] = 0x40; put32(out, p + 2, i * 4); put32(out, p + 6, 4); }
  out.set([1, 2, 3, 4, 5, 6, 7, 8], 80); return out;
}

/** AppInfoPlayList is 14 bytes: reserved, playback type, count, 8-byte UO mask, one flag byte. */
export function buildM1PlaylistWithAppInfo(options: { version?: string; playbackType?: number; playbackCount?: number; uoMask?: bigint; flags?: number } = {}): Uint8Array {
  const out = buildM1EmptyPlaylist(options.version ?? "0200");
  put32(out, 40, 14);
  out[44] = 0; out[45] = options.playbackType ?? 3;
  put16(out, 46, options.playbackCount ?? 7);
  const mask = options.uoMask ?? 0x0000_0430_0000_0000n;
  put32(out, 48, Number(mask >> 32n)); put32(out, 52, Number(mask & 0xffff_ffffn));
  out[56] = options.flags ?? 0x40; out[57] = 0;
  return out;
}

function putStc(bytes: Uint8Array, offset: number, pcrPid: number, spnStcStart: number, start45k: number, end45k: number): void {
  put16(bytes, offset, pcrPid); put32(bytes, offset + 2, spnStcStart); put32(bytes, offset + 6, start45k); put32(bytes, offset + 10, end45k);
}

/** CLPI with a 151-byte ClipInfo (including TS type info) and a two-STC sequence info section. */
export function buildM1ClipInfoWithSequence(): Uint8Array {
  const clipInfoPayload = 16 + 128 + 2 + 5;
  const sequenceStart = 40 + 4 + clipInfoPayload;
  const sequencePayload = 2 + 6 + 28;
  const out = new Uint8Array(sequenceStart + 4 + sequencePayload);
  ascii(out, 0, "HDMV"); ascii(out, 4, "0200");
  put32(out, 8, sequenceStart); put32(out, 12, 0); put32(out, 16, 0); put32(out, 20, 0); put32(out, 24, 0);
  put32(out, 40, clipInfoPayload);
  out[46] = 1; out[47] = 1;
  put32(out, 48, 1);
  put32(out, 52, 48_000_000); put32(out, 56, 12_000);
  put16(out, 188, 5); out[190] = 3; ascii(out, 191, "HDMV");
  put32(out, sequenceStart, sequencePayload);
  out[sequenceStart + 4] = 0; out[sequenceStart + 5] = 1;
  put32(out, sequenceStart + 6, 32); out[sequenceStart + 10] = 2; out[sequenceStart + 11] = 0;
  putStc(out, sequenceStart + 12, 0x1001, 32, 0, 4_500_000);
  putStc(out, sequenceStart + 26, 0x1011, 8_000, 4_500_000, 9_000_000);
  return out;
}

export function buildM1EmptyClipInfo(version = "0200"): Uint8Array {
  const out = new Uint8Array(60); ascii(out, 0, "HDMV"); ascii(out, 4, version); put32(out, 8, 0); put32(out, 12, 0); put32(out, 16, 0); put32(out, 20, 0); put32(out, 24, 0);
  put32(out, 40, 0); return out;
}

export function buildM1Sound(): Uint8Array {
  const out = new Uint8Array(68); ascii(out, 0, "BCLK"); ascii(out, 4, "0100"); put32(out, 8, 64); put32(out, 40, 4); out[45] = 1;
  out[46] = 0x11; out[47] = 0x40; put32(out, 48, 0); put32(out, 52, 4); out.set([0x34, 0x12, 0x78, 0x56], 64); return out;
}

export const m1MovieObjectExpected = {
  objectCount: 1,
  instructionCount: 2,
  instructionBytes: ["0102030405060708090a0b0c", "1112131415161718191a1b1c"],
  instructionOffsets: ["54", "66"],
};
