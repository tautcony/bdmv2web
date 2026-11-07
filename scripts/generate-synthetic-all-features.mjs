#!/usr/bin/env node
/**
 * Generate the all-features synthetic BDMV fixture from literal field values.
 *
 * Run: corepack pnpm generate:synthetic-all-features
 *
 * The generator writes test-data/fixtures/synthetic-all-features/. It uses no
 * workspace packages and no FFmpeg. Every byte is built
 * from the BDMV field layouts exercised by packages/bdmv-parser, packages/igs,
 * packages/media-export and packages/package-builder. The output is checked in
 * and consumed by apps/cli/src/synthetic-all-features.test.ts.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "test-data/fixtures/synthetic-all-features");
const BDMV = resolve(OUT, "BDMV");

const PMT_PID = 0x1000;
const VIDEO_PID = 0x1011;
const AUDIO_PIDS = [0x1100, 0x1101];
const PG_PIDS = [0x1200, 0x1201];
const IG_PID = 0x1400;
const OBJECT_ID = 5;

/* ------------------------------------------------------------------ bytes */

const b8 = (...values) => Uint8Array.from(values);
const u16 = (value) => b8((value >> 8) & 255, value & 255);
const u24 = (value) => b8((value >> 16) & 255, (value >> 8) & 255, value & 255);
const u32 = (value) => b8((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const ascii = (text) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
const zeros = (count) => new Uint8Array(count);

function cat(...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function put(bytes, offset, part) { bytes.set(part, offset); }
function put32(bytes, offset, value) { put(bytes, offset, u32(value)); }
function put16(bytes, offset, value) { put(bytes, offset, u16(value)); }

function segment(type, body) { return cat(b8(type, (body.length >> 8) & 255, body.length & 255), body); }

function mpegCrc(section) {
  let crc = 0xffffffff;
  for (const byte of section) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  crc >>>= 0;
  return cat(section, u32(crc));
}

/* ------------------------------------------------------------ HDMV commands */

function command(word0, word1 = 0, word2 = 0) { return cat(u32(word0), u32(word1), u32(word2)); }
const COMMANDS = {
  // MOVE loads a sentinel; RND must overwrite it with a value inside [1, 3].
  moveGpr7Nine: command(0x50400001, 7, 9),
  rndGpr7Three: command(0x50400008, 7, 3),
  playPlGpr7: command(0x22000000, 7),
  playPlZero: command(0x22800000, 0),
  playPlOne: command(0x22800000, 1),
  playPlPm: command(0x42820000, 0, 0x00000fff),
  setButtonPage: command(0x51c00003, 0x80000000, 0x80000001),
  enableButton: command(0x31800004, 1),
  disableButton: command(0x31800005, 2),
  jumpTitleOne: command(0x21810000, 1),
  popupOff: command(0x11000007),
  setStream: command(0x51400001, 0, 0),
  break: command(0x00020000),
};

/* ------------------------------------------------------------- index.bdmv */

function playbackTarget(type, target, access = 0) {
  const out = new Uint8Array(12);
  out[0] = (type << 6) | (access << 4);
  out[4] = 1 << 6;
  if (type === 1) put16(out, 6, target); else put(out, 6, ascii(String(target)));
  return out;
}

function indexBdmv() {
  const titleCount = 2;
  const bodySize = 92 + 26 + 12 * titleCount;
  const extensionSize = 36;
  const out = new Uint8Array(bodySize + extensionSize);
  put(out, 0, ascii("INDX")); put(out, 4, ascii("0100"));
  put32(out, 8, 88); put32(out, 12, bodySize);
  put32(out, 40, 34);
  out[44] = 0x20 | 1; // contentExistFlag + initialDynamicRangeType = HDR10
  out[45] = (6 << 4) | 1; // videoFormat 1080p + frameRate 23.976
  put32(out, 88, 26 + 12 * titleCount);
  put(out, 92, playbackTarget(1, 0)); // First Play -> MovieObject 0
  put(out, 104, playbackTarget(1, 1)); // Top Menu -> MovieObject 1
  put16(out, 116, titleCount);
  put(out, 118, playbackTarget(1, 2, 0)); // Title 1 -> MovieObject 2
  put(out, 130, playbackTarget(1, 3, 0)); // Title 2 -> MovieObject 3

  // INDX extension 3.1: UHD disc type, 4K flag and HDR signalling.
  put32(out, bodySize, 32); put32(out, bodySize + 4, 24);
  out[bodySize + 11] = 1;
  put16(out, bodySize + 12, 3); put16(out, bodySize + 14, 1);
  put32(out, bodySize + 16, 24); put32(out, bodySize + 20, 12);
  put32(out, bodySize + 24, 8);
  out[bodySize + 28] = (5 << 4) | 1; // discType 5 (UHD), exists4k
  out[bodySize + 30] = 0x10 | 0x04 | 3; // HDR10+, Dolby Vision, hdrFlags
  return out;
}

/* -------------------------------------------------------- MovieObject.bdmv */

function movieObjectBdmv(objects) {
  const commandCount = objects.reduce((total, item) => total + item.length, 0);
  const length = 6 + 4 * objects.length + 12 * commandCount;
  const out = new Uint8Array(44 + length);
  put(out, 0, ascii("MOBJ")); put(out, 4, ascii("0100"));
  put32(out, 40, length);
  put16(out, 48, objects.length);
  let at = 50;
  for (const commands of objects) {
    put(out, at, zeros(2)); at += 2; // resume/menuCall/titleSearch masks
    put16(out, at, commands.length); at += 2;
    for (const bytes of commands) { put(out, at, bytes); at += 12; }
  }
  return out;
}

/* ------------------------------------------------------------ AUXDATA sound */

function soundBdmv() {
  const out = new Uint8Array(88);
  put(out, 0, ascii("BCLK")); put(out, 4, ascii("0100"));
  put32(out, 8, 80); // sample data start
  put32(out, 40, 8); // sample data length
  out[45] = 2; // two sounds: 48 kHz, 16-bit mono
  for (let index = 0; index < 2; index++) {
    const at = 46 + index * 10;
    out[at] = 0x11; out[at + 1] = 0x40;
    put32(out, at + 2, index * 4); put32(out, at + 6, 4);
  }
  put(out, 80, b8(0x34, 0x12, 0x78, 0x56, 0x21, 0x43, 0x65, 0x87));
  return out;
}

/* -------------------------------------------------------------- CLPI / MPLS */

function attributeBytes(codingType, language = "eng") {
  // First nibble is bd_video_format_e; 6 = 1080p (H.264 menu), 8 = 2160p (HEVC UHD).
  // CLPI reads dynamicRange/colorSpace from byte 2, MPLS from byte 1; both carry HDR10 + BT.2020.
  if (codingType === 0x24) return b8((8 << 4) | 1, 0x12, 0x12, 0);
  if ([0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2].includes(codingType)) return cat(b8(0), ascii(language));
  if ([0x90, 0x91, 0xa0].includes(codingType)) return cat(ascii(language), b8(0));
  return b8((6 << 4) | 1, 0, 0, 0);
}

function u48(value) {
  const out = new Uint8Array(6);
  let bits = BigInt(value);
  for (let index = 5; index >= 0; index--) { out[index] = Number(bits & 255n); bits >>= 8n; }
  return out;
}

/** Full CLPI layout as consumed by libbluray's clpi_parse.c: ClipInfo at 40,
 * then SequenceInfo, ProgramInfo, CPI and ClipMark sections at declared addresses.
 * Zero section addresses are not valid: libbluray seeks to byte 0 and reads the
 * "HDMV" magic as a section length, which produces a bogus EP map parse. */
function clpiBdmv(streams, packetCount, presentationEnd45k) {
  const tsType = cat(b8(0x80), ascii("HDMV"), zeros(25)); // validity + format id + reserved
  const clipInfoBody = cat(u16(0), b8(1, 1), u32(0), u32(6_000_000), u32(packetCount),
    zeros(128), u16(tsType.length), tsType);
  const sequenceBody = cat(b8(0, 1), u32(0), b8(1, 0), u16(VIDEO_PID),
    u32(0), u32(0), u32(presentationEnd45k));
  const records = streams.map((stream) => cat(u16(stream.pid), b8(5, stream.codingType), attributeBytes(stream.codingType, stream.language)));
  const programBody = cat(b8(0, 1), u32(0), u16(PMT_PID), b8(streams.length, 0), ...records);
  // One coarse + one fine EP entry at SPN 0 / PTS 0 for the declared video PID.
  const coarse = cat(u32(0), u32(0));
  const epBlock = cat(u32(4 + coarse.length), coarse, u32(0));
  const epHead = cat(b8(0, 1), u16(VIDEO_PID), u48((1n << 34n) | (1n << 18n) | 1n), u32(14));
  const cpiBody = cat(u16(1), epHead, epBlock); // 12 reserved bits + CPI type 1
  const parts = [
    cat(u32(clipInfoBody.length), clipInfoBody),
    cat(u32(sequenceBody.length), sequenceBody),
    cat(u32(programBody.length), programBody),
    cat(u32(cpiBody.length), cpiBody),
    u32(0), // no clip marks
  ].map((part) => cat(part, zeros((4 - part.length % 4) % 4)));
  const offsets = [];
  let cursor = 40;
  for (const part of parts) { offsets.push(cursor); cursor += part.length; }
  const out = new Uint8Array(cursor);
  put(out, 0, ascii("HDMV")); put(out, 4, ascii("0200"));
  put32(out, 8, offsets[1]); // SequenceInfo
  put32(out, 12, offsets[2]); // ProgramInfo
  put32(out, 16, offsets[3]); // CPI
  put32(out, 20, offsets[4]); // ClipMark
  put32(out, 24, 0); // no extension data
  cursor = 40;
  for (const part of parts) { put(out, cursor, part); cursor += part.length; }
  return out;
}

function mplsStreamRecord(stream) {
  return cat(b8(3, 1), u16(stream.pid), b8(5, stream.codingType), attributeBytes(stream.codingType, stream.language));
}

function playItem(clipId, inTime45k, outTime45k, streams, stillMode = 0) {
  const records = streams.map(mplsStreamRecord);
  const recordBytes = records.reduce((total, record) => total + record.length, 0);
  const stnLength = 14 + recordBytes;
  const itemLength = 34 + stnLength;
  const counts = b8(
    streams.filter((s) => s.kind === "video").length,
    streams.filter((s) => s.kind === "audio").length,
    streams.filter((s) => s.kind === "pg").length,
    streams.filter((s) => s.kind === "ig").length,
    0, 0, 0, 0,
  );
  const stn = cat(zeros(2), counts, zeros(4), ...records);
  return cat(u16(itemLength), ascii(clipId), ascii("M2TS"), u16(0x0001), b8(0),
    u32(inTime45k), u32(outTime45k), zeros(8), b8(0), b8(stillMode), u16(0),
    u16(stnLength), stn);
}

function subPath(clipId, inTime45k, outTime45k) {
  const item = cat(u16(28), ascii(clipId), ascii("M2TS"), u32(2), b8(0),
    u32(inTime45k), u32(outTime45k), u16(0), u32(0));
  const length = 1 + 1 + 2 + 1 + 1 + item.length;
  return cat(u32(length), b8(0), b8(2), u16(0), b8(0), b8(1), item);
}

function mark(playItemRef, time45k, type = 1) {
  return cat(b8(0), b8(type), u16(playItemRef), u32(time45k), u16(VIDEO_PID), u32(0));
}

function mplsBdmv(playItems, subPaths, marks, playbackType = 1) {
  const appLength = 14;
  const listPos = 44 + appLength;
  const listBody = cat(zeros(2), u16(playItems.length), u16(subPaths.length), ...playItems, ...subPaths);
  const listLength = listBody.length;
  const markPos = listPos + 4 + listLength;
  const markBody = cat(u16(marks.length), ...marks);
  const markLength = markBody.length;
  const out = new Uint8Array(markPos + 4 + markLength);
  put(out, 0, ascii("MPLS")); put(out, 4, ascii("0200"));
  put32(out, 8, listPos); put32(out, 12, markPos); put32(out, 16, 0);
  put32(out, 40, appLength);
  put(out, 44, cat(b8(0), b8(playbackType), u16(7), u32(0x00040000), u32(0x00000000), b8(0xc0), b8(0)));
  put32(out, listPos, listLength); put(out, listPos + 4, listBody);
  put32(out, markPos, markLength); put(out, markPos + 4, markBody);
  return out;
}

/* ------------------------------------------------------------ IGS segments */

function effectSequence(windows, effects) {
  const windowBytes = windows.map((window) => cat(b8(window.id), u16(window.x), u16(window.y), u16(window.width), u16(window.height)));
  const effectBytes = effects.map((effect) => cat(u24(effect.duration), b8(effect.paletteId), b8(effect.objects.length),
    ...effect.objects.map((object) => cat(u16(object.objectId), b8(object.windowId), b8(object.flags), u16(object.x), u16(object.y)))));
  return cat(b8(windows.length), ...windowBytes, b8(effects.length), ...effectBytes);
}

function button(id, options) {
  return cat(u16(id), u16(options.numericSelectValue ?? 0), b8(options.autoAction ? 0x80 : 0),
    u16(options.x ?? 0), u16(options.y ?? 0),
    u16(options.up), u16(options.down), u16(options.left), u16(options.right),
    u16(OBJECT_ID), u16(OBJECT_ID), b8(options.animated ? 0x80 : 0),
    b8(options.selectedSoundId), u16(OBJECT_ID), u16(OBJECT_ID), b8(options.animated ? 0x80 : 0),
    b8(options.activatedSoundId), u16(OBJECT_ID), u16(OBJECT_ID),
    u16(options.commands.length), ...options.commands);
}

function page(id, options) {
  const bogs = options.bogs.map((bog) => cat(u16(bog.defaultButtonId), b8(bog.buttons.length), ...bog.buttons));
  return cat(b8(id, 0), options.uoMask ?? zeros(8), options.enter, options.exit,
    b8(options.animationFrameRateCode ?? 0), u16(options.defaultSelectedButtonId),
    u16(options.defaultActivatedButtonId ?? 0xffff), b8(options.paletteId ?? 0), b8(bogs.length), ...bogs);
}

function timeoutFields(compositionTimeout90k, selectionTimeout90k) {
  let bits = 0n;
  bits = (bits << 7n);
  bits = (bits << 33n) | BigInt(compositionTimeout90k);
  bits = (bits << 7n);
  bits = (bits << 33n) | BigInt(selectionTimeout90k);
  const out = new Uint8Array(10);
  for (let index = 0; index < 10; index++) out[index] = Number((bits >> BigInt(8 * (9 - index))) & 255n);
  return out;
}

function icsBdmv(compositionData, compositionNumber = 1) {
  // 0x80 = epoch start; libbluray's graphics controller only initializes a
  // menu from an epoch-start composition, not from a normal-case update.
  return cat(u16(1920), u16(1080), b8(0x10), u16(compositionNumber), b8(0x80), b8(0xc0),
    u24(compositionData.length), compositionData);
}

function igSegments(ics) {
  const palette = b8(0, 0, 1, 235, 128, 128, 255);
  const object = cat(u16(OBJECT_ID), b8(0, 0xc0), u24(5), u16(1), u16(1), b8(1));
  return cat(segment(0x18, ics), segment(0x14, palette), segment(0x15, object), segment(0x80, b8()));
}

function mainMenuIgs() {
  const enter = effectSequence([{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }],
    [{ duration: 90000, paletteId: 0, objects: [{ objectId: OBJECT_ID, windowId: 1, flags: 0x40, x: 0, y: 0 }] }]);
  const exit = effectSequence([], [{ duration: 45000, paletteId: 0, objects: [] }]);
  const first = page(0, {
    uoMask: b8(0, 0, 0x04, 0, 0, 0, 0, 0),
    enter, exit, animationFrameRateCode: 1,
    defaultSelectedButtonId: 1, defaultActivatedButtonId: 0xffff,
    bogs: [
      { defaultButtonId: 1, buttons: [
        button(1, { up: 3, down: 2, left: 3, right: 2, selectedSoundId: 0, activatedSoundId: 1, commands: [COMMANDS.setButtonPage] }),
        button(2, { up: 1, down: 3, left: 1, right: 3, selectedSoundId: 1, activatedSoundId: 0, autoAction: true, animated: true, commands: [COMMANDS.playPlZero] }),
        button(3, { up: 2, down: 1, left: 2, right: 1, selectedSoundId: 0, activatedSoundId: 1, commands: [COMMANDS.jumpTitleOne] }),
      ] },
      // A second button group on the same page, with cross-group navigation.
      { defaultButtonId: 4, buttons: [
        button(4, { up: 1, down: 1, left: 1, right: 1, selectedSoundId: 1, activatedSoundId: 0, commands: [COMMANDS.enableButton, COMMANDS.playPlPm] }),
      ] },
    ],
  });
  const second = page(1, {
    enter: effectSequence([], []), exit: effectSequence([], []),
    defaultSelectedButtonId: 1, defaultActivatedButtonId: 0xfffe,
    bogs: [{ defaultButtonId: 1, buttons: [
      button(1, { up: 1, down: 1, left: 1, right: 1, selectedSoundId: 1, activatedSoundId: 0, commands: [COMMANDS.playPlPm] }),
    ] }],
  });
  const data = cat(b8(0x80), u24(0), b8(2), first, second); // streamModel 1, uiModel 0
  return igSegments(icsBdmv(data));
}

function popupIgs() {
  const only = page(0, {
    enter: effectSequence([], []), exit: effectSequence([], []),
    defaultSelectedButtonId: 1, defaultActivatedButtonId: 0xffff,
    bogs: [{ defaultButtonId: 1, buttons: [
      button(1, { up: 2, down: 2, left: 2, right: 2, selectedSoundId: 0, activatedSoundId: 1, commands: [COMMANDS.popupOff] }),
      button(2, { up: 1, down: 1, left: 1, right: 1, selectedSoundId: 1, activatedSoundId: 0, commands: [COMMANDS.setStream] }),
    ] }],
  });
  // streamModel 0 (timeouts present), uiModel 1 (popup).
  const data = cat(b8(0x40), timeoutFields(90_000, 45_000), u24(123), b8(1), only);
  return igSegments(icsBdmv(data, 2));
}

/* ------------------------------------------------------------ PGS segments */

function pgsDisplaySets() {
  const palette = b8(0, 0, 1, 235, 128, 128, 255);
  // One 1x1 pixel in palette entry 1, then an explicit end-of-line marker.
  // dataLength covers the 4 dimension bytes plus the 3 RLE bytes.
  const object = cat(u16(1), b8(0, 0xc0), u24(7), u16(1), u16(1), b8(1, 0, 0));
  const window = cat(b8(1, 0), u16(0), u16(0), u16(1920), u16(1080));
  const composition = (count, placements) => cat(u16(1920), u16(1080), b8(0x10), u16(count === 0 ? 1 : 0),
    b8(0x80), b8(0), b8(0), b8(count), ...placements);
  const placement = cat(u16(1), b8(0), b8(0), u16(0), u16(0));
  return cat(
    segment(0x16, composition(1, [placement])), segment(0x17, window),
    segment(0x14, palette), segment(0x15, object), segment(0x80, b8()),
    segment(0x16, composition(0, [])), segment(0x80, b8()),
  );
}

/* ---------------------------------------------------------- TS / PES muxing */

function patSection() {
  const body = cat(b8(0, 1, 0xc1, 0, 0, 0, 1), b8(0xe0 | ((PMT_PID >> 8) & 0x1f), PMT_PID & 255));
  const length = body.length + 4;
  return mpegCrc(cat(b8(0x00, 0xb0 | ((length >> 8) & 0x0f), length & 255), body));
}

function pmtSection(streams) {
  const entries = streams.map((stream) => b8(stream.type, 0xe0 | ((stream.pid >> 8) & 0x1f), stream.pid & 255, 0xf0, 0));
  const body = cat(b8(0, 1, 0xc1, 0, 0, 0xe0 | ((VIDEO_PID >> 8) & 0x1f), VIDEO_PID & 255, 0xf0, 0), ...entries);
  const length = body.length + 4;
  return mpegCrc(cat(b8(0x02, 0xb0 | ((length >> 8) & 0x0f), length & 255), body));
}

function tsPacket(pid, payload, options = {}) {
  const frame = new Uint8Array(192);
  const ts = frame.subarray(4);
  ts.fill(0xff);
  ts[0] = 0x47;
  ts[1] = ((options.pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f)) & 0x7f;
  ts[2] = pid & 255;
  const cc = (options.cc ?? 0) & 15;
  if (payload.length === 184) {
    ts[3] = 0x10 | cc;
    ts.set(payload, 4);
  } else {
    if (payload.length > 184) throw new RangeError("TS payload exceeds 184 bytes");
    const adaptationLength = 183 - payload.length;
    ts[3] = 0x30 | cc;
    ts[4] = adaptationLength;
    if (adaptationLength > 0) ts[5] = 0;
    ts.set(payload, 5 + adaptationLength);
  }
  return frame;
}

function tsPackets(pid, pes, startCc = 0) {
  const out = [];
  let offset = 0;
  let cc = startCc;
  while (offset < pes.length) {
    const chunk = pes.subarray(offset, Math.min(offset + 184, pes.length));
    out.push(tsPacket(pid, chunk, { pusi: offset === 0, cc: cc & 15 }));
    cc += 1;
    offset += chunk.length;
  }
  return out;
}

function encodeTimestamp(value) {
  return b8(((2 & 15) << 4) | ((Number(value >> 30n) & 7) << 1) | 1,
    Number(value >> 22n) & 255, ((Number(value >> 15n) & 127) << 1) | 1,
    Number(value >> 7n) & 255, ((Number(value) & 127) << 1) | 1);
}

function pesPacket(payload, pts) {
  const length = 8 + payload.length;
  return cat(b8(0, 0, 1, 0xbd, (length >> 8) & 255, length & 255, 0x80, 0x80, 5), encodeTimestamp(pts), payload);
}

/** libbluray's graphics_processor_decode_ts() treats one PES packet as one
 * PG/IG segment, so each segment needs its own PES packet. */
function splitSegments(bytes) {
  const out = [];
  let at = 0;
  while (at + 3 <= bytes.length) {
    const end = at + 3 + ((bytes[at + 1] << 8) | bytes[at + 2]);
    if (end > bytes.length) throw new RangeError("PGS/IGS segment exceeds its buffer");
    out.push(bytes.subarray(at, end));
    at = end;
  }
  if (at !== bytes.length) throw new RangeError("Trailing bytes after PGS/IGS segments");
  return out;
}

function m2ts(streams, dataPes) {
  const packets = [
    tsPacket(0, cat(b8(0), patSection()), { pusi: true, cc: 0 }),
    tsPacket(PMT_PID, cat(b8(0), pmtSection(streams)), { pusi: true, cc: 0 }),
  ];
  const ccByPid = new Map([[0, 1], [PMT_PID, 1]]);
  for (const entry of dataPes) {
    for (const segment of splitSegments(entry.payload)) {
      const cc = ccByPid.get(entry.pid) ?? 0;
      const group = tsPackets(entry.pid, pesPacket(segment, entry.pts), cc);
      ccByPid.set(entry.pid, (cc + group.length) & 15);
      packets.push(...group);
    }
  }
  // libbluray's _read_block() only demuxes complete 6144-byte (32-packet)
  // units; a shorter clip is never read, so pad with null TS packets.
  const UnitBytes = 6144;
  const padding = (UnitBytes - (packets.length * 192) % UnitBytes) % UnitBytes;
  for (let index = 0; index < padding / 192; index++) packets.push(tsPacket(0x1fff, zeros(184), { cc: index & 15 }));
  return cat(...packets);
}

/* ------------------------------------------------------------------- main */

const menuStreams = [
  { pid: VIDEO_PID, codingType: 0x1b, kind: "video" },
  { pid: AUDIO_PIDS[0], codingType: 0x80, kind: "audio", language: "eng" },
  { pid: PG_PIDS[0], codingType: 0x90, kind: "pg", language: "eng" },
  { pid: IG_PID, codingType: 0x91, kind: "ig", language: "eng" },
];
const featureStreams = [
  { pid: VIDEO_PID, codingType: 0x24, kind: "video" },
  { pid: AUDIO_PIDS[0], codingType: 0x80, kind: "audio", language: "eng" },
  { pid: AUDIO_PIDS[1], codingType: 0x80, kind: "audio", language: "fra" },
  { pid: PG_PIDS[0], codingType: 0x90, kind: "pg", language: "eng" },
  { pid: PG_PIDS[1], codingType: 0x90, kind: "pg", language: "fra" },
  { pid: IG_PID, codingType: 0x91, kind: "ig", language: "eng" },
];
const subClipStreams = [
  { pid: VIDEO_PID, codingType: 0x1b, kind: "video" },
  { pid: AUDIO_PIDS[0], codingType: 0x80, kind: "audio", language: "eng" },
  { pid: PG_PIDS[0], codingType: 0x90, kind: "pg", language: "eng" },
];

const clips = {
  "00001": { streams: menuStreams, ig: mainMenuIgs(), pg: pgsDisplaySets() },
  "00002": { streams: featureStreams, ig: popupIgs(), pg: pgsDisplaySets() },
  "00003": { streams: subClipStreams, ig: null, pg: pgsDisplaySets() },
};

// First Play opens the still menu; Top Menu re-enters it with button commands.
// Title 1 keeps MOVE/RND/PLAY_PL so a random playlist selection stays covered.
const movieObjects = [
  [COMMANDS.playPlOne, COMMANDS.break],
  [COMMANDS.setButtonPage, COMMANDS.enableButton, COMMANDS.disableButton, COMMANDS.playPlZero, COMMANDS.break],
  [COMMANDS.moveGpr7Nine, COMMANDS.rndGpr7Three, COMMANDS.playPlGpr7, COMMANDS.break],
  [COMMANDS.playPlPm, COMMANDS.jumpTitleOne, COMMANDS.popupOff, COMMANDS.setStream, COMMANDS.break],
];

const playlistOne = mplsBdmv(
  [playItem("00001", 0, 180_000, menuStreams, 2)], // still menu: libbluray holds for button input
  [subPath("00003", 0, 90_000)],
  // Type 1 = chapter/entry mark (loop-start candidate), type 2 = link point.
  // The chapter mark at 0 is at inTime, so 85_522 is the resolved loop start.
  [mark(0, 0), mark(0, 85_522), mark(0, 120_000, 2)],
  3, // shuffle
);
const playlistTwo = mplsBdmv(
  [playItem("00002", 0, 180_000, featureStreams)],
  [],
  [mark(0, 0), mark(0, 90_000)],
  2, // random
);
const playlistThree = mplsBdmv(
  [playItem("00001", 0, 90_000, menuStreams), playItem("00002", 90_000, 180_000, featureStreams)],
  [],
  [mark(0, 0), mark(1, 90_000)],
  1, // sequential
);

await rm(OUT, { recursive: true, force: true });
for (const directory of ["", "AUXDATA", "PLAYLIST", "CLIPINF", "STREAM"]) {
  await mkdir(resolve(BDMV, directory), { recursive: true });
}

await writeFile(resolve(BDMV, "index.bdmv"), indexBdmv());
await writeFile(resolve(BDMV, "MovieObject.bdmv"), movieObjectBdmv(movieObjects));
await writeFile(resolve(BDMV, "AUXDATA/sound.bdmv"), soundBdmv());
await writeFile(resolve(BDMV, "PLAYLIST/00001.mpls"), playlistOne);
await writeFile(resolve(BDMV, "PLAYLIST/00002.mpls"), playlistTwo);
await writeFile(resolve(BDMV, "PLAYLIST/00003.mpls"), playlistThree);

for (const [clipId, clip] of Object.entries(clips)) {
  const tsStreams = clip.streams.map((stream) => ({
    pid: stream.pid,
    type: stream.codingType === 0x80 ? 0x81 : stream.codingType,
  }));
  const dataPes = [];
  if (clip.ig) dataPes.push({ pid: IG_PID, pts: 90_000n, payload: clip.ig });
  dataPes.push({ pid: PG_PIDS[0], pts: 180_000n, payload: clip.pg });
  if (clipId === "00002") dataPes.push({ pid: PG_PIDS[1], pts: 270_000n, payload: clip.pg });
  const transport = m2ts(tsStreams, dataPes);
  await writeFile(resolve(BDMV, `CLIPINF/${clipId}.clpi`), clpiBdmv(clip.streams, transport.length / 192, 180_000));
  await writeFile(resolve(BDMV, `STREAM/${clipId}.m2ts`), transport);
}

console.log(`generated synthetic all-features disc at ${OUT}`);
