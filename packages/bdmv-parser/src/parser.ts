import { BinaryCursor, ContractError, DEFAULT_LIMITS, serializeOffset, type Limits } from "@bdmv-web/core";
import { discoverBdmvInput, readRegisteredFile } from "@bdmv-web/bdmv-io";
import type { ClipInfo, EntryTarget, GraphEdge, GraphNode, MovieObject, ParseDiagnostic, ParsedDisc, PlayItem, PlayMark, Playlist, SoundEntry, SourceLocation, StreamDeclaration, SubPath } from "./model.js";

const supportedVersions = new Set(["0100", "0200", "0300"]);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const asUtf8 = (bytes: Uint8Array) => new TextDecoder("ascii").decode(bytes);

class Bits {
  private bit = 0;
  private readonly cursor: BinaryCursor;
  constructor(readonly data: Uint8Array, readonly base = 0) { this.cursor = new BinaryCursor(data, base); }
  get offset(): number { return this.bit >>> 3; }
  get absolute(): number { return this.base + this.offset; }
  get length(): number { return this.data.length; }
  checkedProduct(count: number, size: number): number { try { return this.cursor.checkedProduct(count, size); } catch { throw new ContractError("BDMV_INVALID_COUNT", "/count", "Count product is invalid"); } }
  read(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32 || count > this.data.length * 8 - this.bit) throw new ContractError("TRUNCATED_INPUT", "/offset", `Cannot read ${count} bits at byte ${this.offset}`);
    let value = 0;
    for (let i = 0; i < count; i++) { value = (value * 2) + ((this.data[this.bit >>> 3]! >>> (7 - (this.bit & 7))) & 1); this.bit++; }
    return value >>> 0;
  }
  skipBits(count: number): void { if (!Number.isSafeInteger(count) || count < 0 || count > this.data.length * 8 - this.bit) throw new ContractError("TRUNCATED_INPUT", "/offset", `Cannot skip ${count} bits at byte ${this.offset}`); this.bit += count; }
  skip(count: number): void { if (!Number.isSafeInteger(count) || count < 0 || count > Math.floor((this.data.length * 8 - this.bit) / 8)) throw new ContractError("TRUNCATED_INPUT", "/offset", `Cannot skip ${count} bytes at byte ${this.offset}`); this.bit += count * 8; this.cursor.seek(this.offset); }
  align(): void { this.skipBits((8 - (this.bit & 7)) & 7); }
  u8(): number { this.align(); this.cursor.seek(this.offset); const value = this.cursor.u8(); this.bit += 8; return value; }
  u16(): number { this.align(); this.cursor.seek(this.offset); const value = this.cursor.u16be(); this.bit += 16; return value; }
  u32(): number { this.align(); this.cursor.seek(this.offset); const value = this.cursor.u32be(); this.bit += 32; return value; }
  bytes(n: number): Uint8Array { this.align(); this.cursor.seek(this.offset); const bytes = this.cursor.bytes(n); this.bit += n * 8; return bytes; }
  text(n: number): string { return asUtf8(this.bytes(n)); }
  seek(byte: number): void { this.align(); this.cursor.seek(byte); this.bit = byte * 8; }
  sub(byteLength: number): Bits { this.align(); const start = this.offset; if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > this.data.length - start) throw new ContractError("TRUNCATED_INPUT", "/offset", `Section length ${byteLength} exceeds file`); this.bit += byteLength * 8; return new Bits(this.data.subarray(start, start + byteLength), this.base + start); }
  checkMagic(value: string): void { const at = this.offset; const actual = this.text(value.length); if (actual !== value) throw new ContractError("BDMV_INVALID_MAGIC", `/offset/${at}`, `Expected ${value}, got ${actual}`); }
  version(): string { const at = this.offset; const v = this.text(4); if (!supportedVersions.has(v)) throw new ContractError("BDMV_UNSUPPORTED_VERSION", `/offset/${at}`, `Unsupported version ${JSON.stringify(v)}`); return v; }
  source(path: string, origin: "primary" | "backup"): SourceLocation { return { path, origin, offset: serializeOffset(BigInt(this.absolute)) }; }
}

interface FileEntry { rel: string; abs: string; size: number; }
interface LocatedFile { primary?: FileEntry; backup?: FileEntry; }

function normCase(s: string): string { return s.toLocaleLowerCase("en-US"); }
function fileName(s: string): string { return s.split("/").pop() ?? s; }
export async function discoverBdmvRoot(inputPath: string): Promise<string> { return (await discoverBdmvInput(inputPath)).root; }

function diagnose(diagnostics: ParseDiagnostic[], code: string, message: string, file?: FileEntry, offset?: number, severity: ParseDiagnostic["severity"] = "warning", recoverable = true, entityId: string | null = null): void {
  diagnostics.push({ severity, code, message, sourcePath: file?.rel ?? null, offset: offset === undefined ? null : String(offset), entityId, action: null, recoverable, stage: "structural", affectedEntryIds: [] });
}

function pathIndex(files: FileEntry[]): Map<string, FileEntry> { return new Map(files.map((f) => [normCase(f.rel), f])); }
function locate(index: Map<string, FileEntry>, path: string): LocatedFile {
  const key = normCase(path);
  const primary = index.get(key); const backup = index.get(normCase(path.replace(/^([^/]+)\/(?!BACKUP\/)(.*)$/, "$1/BACKUP/$2")));
  return { ...(primary ? { primary } : {}), ...(backup ? { backup } : {}) };
}
function sourceFor(file: FileEntry, root: string, origin: "primary" | "backup", offset: number): SourceLocation {
  return { path: file.rel, origin, offset: String(offset) };
}

interface ParsedFile<T> { value: T; version: string; raw: Uint8Array; }
function parseIndex(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<EntryTarget[]> {
  const r = new Bits(data);
  r.checkMagic("INDX"); const version = r.version(); const section = r.u32(); const ext = r.u32();
  if (section < 40 || section >= data.length) throw new ContractError("BDMV_INVALID_SECTION", "/indexOffset", `Invalid index section offset ${section}`);
  if (ext && ext >= data.length) throw new ContractError("BDMV_INVALID_SECTION", "/extensionOffset", `Invalid extension offset ${ext}`);
  r.seek(section);
  const blockLength = r.u32(); if (blockLength > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/indexLength", "Index section exceeds file");
  const end = r.offset + blockLength;
  if (blockLength < 26) throw new ContractError("BDMV_INVALID_SECTION", "/indexLength", "Index section is too short for First Play, Top Menu and title count");
  const parseTarget = (title = false): EntryTarget => {
    const start = r.offset; const type = r.read(2); const access = title ? r.read(2) : undefined;
    if (title) r.skipBits(28); else r.skipBits(30);
    let playbackType = 0; let target: number | string | null = null; let objectType: EntryTarget["objectType"] = "unknown";
    if (type === 1) { objectType = "HDMV"; playbackType = r.read(2); r.skipBits(14); target = r.read(16); r.skipBits(32); }
    else if (type === 2) { objectType = "BDJ"; playbackType = r.read(2); r.skipBits(14); target = r.text(5); r.skip(1); }
    else if (type !== 0) { throw new ContractError("BDMV_UNKNOWN_OBJECT_TYPE", `/offset/${start}`, `Unknown index object type ${type}`); }
    return { objectType, playbackType, target, ...(access === undefined ? {} : { accessType: access }), source: sourceFor(file, "", origin, start) };
  };
  const entries = [parseTarget(), parseTarget()];
  const count = r.u16();
  if (count > Math.floor((end - r.offset) / 12)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 2}`, `Title count ${count} exceeds index section`);
  for (let i = 0; i < count; i++) entries.push(parseTarget(true));
  return { value: entries, version, raw: data };
}

function parseMobj(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<MovieObject[]> {
  const r = new Bits(data); r.checkMagic("MOBJ"); const version = r.version(); const ext = r.u32();
  if (ext && ext >= data.length) throw new ContractError("BDMV_INVALID_SECTION", "/extensionOffset", `Invalid MOBJ extension offset ${ext}`);
  r.seek(40); const length = r.u32(); const sectionEnd = r.offset + length; if (length < 6 || sectionEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/dataLength", "MOBJ data section is too short or exceeds file");
  r.skip(4); const countOffset = r.offset; const count = r.u16();
  if (count > Math.floor((length - 6) / 4)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, `MovieObject count ${count} exceeds declared data`);
  const result: MovieObject[] = [];
  for (let i = 0; i < count; i++) {
    const start = r.offset; if (start + 4 > sectionEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, `MovieObject ${i} header exceeds declared data`); const resumeIntention = !!r.read(1); const menuCallMask = !!r.read(1); const titleSearchMask = !!r.read(1); r.skipBits(13);
    const commandCountOffset = r.offset; const commandCount = r.u16();
    const needed = r.checkedProduct(commandCount, 12);
    if (needed > sectionEnd - r.offset) throw new ContractError("TRUNCATED_INPUT", `/offset/${commandCountOffset}`, `Object ${i} declares ${commandCount} commands beyond the MOBJ data section`);
    const instructions = [];
    for (let j = 0; j < commandCount; j++) {
      const offset = r.offset; const bytes = r.bytes(12);
      instructions.push({ words: [new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false), new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, false), new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, false)] as [number, number, number], bytes: hex(bytes), source: sourceFor(file, "", origin, offset) });
    }
    result.push({ id: i, resumeIntention, menuCallMask, titleSearchMask, instructions, source: sourceFor(file, "", origin, start) });
    if (r.offset <= start) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${start}`, "MOBJ parser did not advance");
  }
  return { value: result, version, raw: data };
}

function parseMpls(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<Playlist> {
  const r = new Bits(data); r.checkMagic("MPLS"); const version = r.version(); const listPos = r.u32(); const markPos = r.u32(); const extPos = r.u32();
  r.skip(20); const appLen = r.u32(); if (appLen > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/appInfoLength", "MPLS app info exceeds file");
  const appEnd = r.offset + appLen; r.skip(1); r.read(8); r.skip(2); r.skip(8); r.read(1); r.read(1); r.read(1); r.read(1); r.read(1); if (r.offset > appEnd) throw new ContractError("BDMV_INVALID_SECTION", "/appInfo", "MPLS app info fields exceed section");
  if (listPos < 40 || listPos >= data.length || markPos < 40 || markPos >= data.length || (extPos && extPos >= data.length)) throw new ContractError("BDMV_INVALID_SECTION", "/sectionOffset", "MPLS section offset exceeds file");
  r.seek(listPos); const listLen = r.u32(); const listEnd = r.offset + listLen; if (listEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/playlistLength", "MPLS playlist section exceeds file");
  r.skip(2); const itemCount = r.u16(); const subCount = r.u16();
  if (itemCount > Math.floor((listEnd - r.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 4}`, "PlayItem count exceeds playlist section");
  const playItems: PlayItem[] = [];
  const parseStream = (context: Bits, enclosingEnd: number): StreamDeclaration => {
    if (context.offset + 1 > enclosingEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${context.absolute}`, "MPLS stream length is outside STN section");
    const source = context.source(file.rel, origin); const streamLen = context.u8(); const streamEnd = context.offset + streamLen;
    if (streamEnd > enclosingEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${source.offset}`, "MPLS stream record exceeds STN section");
    const streamType = context.u8(); let pid: number | null = null; let subPathId: number | null = null; let subClipId: number | null = null;
    if (streamType === 1) pid = context.u16(); else if (streamType === 2) { subPathId = context.u8(); subClipId = context.u8(); pid = context.u16(); } else if (streamType === 3 || streamType === 4) { subPathId = context.u8(); pid = context.u16(); }
    if (context.offset > streamEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${source.offset}`, "MPLS stream header exceeds record"); context.seek(streamEnd);
    if (context.offset + 1 > enclosingEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${source.offset}`, "MPLS stream attribute length is outside STN section");
    const attrLen = context.u8(); const attrEnd = context.offset + attrLen; if (attrEnd > enclosingEnd || context.offset >= attrEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${source.offset}`, "MPLS stream attributes exceed STN section or omit coding type"); const codingType = context.u8(); let language: string | null = null;
    const attrBytes = [0x90,0x91,0xa0,0x92,3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType) ? 4 : [1,2,0xea,0x1b,0x24].includes(codingType) ? 4 : 0;
    if (context.offset + attrBytes > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${source.offset}`, "MPLS coding attributes exceed stream record");
    if ([0x90,0x91,0xa0].includes(codingType)) { language = context.text(3); context.skip(1); }
    else if (codingType === 0x92) { context.skip(1); language = context.text(3); }
    else if ([3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType)) { context.skip(1); language = context.text(3); }
    else if ([1,2,0xea,0x1b,0x24].includes(codingType)) context.skip(4);
    if (context.offset > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${source.offset}`, "MPLS stream attributes exceed record"); context.seek(attrEnd);
    return { streamType, pid, subPathId, subClipId, codingType, language, source };
  };
  for (let i = 0; i < itemCount; i++) {
    const recordStart = r.offset; const itemLen = r.u16(); const end = r.offset + itemLen;
    if (end > listEnd || itemLen < 48) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${recordStart}`, "PlayItem exceeds playlist section or is too short for fixed fields");
    const source = r.source(file.rel, origin); const clipId = r.text(5); const codecId = r.text(4); r.skipBits(11);
    const multiAngle = !!r.read(1); const connectionCondition = r.read(4); const stcId = r.u8(); const inTime45k = r.u32(); const outTime45k = r.u32(); const uoMask = ((BigInt(r.u32()) << 32n) | BigInt(r.u32())).toString(); r.skipBits(1); r.skipBits(7); const stillMode = r.u8(); const stillTime = r.u16();
    if (r.offset > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem fixed fields exceed record");
    let angleCount = 1; let differentAudio = false; let seamlessAngle = false;
    if (multiAngle) { if (r.offset + 1 > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem angle count exceeds record"); angleCount = Math.max(1, r.u8()); const angleBytes = 1 + (angleCount - 1) * 10; if (r.offset + angleBytes > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem angle records exceed record"); r.skipBits(6); differentAudio = !!r.read(1); seamlessAngle = !!r.read(1); r.skip((angleCount - 1) * 10); }
    if (r.offset + 2 > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem has no bounded STN length");
    const stnLen = r.u16(); const stnStart = r.offset; const stnEnd = stnStart + stnLen; if (stnEnd > end || stnLen < 14) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN section exceeds PlayItem or is too short for its header"); r.skip(2); const counts = Array.from({ length: 8 }, () => r.u8()); r.skip(4); if (r.offset > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN header exceeds STN section");
    const streams: StreamDeclaration[] = []; const total = counts.reduce((a, b) => a + b, 0);
    if (total > Math.floor((stnEnd - r.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${stnStart}`, "STN count exceeds STN section");
    for (let j = 0; j < total; j++) streams.push(parseStream(r, stnEnd));
    if (r.offset > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN records exceed section"); r.seek(stnEnd); r.seek(end);
    if (outTime45k < inTime45k) throw new ContractError("BDMV_INVALID_TIME_RANGE", `/offset/${recordStart}`, "PlayItem OUT precedes IN");
    playItems.push({ index: i, clipId, codecId, stcId, inTime45k, outTime45k, connectionCondition, multiAngle, angleCount, differentAudio, seamlessAngle, uoMask, stillMode, stillTime, streams, source });
  }
  const subPaths: SubPath[] = [];
  for (let i = 0; i < subCount; i++) {
    const start = r.offset; const len = r.u32(); const end = r.offset + len; if (end > listEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath exceeds playlist section");
    if (len < 6) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath is too short for its header");
    const source = r.source(file.rel, origin); r.skip(1); const type = r.u8(); const flags = r.u16(); const repeat = !!(flags & 0x8000); r.skip(1); const count = r.u8(); const items = [];
    if (r.offset > end) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath header exceeds SubPath section");
    if (count > Math.floor((end - r.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${start}`, "SubPlayItem count exceeds SubPath");
    for (let j = 0; j < count; j++) { const rec = r.offset; if (r.offset + 2 > end) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem length is outside SubPath"); const itemLen = r.u16(); const itemEnd = r.offset + itemLen; if (itemEnd > end || itemLen < 26) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem exceeds SubPath or is too short for fixed fields"); const itemSource = r.source(file.rel, origin); const clipId = r.text(5); const codecId = r.text(4); r.skip(3); const inTime45k = r.u32(); const outTime45k = r.u32(); const syncPlayItemId = r.u16(); const syncPts45k = r.u32(); if (r.offset > itemEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${rec}`, "SubPlayItem fields exceed record"); r.seek(itemEnd); items.push({ clipId, codecId, stcId: 0, inTime45k, outTime45k, syncPlayItemId, syncPts45k, source: itemSource }); }
    r.seek(end); subPaths.push({ type, repeat, items, source });
  }
  r.seek(markPos); const markLen = r.u32(); const markEnd = r.offset + markLen; if (markEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/markLength", "PlayMark section exceeds file"); const markCount = r.u16();
  if (markCount > Math.floor((markEnd - r.offset) / 14)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 2}`, "PlayMark count exceeds section");
  const marks: PlayMark[] = [];
  for (let i = 0; i < markCount; i++) { const source = r.source(file.rel, origin); r.skip(1); const type = r.u8(); const playItemRef = r.u16(); const time45k = r.u32(); const entryEsPid = r.u16(); const duration45k = r.u32(); marks.push({ index: i, type, playItemRef, time45k, entryEsPid, duration45k, source }); }
  return { value: { id: file.rel.split("/").pop()!.replace(/\.mpls$/i, ""), version, playItems, marks, subPaths, source: sourceFor(file, "", origin, 0) }, version, raw: data };
}

function parseClpi(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<ClipInfo> {
  const r = new Bits(data); r.checkMagic("HDMV"); const version = r.version(); const seqPos = r.u32(); const programPos = r.u32(); const cpiPos = r.u32(); const markPos = r.u32(); const extPos = r.u32();
  for (const [name, pos] of [["sequence", seqPos], ["program", programPos], ["cpi", cpiPos], ["mark", markPos], ["extension", extPos]] as const) if (pos && pos >= data.length) throw new ContractError("BDMV_INVALID_SECTION", `/${name}Offset`, `${name} offset exceeds file`);
  r.seek(40); const infoLen = r.u32(); if (infoLen > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/clipInfoLength", "CLPI clip info exceeds file"); r.skip(2); r.u8(); r.u8(); r.skip(4); r.u32(); r.u32();
  const programs: ClipInfo["programs"] = [];
  if (programPos) {
    r.seek(programPos); const pLen = r.u32(); const pEnd = r.offset + pLen; if (pEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/programInfoLength", "CLPI program info exceeds file"); r.skip(1); const count = r.u8(); if (r.offset > pEnd) throw new ContractError("BDMV_INVALID_SECTION", "/programInfoLength", "CLPI program info header exceeds section");
    if (count > Math.floor((pEnd - r.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 1}`, "CLPI program count exceeds section");
    for (let i = 0; i < count; i++) {
      const start = r.offset; const sequenceStartSpn = r.u32(); const programMapPid = r.u16(); const streamCount = r.u8(); const groupCount = r.u8();
      if (streamCount > Math.floor((pEnd - r.offset) / 3)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${start}`, "CLPI stream count exceeds program section");
      const streams = [];
      for (let j = 0; j < streamCount; j++) {
        const streamOffset = r.offset; if (r.offset + 3 > pEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${streamOffset}`, "CLPI stream header exceeds ProgramInfo section"); const pid = r.u16(); const attrLen = r.u8(); const attrEnd = r.offset + attrLen; if (attrEnd > pEnd || r.offset >= attrEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${streamOffset}`, "CLPI stream attributes exceed ProgramInfo section or omit coding type"); const codingType = r.u8(); let language: string | null = null;
        const attrBytes = [3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2,0x92].includes(codingType) ? 4 : [0x90,0x91,0xa0].includes(codingType) ? 4 : [1,2,0xea,0x1b,0x20].includes(codingType) ? 4 : codingType === 0x24 ? 8 : 0;
        if (r.offset + attrBytes > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${streamOffset}`, "CLPI coding attributes exceed stream record");
        if ([3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType)) { r.skip(1); language = r.text(3); }
        else if ([0x90,0x91,0xa0].includes(codingType)) { language = r.text(3); r.skip(1); }
        else if (codingType === 0x92) { r.skip(1); language = r.text(3); }
        else if ([1,2,0xea,0x1b,0x20,0x24].includes(codingType)) r.skip(codingType === 0x24 ? 8 : 4);
        if (r.offset > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${streamOffset}`, "CLPI stream attribute exceeds record"); r.seek(attrEnd);
        streams.push({ pid, codingType, language, source: r.source(file.rel, origin) });
      }
      void groupCount;
      programs.push({ sequenceStartSpn, programMapPid, streams, source: sourceFor(file, "", origin, start) });
    }
  }
  const cpi = [] as ClipInfo["cpi"];
  if (cpiPos) {
    r.seek(cpiPos); const cpiLen = r.u32(); const cpiEnd = r.offset + cpiLen; if (cpiEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/cpiLength", "CLPI CPI section exceeds file"); r.skipBits(12); r.read(4); const mapBase = r.offset; r.skipBits(8); const pidCount = r.u8(); if (r.offset > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", "/cpiLength", "CLPI CPI header exceeds section");
    const maps = [] as Array<{ pid: number; type: number; coarse: number; fine: number; start: number; source: SourceLocation }>;
    if (pidCount > Math.floor((cpiEnd - r.offset) / 10)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 1}`, "CPI PID count exceeds section");
    for (let i = 0; i < pidCount; i++) { if (r.offset + 10 > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.offset}`, "CPI PID map exceeds section"); const source = r.source(file.rel, origin); const pid = r.read(16); r.skipBits(10); const type = r.read(4); const coarse = r.read(16); const fine = r.read(18); const start = r.read(32); maps.push({ pid, type, coarse, fine, start, source }); }
    for (const map of maps) {
      const block = mapBase + map.start; if (!Number.isSafeInteger(block) || block < mapBase || block + 4 > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${block}`, "CPI entry block exceeds section"); r.seek(block); const fineStart = r.u32();
      if (map.coarse > Math.floor((cpiEnd - r.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${block}`, "CPI coarse entry count exceeds section");
      const coarseEntries = []; for (let j = 0; j < map.coarse; j++) { const refFine = r.read(18); const pts = r.read(14); const spn = r.u32(); coarseEntries.push({ refFine, pts, spn }); }
      const fineBlock = block + fineStart; if (!Number.isSafeInteger(fineBlock) || fineBlock < r.offset || fineBlock > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${fineBlock}`, "CPI fine entry block exceeds section"); r.seek(fineBlock);
      if (map.fine > Math.floor((cpiEnd - r.offset) / 4)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${block}`, "CPI fine entry count exceeds section");
      for (let j = 0; j < map.fine; j++) { const source = r.source(file.rel, origin); const angleChange = !!r.read(1); r.skipBits(3); const pts = r.read(11); const spnOffset = r.read(17); let coarseEntry: typeof coarseEntries[number] | undefined; for (const entry of coarseEntries) if (entry.refFine <= j) coarseEntry = entry; const pts45k = coarseEntry ? ((coarseEntry.pts & ~1) << 18) + (pts << 8) : pts << 8; const spn = ((coarseEntry?.spn ?? 0) & ~0x1ffff) + spnOffset; cpi.push({ pid: map.pid, epStreamType: map.type, pts45k, spn, angleChange, source }); }
    }
  }
  return { value: { id: file.rel.split("/").pop()!.replace(/\.clpi$/i, ""), version, programs, cpi, source: sourceFor(file, "", origin, 0) }, version, raw: data };
}

function parseSound(data: Uint8Array, file: FileEntry, fullLength: number): SoundEntry[] {
  const r = new Bits(data); r.checkMagic("BCLK"); r.version(); const dataStart = r.u32(); const ext = r.u32(); if (dataStart >= data.length || (ext && ext >= data.length)) throw new ContractError("BDMV_INVALID_SECTION", "/dataOffset", "Sound data offset exceeds file");
  r.seek(40); const dataLength = r.u32(); r.skip(1); const count = r.u8(); if (dataLength > fullLength - dataStart) throw new ContractError("BDMV_INVALID_SECTION", "/dataLength", "Sound section exceeds file");
  const items: Array<{ index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; offset: number; declaredBytes: number; source: SourceLocation }> = [];
  for (let i = 0; i < count; i++) { const source = r.source(file.rel, "primary"); const channelCode = r.read(4); const sampleRateCode = r.read(4); const bitsPerSampleCode = r.read(2); r.skipBits(6); const offset = r.u32(); const declaredBytes = r.u32(); items.push({ index: i, channelCode, sampleRateCode, bitsPerSampleCode, offset, declaredBytes, source }); }
  return items.map((e) => {
    const sampleOffset = dataStart + e.offset; if (sampleOffset > fullLength || e.declaredBytes > fullLength - sampleOffset) throw new ContractError("TRUNCATED_INPUT", `/offset/${sampleOffset}`, `Sound ${e.index} sample range exceeds file`);
    const channels = e.channelCode === 1 ? 1 : e.channelCode === 3 ? 2 : null; const sampleRate = e.sampleRateCode === 1 ? 48000 : null; const bitsPerSample = e.bitsPerSampleCode === 1 ? 16 : null;
    return { index: e.index, channelCode: e.channelCode, sampleRateCode: e.sampleRateCode, bitsPerSampleCode: e.bitsPerSampleCode, channels, sampleRate, bitsPerSample, sampleOffset, sampleByteLength: e.declaredBytes, source: e.source };
  });
}

function choose<T>(kind: string, located: LocatedFile, bytes: Map<string, Uint8Array>, parse: (data: Uint8Array, file: FileEntry, origin: "primary" | "backup") => ParsedFile<T>, diagnostics: ParseDiagnostic[], critical: boolean): ParsedFile<T> | undefined {
  const attempt = (file: FileEntry | undefined, origin: "primary" | "backup", propagateUnsupported: boolean): ParsedFile<T> | undefined => {
    if (!file) return undefined;
    try { return parse(bytes.get(file.rel)!, file, origin); }
    catch (e) { const err = e as Error; diagnose(diagnostics, err instanceof ContractError ? err.code : "BDMV_PARSE_ERROR", err.message, file, Number(/(?:offset\/|at )([0-9]+)/.exec(err.message)?.[1] ?? 0), "error", true); if (propagateUnsupported && err instanceof ContractError && err.code === "BDMV_UNSUPPORTED_VERSION") throw err; return undefined; }
  };
  const primary = attempt(located.primary, "primary", true);
  if (primary) {
    const backup = attempt(located.backup, "backup", false);
    if (backup && hex(primary.raw) !== hex(backup.raw)) diagnose(diagnostics, "BDMV_BACKUP_DIFFERS", `${kind} primary and backup differ; primary selected`, located.primary, 0, "info", true);
    return primary;
  }
  const backup = attempt(located.backup, "backup", false);
  if (backup) { diagnose(diagnostics, "BDMV_BACKUP_FALLBACK", `${kind} recovered from matching BACKUP file`, located.backup, 0, "warning", true); return backup; }
  if (critical) diagnose(diagnostics, "BDMV_REQUIRED_FILE_MISSING", `Required ${kind} metadata is missing or invalid`, located.primary, 0, "fatal", false);
  return undefined;
}

function buildGraph(entries: ParsedDisc["entries"], objects: MovieObject[], playlists: Playlist[], clips: ClipInfo[], sounds: SoundEntry[], files: FileEntry[], diagnostics: ParseDiagnostic[]): ParsedDisc["graph"] {
  const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const add = (node: GraphNode) => { if (!nodes.some((item) => item.id === node.id)) nodes.push(node); };
  const fileByPath = new Map(files.map((file) => [normCase(file.rel), file]));
  const pathSource = (file: FileEntry) => sourceFor(file, "", "primary", 0);
  for (const entry of entries) {
    const id = `entry:${entry.id}`;
    add({ id, type: entry.kind === "title" ? "title" : "entry", state: "present", source: entry.source });
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") {
      const targetId = `movieObject:${entry.target.target}`; const object = objects.find((item) => item.id === entry.target.target);
      edges.push({ from: id, to: targetId, kind: "entry-target", resolution: object ? "resolved" : "missing", source: entry.source });
      if (!object) add({ id: targetId, type: "movieObject", state: "missing", source: entry.source });
    } else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
      const targetId = `bdjo:${entry.target.target}`; const bdjoFile = fileByPath.get(normCase(`BDMV/BDJO/${entry.target.target}.bdjo`));
      add({ id: targetId, type: "bdjo", state: bdjoFile ? "present" : "missing", source: bdjoFile ? pathSource(bdjoFile) : entry.source });
      edges.push({ from: id, to: targetId, kind: "bdj-target", resolution: bdjoFile ? "resolved" : "missing", source: entry.source });
      if (!bdjoFile) diagnose(diagnostics, "BDMV_MISSING_BDJO", `BD-J entry ${entry.id} references missing BDJO ${entry.target.target}`, files.find((file) => file.rel === entry.source.path), Number(entry.source.offset), "error", true, id);
    }
  }
  for (const object of objects) {
    const id = `movieObject:${object.id}`; add({ id, type: "movieObject", state: "present", source: object.source });
    for (const [index, instruction] of object.instructions.entries()) edges.push({ from: id, to: `command:${object.id}:${index}`, kind: "raw-command", resolution: "unresolved", source: instruction.source });
  }
  for (const playlist of playlists) {
    const playlistId = `playlist:${playlist.id}`; add({ id: playlistId, type: "playlist", state: "present", source: playlist.source });
    for (const item of playlist.playItems) {
      const itemId = `playItem:${playlist.id}:${item.index}`; add({ id: itemId, type: "playItem", state: "present", source: item.source });
      edges.push({ from: playlistId, to: itemId, kind: "contains", resolution: "resolved", source: item.source });
      const clipId = `clip:${item.clipId}`; const streamFile = fileByPath.get(normCase(`BDMV/STREAM/${item.clipId}.m2ts`));
      add({ id: clipId, type: "clip", state: streamFile ? "present" : "missing", source: streamFile ? pathSource(streamFile) : item.source });
      edges.push({ from: itemId, to: clipId, kind: "clip-reference", resolution: streamFile ? "resolved" : "missing", source: item.source });
      const infoId = `clipInfo:${item.clipId}`; const info = clips.find((clip) => normCase(clip.id) === normCase(item.clipId));
      add({ id: infoId, type: "clipInfo", state: info ? "present" : "missing", source: info?.source ?? item.source });
      edges.push({ from: itemId, to: infoId, kind: "clip-info-reference", resolution: info ? "resolved" : "missing", source: item.source });
      if (!streamFile) diagnose(diagnostics, "BDMV_MISSING_STREAM", `PlayItem ${playlist.id}/${item.index} references missing STREAM clip ${item.clipId}`, files.find((file) => file.rel === item.source.path), Number(item.source.offset), "error", true, itemId);
      if (!info) diagnose(diagnostics, "BDMV_MISSING_CLPI", `PlayItem ${playlist.id}/${item.index} references missing CLPI ${item.clipId}`, files.find((file) => file.rel === item.source.path), Number(item.source.offset), "error", true, itemId);
      if (info) {
        const declared = new Map(info.programs.flatMap((program) => program.streams.map((stream) => [stream.pid, stream] as const)));
        for (const stream of item.streams) {
          if (stream.pid === null) continue;
          const clipStream = declared.get(stream.pid);
          if (!clipStream) diagnose(diagnostics, "BDMV_STN_CLPI_PID_CONFLICT", `STN PID ${stream.pid} is not declared by CLPI ${info.id}`, files.find((file) => file.rel === stream.source.path), Number(stream.source.offset), "warning", true, itemId);
          else if (stream.codingType !== null && stream.codingType !== clipStream.codingType) diagnose(diagnostics, "BDMV_STN_CLPI_CODING_CONFLICT", `STN and CLPI coding types differ for PID ${stream.pid}`, files.find((file) => file.rel === stream.source.path), Number(stream.source.offset), "warning", true, itemId);
        }
      }
    }
    for (const mark of playlist.marks) {
      const item = playlist.playItems[mark.playItemRef];
      if (!item || mark.time45k < item.inTime45k || mark.time45k > item.outTime45k) diagnose(diagnostics, "BDMV_INVALID_REFERENCE", `PlayMark ${mark.index} points outside a valid PlayItem interval`, files.find((file) => file.rel === mark.source.path), Number(mark.source.offset), "error", true, playlistId);
    }
  }
  for (const clip of clips) for (const program of clip.programs) for (const stream of program.streams) add({ id: `stream:${clip.id}:${stream.pid}`, type: "stream", state: "present", source: stream.source });
  for (const sound of sounds) add({ id: `sound:${sound.index}`, type: "sound", state: "present", source: sound.source });
  return { nodes, edges };
}

export async function parseBdmv(inputPath: string, options: { limits?: Limits } = {}): Promise<ParsedDisc> {
  const limits = options.limits ?? DEFAULT_LIMITS; const { root, table } = await discoverBdmvInput(inputPath);
  const files: FileEntry[] = [...table.files.entries()].map(([rel, abs]) => ({ rel: `BDMV/${rel}`, abs, size: 0 })).sort((a, b) => a.rel.localeCompare(b.rel, "en"));
  const index = pathIndex(files); const allBytes = new Map<string, Uint8Array>();
  const metadataFiles = files.filter((f) => /\/index\.bdmv$/i.test(f.rel) || /\/MovieObject\.bdmv$/i.test(f.rel) || /\/PLAYLIST\/[^/]+\.mpls$/i.test(f.rel) || /\/CLIPINF\/[^/]+\.clpi$/i.test(f.rel) || /\/AUXDATA\/sound\.bdmv$/i.test(f.rel));
  for (const f of metadataFiles) { const loaded = await readRegisteredFile(table, f.rel.slice("BDMV/".length), Math.min(limits.maxReadWindowBytes, limits.maxSegmentBytes), /\/sound\.bdmv$/i.test(f.rel)); f.size = loaded.byteLength; allBytes.set(f.rel, loaded.bytes); }
  const diagnostics: ParseDiagnostic[] = [];
  const indexFile = locate(index, "BDMV/index.bdmv"); const parsedIndex = choose("index.bdmv", indexFile, allBytes, (data, file, origin) => parseIndex(data, file, origin), diagnostics, true);
  const mobjFile = locate(index, "BDMV/MovieObject.bdmv"); const parsedObjects = choose("MovieObject.bdmv", mobjFile, allBytes, (data, file, origin) => parseMobj(data, file, origin), diagnostics, false);
  if (!parsedObjects) diagnose(diagnostics, "BDMV_REQUIRED_FILE_MISSING", "MovieObject.bdmv is missing or invalid", mobjFile.primary, undefined, "error", true);
  const entries: ParsedDisc["entries"] = [];
  for (const [i, target] of (parsedIndex?.value ?? []).entries()) { const kind = i === 0 ? "firstPlay" : i === 1 ? "topMenu" : "title"; entries.push({ id: `${kind}:${i < 2 ? "0" : i - 2}`, kind, target, source: target.source }); if (target.objectType === "BDJ") diagnose(diagnostics, "BDMV_BDJ_UNSUPPORTED", "BD-J entry retained but not executed by this tool", indexFile.primary, Number(target.source.offset), "warning", true, `${kind}:${i}`); }
  const objects = parsedObjects?.value ?? [];
  const playlists: Playlist[] = [];
  const playlistNames = new Set(files.filter((x) => /\/PLAYLIST\/[^/]+\.mpls$/i.test(x.rel)).map((f) => f.rel.replace(/^BDMV\/BACKUP\//i, "BDMV/")));
  for (const name of playlistNames) {
    const item = locate(index, name); const parsed = choose(`playlist ${fileName(name)}`, item, allBytes, (data, file, origin) => parseMpls(data, file, origin), diagnostics, false); if (parsed) playlists.push(parsed.value);
  }
  const clips: ClipInfo[] = [];
  const clipNames = new Set(files.filter((x) => /\/CLIPINF\/[^/]+\.clpi$/i.test(x.rel)).map((f) => f.rel.replace(/^BDMV\/BACKUP\//i, "BDMV/")));
  for (const name of clipNames) {
    const parsed = choose(`CLPI ${fileName(name)}`, locate(index, name), allBytes, (data, file, origin) => parseClpi(data, file, origin), diagnostics, false); if (parsed) clips.push(parsed.value);
  }
  const soundFile = files.find((x) => normCase(x.rel) === "bdmv/auxdata/sound.bdmv"); const sounds = soundFile ? parseSound(allBytes.get(soundFile.rel)!, soundFile, soundFile.size) : [];
  if (!soundFile) diagnose(diagnostics, "BDMV_OPTIONAL_SOUND_MISSING", "Optional AUXDATA/sound.bdmv is absent", undefined, undefined, "info", true);
  const graph = buildGraph(entries, objects, playlists, clips, sounds, files, diagnostics);
  const declarations = { entries: entries.length, movieObjects: objects.length, playlists: playlists.length, playItems: playlists.reduce((n, p) => n + p.playItems.length, 0), clips: clips.length, streams: clips.reduce((n, c) => n + c.programs.reduce((m, p) => m + p.streams.length, 0), 0), sounds: sounds.length, unknown: diagnostics.filter((d) => d.code.includes("UNSUPPORTED") || d.code.includes("UNKNOWN")).length };
  const unverified = ["Blu-ray normative conformance", "all format versions", "MPLS advanced extensions", "full CLPI sequence and clip marks", "dynamic MovieObject target resolution", "BD-J execution"];
  return { schemaVersion: "1.0", analysisStage: "structural", root, entries, movieObjects: objects, playlists, clips, sounds, graph, declarations, diagnostics, supportPrediction: { status: "partial", supported: [], unsupported: ["BD-J execution", "MPLS multi-angle playback", "SubPath playback", "media decoding"], unverified } };
}
