import { BinaryCursor, ContractError, DEFAULT_LIMITS, serializeOffset, type Limits } from "@bdmv2web/core";
import { discoverBdmvInput, locateBdmvRoot, readRegisteredFile } from "@bdmv2web/bdmv-io";
import type { AtcSequence, BdjoInfo, ClipHeader, ClipInfo, CpiMapEntry, DiscAppInfo, EntryTarget, ExtensionDataEntry, GraphEdge, GraphNode, MovieObject, ParseDiagnostic, ParsedDisc, PlayItem, Playlist, PlaylistAppInfo, PlayMark, SoundEntry, SourceLocation, StcSequence, StreamDeclaration, SubPath, UhdMetadata } from "./model.js";

// 0240 is the 3D/MVC profile. libbluray does not restrict the version field and
// ChapterTool's readers accept the same four values for INDX/MOBJ/MPLS/CLPI/BDJO.
const supportedVersions = new Set(["0100", "0200", "0240", "0300"]);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const asUtf8 = (bytes: Uint8Array) => new TextDecoder("ascii").decode(bytes);
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

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
  source(path: string, origin: "primary" | "backup"): SourceLocation { return { path: bdmvRelativePath(path), origin, offset: serializeOffset(BigInt(this.absolute)) }; }
}

interface FileEntry { rel: string; abs: string; size: number; }
interface LocatedFile { primary?: FileEntry; backup?: FileEntry; }

function normCase(s: string): string { return s.toLocaleLowerCase("en-US"); }
function fileName(s: string): string { return s.split("/").pop() ?? s; }
function bdmvRelativePath(path: string): string { return path.replace(/^BDMV\//i, ""); }
export async function discoverBdmvRoot(inputPath: string): Promise<string> { return locateBdmvRoot(inputPath); }

function diagnose(diagnostics: ParseDiagnostic[], code: string, message: string, file?: FileEntry, offset?: number, severity: ParseDiagnostic["severity"] = "warning", recoverable = true, entityId: string | null = null): void {
  diagnostics.push({ severity, code, message, sourcePath: file ? bdmvRelativePath(file.rel) : null, offset: offset === undefined ? null : String(offset), entityId, action: null, recoverable, stage: "structural", affectedEntryIds: [] });
}

function pathIndex(files: FileEntry[]): Map<string, FileEntry> { return new Map(files.map((f) => [normCase(f.rel), f])); }
function locate(index: Map<string, FileEntry>, path: string): LocatedFile {
  const key = normCase(path);
  const primary = index.get(key); const backup = index.get(normCase(path.replace(/^([^/]+)\/(?!BACKUP\/)(.*)$/, "$1/BACKUP/$2")));
  return { ...(primary ? { primary } : {}), ...(backup ? { backup } : {}) };
}
function sourceFor(file: FileEntry, root: string, origin: "primary" | "backup", offset: number): SourceLocation {
  return { path: bdmvRelativePath(file.rel), origin, offset: String(offset) };
}

interface ParsedFile<T> { value: T; version: string; raw: Uint8Array; }
interface ParsedIndex { entries: EntryTarget[]; appInfo: DiscAppInfo | null; uhd: UhdMetadata | null; }

/**
 * Record a non-fatal parse fact without aborting the whole file. Optional
 * metadata must never decide whether a disc is readable (D-3): the caller turns
 * these into `warning` diagnostics and keeps the navigation data.
 */
type Warn = (code: string, message: string, file: FileEntry, offset: number | undefined) => void;
const ignoreWarning: Warn = () => {};

/** Optional sections are parsed from a private cursor so a failed attempt cannot move the caller's. */
function optionalSection<T>(what: string, data: Uint8Array, file: FileEntry, warn: Warn, fallbackOffset: number, parseSection: (cursor: Bits) => T | null): T | null {
  try {
    return parseSection(new Bits(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(error instanceof ContractError ? error.code : "BDMV_PARSE_ERROR", `${what} is optional; the failure was recorded and skipped (${message})`, file, Number(/(?:offset\/|at )([0-9]+)/.exec(message)?.[1] ?? fallbackOffset));
    return null;
  }
}

/** Read the shared MPLS/CLPI ExtensionData address table with file and table bounds. */
function parseExtensionData(data: Uint8Array, start: number, file: FileEntry, origin: "primary" | "backup", formatVersion: string, warn: Warn): ExtensionDataEntry[] {
  if (!start) return [];
  const r = new Bits(data); r.seek(start);
  const declaredLength = r.u32();
  if (declaredLength === 0) return [];
  const tableEnd = start + 4 + declaredLength;
  if (declaredLength < 8 || tableEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "ExtensionData table exceeds file or is too short");
  r.u32(); r.skip(3); const countOffset = r.offset; const count = r.u8();
  if (count > Math.floor((tableEnd - r.offset) / 12)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, "ExtensionData entry count exceeds its table");
  const entries: ExtensionDataEntry[] = [];
  for (let i = 0; i < count; i++) {
    const tableEntryOffset = r.offset;
    const id1 = r.u16(); const id2 = r.u16(); const relativeOffset = r.u32(); const length = r.u32();
    const payloadOffset = start + relativeOffset; const payloadEnd = payloadOffset + length;
    if (!Number.isSafeInteger(payloadOffset) || payloadOffset < r.offset || payloadEnd > tableEnd || payloadEnd < payloadOffset) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${tableEntryOffset}`, "ExtensionData payload crosses its table boundary");
    const kind = extensionKind(file.rel, id1, id2);
    let parsed: { value: Record<string, unknown>; consumed: boolean } | null = null;
    try { parsed = decodeExtensionPayload(data.subarray(payloadOffset, payloadEnd), payloadOffset, file, origin, file.rel, id1, id2); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(error instanceof ContractError ? error.code : "BDMV_PARSE_ERROR", `ExtensionData ${id1}.${id2} payload could not be decoded (${message})`, file, payloadOffset);
    }
    const source = sourceFor(file, "", origin, payloadOffset);
    if (!parsed?.consumed) warn("BDMV_EXTENSION_UNPARSED", `ExtensionData ${id1}.${id2} is retained by identity and bounds; its payload is unparsed`, file, payloadOffset);
    entries.push({ id1, id2, version: formatVersion, offset: String(payloadOffset), length, kind, parsed: parsed?.consumed ?? false, data: parsed?.value ?? null, source });
  }
  return entries;
}

function extensionKind(path: string, id1: number, id2: number): string | null {
  if (/\/PLAYLIST\//i.test(path)) return id1 === 1 && id2 === 1 ? "pipMetadata" : id1 === 2 && id2 === 2 ? "subPath" : id1 === 3 && id2 === 5 ? "staticMetadata" : null;
  if (/\/CLIPINF\//i.test(path)) return id1 === 2 && id2 === 4 ? "extentStartPoints" : id1 === 2 && id2 === 5 ? "programInfoSs" : id1 === 2 && id2 === 6 ? "cpiSs" : null;
  return null;
}

function decodeExtensionPayload(bytes: Uint8Array, base: number, file: FileEntry, origin: "primary" | "backup", path: string, id1: number, id2: number): { value: Record<string, unknown>; consumed: boolean } | null {
  const kind = extensionKind(path, id1, id2); if (!kind) return null;
  const p = new Bits(bytes, base); const length = p.u32();
  if (length > bytes.length - 4) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base}`, "ExtensionData payload length exceeds entry bounds");
  if (kind === "staticMetadata") {
    const count = p.u8(); p.skip(3);
    if (count > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 28)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + 4}`, "Static metadata count exceeds payload");
    const entries: Array<Record<string, unknown>> = [];
    for (let i = 0; i < count; i++) {
      const dynamicRangeType = p.read(4); p.skipBits(28);
      const displayPrimaries: Array<{ x: number; y: number }> = [];
      for (let j = 0; j < 3; j++) displayPrimaries.push({ x: p.u16(), y: p.u16() });
      entries.push({ dynamicRangeType, displayPrimaries, whitePointX: p.u16(), whitePointY: p.u16(), maxDisplayMasteringLuminance: p.u16(), minDisplayMasteringLuminance: p.u16(), maxCll: p.u16(), maxFall: p.u16() });
    }
    return { value: { entries }, consumed: p.offset <= 4 + length };
  }
  if (kind === "extentStartPoints") {
    const count = p.u32(); if (count > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 4)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + p.offset}`, "Extent start point count exceeds payload");
    return { value: { points: Array.from({ length: count }, () => p.u32()) }, consumed: true };
  }
  if (kind === "cpiSs") {
    return { value: { maps: parseCpiMaps(p, file, origin, 4 + length) }, consumed: true };
  }
  if (kind === "programInfoSs") {
    p.skip(1); const count = p.u8(); const programs: Array<{ sequenceStartSpn: number; programMapPid: number; streamCount: number; groupCount: number; source: SourceLocation }> = [];
    if (count > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + p.offset}`, "ProgramInfo SS count exceeds payload");
    for (let index = 0; index < count; index++) {
      const offset = p.offset; const sequenceStartSpn = p.u32(); const programMapPid = p.u16(); const streamCount = p.u8(); const groupCount = p.u8();
      if (streamCount > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 3)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + offset}`, "ProgramInfo SS stream count exceeds payload");
      for (let stream = 0; stream < streamCount; stream++) { p.u16(); const attrLength = p.u8(); p.skip(attrLength); }
      programs.push({ sequenceStartSpn, programMapPid, streamCount, groupCount, source: sourceFor(file, "", origin, base + offset) });
    }
    return { value: { programs }, consumed: p.offset <= 4 + length };
  }
  if (kind === "subPath") {
    const count = p.u16(); const subPaths: SubPath[] = []; const payloadEnd = Math.min(bytes.length, 4 + length);
    if (count > Math.floor((payloadEnd - p.offset) / 10)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + p.offset}`, "Extension SubPath count exceeds payload");
    for (let index = 0; index < count; index++) {
      const start = p.offset; const recordLength = p.u32(); const end = p.offset + recordLength;
      if (recordLength < 6 || end > payloadEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base + start}`, "Extension SubPath exceeds payload");
      const source = sourceFor(file, "", origin, base + start); p.skip(1); const type = p.u8(); const flags = p.u16(); const repeat = !!(flags & 0x8000); p.skip(1); const itemCount = p.u8(); const items: SubPath["items"] = [];
      if (itemCount > Math.floor((end - p.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + start}`, "Extension SubPlayItem count exceeds record");
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        const itemStart = p.offset; const itemLength = p.u16(); const itemEnd = p.offset + itemLength;
        if (itemLength < 28 || itemEnd > end) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base + itemStart}`, "Extension SubPlayItem exceeds record");
        const itemSource = sourceFor(file, "", origin, base + itemStart); const clipId = p.text(5); const codecId = p.text(4); p.skipBits(27); const connectionCondition = p.read(4); const multiClip = !!p.read(1); const stcId = p.u8(); const inTime45k = p.u32(); const outTime45k = p.u32(); const syncPlayItemId = p.u16(); const syncPts45k = p.u32();
        const clips = [{ clipId, codecId, stcId }];
        if (multiClip) {
          if (p.offset + 1 > itemEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base + itemStart}`, "Extension multi-clip count exceeds record");
          const clipCount = Math.max(1, p.u8()); if (clipCount - 1 > Math.floor((itemEnd - p.offset) / 10)) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base + itemStart}`, "Extension multi-clip list exceeds record");
          for (let clipIndex = 1; clipIndex < clipCount; clipIndex++) clips.push({ clipId: p.text(5), codecId: p.text(4), stcId: p.u8() });
        }
        if (p.offset > itemEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${base + itemStart}`, "Extension SubPlayItem fields exceed record");
        p.seek(itemEnd); items.push({ clipId, codecId, connectionCondition, stcId, multiClip, clips, inTime45k, outTime45k, syncPlayItemId, syncPts45k, source: itemSource });
      }
      p.seek(end); subPaths.push({ type, repeat, items, source });
    }
    return { value: { subPaths }, consumed: p.offset <= payloadEnd };
  }
  if (kind === "pipMetadata") {
    const count = p.u16(); const blocks: Array<Record<string, unknown>> = [];
    if (count > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 14)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + p.offset}`, "PIP metadata count exceeds payload");
    for (let index = 0; index < count; index++) {
      const clipRef = p.u16(); const secondaryVideoRef = p.u8(); p.skip(1); const timelineType = p.read(4); const lumaKeyFlag = !!p.read(1); const trickPlayFlag = !!p.read(1); p.skipBits(10);
      p.skip(1); const lumaKeyValue = p.u8(); const upperLimitLumaKey = lumaKeyFlag ? lumaKeyValue : null; p.skip(2); const dataAddress = p.u32();
      const saved = p.offset; if (dataAddress < saved || dataAddress >= Math.min(bytes.length, 4 + length)) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${base + dataAddress}`, "PIP point list address is outside its entry payload"); p.seek(dataAddress); const pointCount = p.u16();
      if (pointCount > Math.floor((Math.min(bytes.length, 4 + length) - p.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${base + dataAddress}`, "PIP metadata point count exceeds payload");
      const points: Array<{ time: number; x: number; y: number; scaleFactor: number }> = [];
      for (let point = 0; point < pointCount; point++) { const time = p.u32(); const x = p.read(12); const y = p.read(12); const scaleFactor = p.read(4); p.skipBits(4); points.push({ time, x, y, scaleFactor }); }
      p.seek(saved); blocks.push({ clipRef, secondaryVideoRef, timelineType, lumaKeyFlag, trickPlayFlag, upperLimitLumaKey, points });
    }
    return { value: { blocks }, consumed: p.offset <= 4 + length };
  }
  return null;
}

function parseCpiMaps(p: Bits, file: FileEntry, origin: "primary" | "backup", sectionEnd: number): CpiMapEntry[] {
  p.skipBits(12); p.read(4); const mapBase = p.offset; p.skipBits(8); const count = p.u8();
  if (count > Math.floor((sectionEnd - p.offset) / 10)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${p.absolute}`, "CPI SS map count exceeds payload");
  const maps = [] as Array<CpiMapEntry & { coarseCount: number; fineCount: number; relative: number }>;
  for (let index = 0; index < count; index++) {
    const start = p.offset; const pid = p.read(16); p.skipBits(10); const epStreamType = p.read(4); const coarseCount = p.read(16); const fineCount = p.read(18); const relative = p.read(32);
    maps.push({ pid, epStreamType, coarse: [], fine: [], source: sourceFor(file, "", origin, p.base + start), coarseCount, fineCount, relative });
  }
  for (const map of maps) {
    const block = mapBase + map.relative; if (block < p.offset || block + 4 > sectionEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${p.base + block}`, "CPI SS entry block exceeds payload");
    p.seek(block); const fineStart = p.u32();
    if (map.coarseCount > Math.floor((sectionEnd - p.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${p.absolute}`, "CPI SS coarse count exceeds payload");
    for (let index = 0; index < map.coarseCount; index++) { const offset = p.offset; map.coarse.push({ refFine: p.read(18), pts: p.read(14), spn: p.u32(), source: sourceFor(file, "", origin, p.base + offset) }); }
    const fineBlock = block + fineStart; if (fineBlock < p.offset || fineBlock > sectionEnd || map.fineCount > Math.floor((sectionEnd - fineBlock) / 4)) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${p.base + fineBlock}`, "CPI SS fine entries exceed payload");
    p.seek(fineBlock);
    for (let index = 0; index < map.fineCount; index++) { const offset = p.offset; const angleChange = !!p.read(1); const endPositionOffset = p.read(3); const pts = p.read(11); const spnOffset = p.read(17); map.fine.push({ angleChange, endPositionOffset, pts, spnOffset, source: sourceFor(file, "", origin, p.base + offset) }); }
  }
  return maps.map(({ coarseCount: _coarseCount, fineCount: _fineCount, relative: _relative, ...map }) => map);
}

/** INDX AppInfoBDMV starts at byte 40 in every version; libbluray seeks there unconditionally. */
function parseIndexAppInfo(r: Bits, dataLength: number, file: FileEntry, origin: "primary" | "backup", section: number): DiscAppInfo | null {
  r.seek(40); const lengthOffset = r.offset; const length = r.u32(); const end = r.offset + length;
  if (length > dataLength - r.offset || end > section) throw new ContractError("BDMV_INVALID_SECTION", "/appInfoLength", "INDEX app info exceeds the index section");
  if (length === 0) return null;
  const flags = r.u8();
  const hasVideoFields = length >= 2;
  return {
    initialOutputModePreference: ((flags >> 6) & 1) === 1, contentExistFlag: ((flags >> 5) & 1) === 1, initialDynamicRangeType: flags & 0x0f,
    videoFormat: hasVideoFields ? r.read(4) : 0, frameRate: hasVideoFields ? r.read(4) : 0,
    userDataBytes: Math.max(0, length - 2), source: sourceFor(file, "", origin, lengthOffset),
  };
}

/**
 * INDX extension 3.1 carries the UHD disc type, 4K flag and HDR signalling.
 * The declared extension length is a consistency hint; entry and payload
 * bounds are checked against the file, as libbluray does with `bits->end`
 * (P1-P2-1).
 */
function parseIndexUhdExtension(r: Bits, dataLength: number, file: FileEntry, origin: "primary" | "backup", extension: number, warn: Warn): UhdMetadata | null {
  r.seek(extension); const lengthOffset = r.offset; const length = r.u32(); const declaredEnd = r.offset + length;
  if (length < 8 || declaredEnd > dataLength) {
    warn("BDMV_DECLARED_LENGTH_MISMATCH", `INDEX extension declares ${length} bytes at ${extension}, which does not fit the ${dataLength}-byte file`, file, lengthOffset);
  }
  r.u32(); r.skip(3); const countOffset = r.offset; const count = r.u8();
  if (count > Math.floor((dataLength - r.offset) / 12)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, "INDEX extension entry count exceeds file");
  let uhd: UhdMetadata | null = null;
  for (let i = 0; i < count; i++) {
    const start = r.offset; const type = r.u16(); const entryVersion = r.u16(); const address = r.u32(); const entryLength = r.u32();
    if (address < 4 || address + entryLength > dataLength) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "INDEX extension entry exceeds the file");
    if (address + entryLength > declaredEnd) warn("BDMV_DECLARED_LENGTH_MISMATCH", `INDEX extension entry at ${start} crosses the declared length; the file boundary was used`, file, lengthOffset);
    if (type === 3 && entryVersion === 1) {
      const payload = extension + address; r.seek(payload); const payloadLength = r.u32();
      if (payloadLength < 8 || r.offset + payloadLength > dataLength) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${payload}`, "INDEX UHD extension is truncated");
      if (r.offset + payloadLength > declaredEnd) warn("BDMV_DECLARED_LENGTH_MISMATCH", `INDEX UHD payload at ${payload} crosses the declared length; the file boundary was used`, file, lengthOffset);

      const discType = r.read(4); r.skipBits(3); const exists4k = !!r.read(1);
      r.skipBits(8); r.skipBits(3); const hdr10Plus = !!r.read(1); r.skipBits(1); const dolbyVision = !!r.read(1); const hdrFlags = r.read(2);
      r.skipBits(8); r.skipBits(32);
      uhd = { discType, exists4k, hdrFlags, hdr10Plus, dolbyVision, source: sourceFor(file, "", origin, payload) };
      r.seek(start + 12);
    }
  }
  return uhd;
}

export function parseIndex(data: Uint8Array, file: FileEntry, origin: "primary" | "backup", warn: Warn = ignoreWarning): ParsedFile<ParsedIndex> {
  const r = new Bits(data);
  r.checkMagic("INDX"); const version = r.version(); const section = r.u32(); const ext = r.u32();
  if (section < 40 || section >= data.length) throw new ContractError("BDMV_INVALID_SECTION", "/indexOffset", `Invalid index section offset ${section}`);
  if (ext && ext >= data.length) throw new ContractError("BDMV_INVALID_SECTION", "/extensionOffset", `Invalid extension offset ${ext}`);
  // AppInfo and the UHD extension are optional metadata: a damaged HDR field must
  // not make a playable disc unreadable, so only the main index section stays critical.
  const appInfo = optionalSection("INDEX app info", data, file, warn, 40, (cursor) => parseIndexAppInfo(cursor, data.length, file, origin, section));
  const uhd = ext ? optionalSection("INDEX extension", data, file, warn, ext, (cursor) => parseIndexUhdExtension(cursor, data.length, file, origin, ext, warn)) : null;
  r.seek(section);
  const blockLength = r.u32(); if (blockLength > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/indexLength", "Index section exceeds file");
  const end = r.offset + blockLength;
  if (blockLength < 26) throw new ContractError("BDMV_INVALID_SECTION", "/indexLength", "Index section is too short for First Play, Top Menu and title count");
  const parseTarget = (title = false): EntryTarget => {
    const start = r.offset; const type = r.read(2); const access = title ? r.read(2) : undefined;
    if (title) r.skipBits(28); else r.skipBits(30);
    let playbackType: number; let target: number | string | null; let objectType: EntryTarget["objectType"];
    if (type === 1) { objectType = "HDMV"; playbackType = r.read(2); r.skipBits(14); target = r.read(16); r.skipBits(32); }
    else if (type === 2) { objectType = "BDJ"; playbackType = r.read(2); r.skipBits(14); target = r.text(5); r.skip(1); }
    // libbluray aborts the whole index on an unknown object type; skipping an
    // assumed body length would silently misalign every following title.
    else throw new ContractError("BDMV_UNKNOWN_OBJECT_TYPE", `/offset/${start}`, `Unknown index object type ${type}`);
    return { objectType, playbackType, target, ...(access === undefined ? {} : { accessType: access }), source: sourceFor(file, "", origin, start) };
  };
  const entries = [parseTarget(), parseTarget()];
  const countOffset = r.offset; const count = r.u16();
  if (count > Math.floor((end - r.offset) / 12)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, `Title count ${count} exceeds index section`);
  for (let i = 0; i < count; i++) entries.push(parseTarget(true));
  return { value: { entries, appInfo, uhd }, version, raw: data };
}

export function parseMobj(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<MovieObject[]> {
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
      instructions.push({ words: [new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false), new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, false), new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, false)] as [number, number, number], bytes: hex(bytes), source: { ...sourceFor(file, "", origin, offset), instructionIndex: j } });
    }
    result.push({ id: i, resumeIntention, menuCallMask, titleSearchMask, instructions, source: sourceFor(file, "", origin, start) });
    if (r.offset <= start) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${start}`, "MOBJ parser did not advance");
  }
  return { value: result, version, raw: data };
}

function parseBdjo(data: Uint8Array, file: FileEntry, origin: "primary" | "backup"): ParsedFile<NonNullable<ParsedDisc["bdjos"]>[number]> {
  const r = new Bits(data); r.checkMagic("BDJO"); const version = r.version(); r.skip(40);
  const utf8 = (section: Bits, length: number): string => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(section.bytes(length)); }
    catch { throw new ContractError("BDMV_INVALID_TEXT", `/offset/${section.absolute}`, "BDJO string is not valid UTF-8"); }
  };
  const lengthSection = (label: string): Bits => {
    const at = r.offset; const length = r.u32();
    if (length > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${at}`, `BDJO ${label} section exceeds file`);
    return r.sub(length);
  };
  const terminalSection = lengthSection("terminal info"); const terminalOffset = terminalSection.absolute;
  const defaultFont = terminalSection.text(5); const initialHaviConfigId = terminalSection.read(4); const menuCallMask = !!terminalSection.read(1); const titleSearchMask = !!terminalSection.read(1); terminalSection.skipBits(34);
  const terminalInfo = { defaultFont, initialHaviConfigId, menuCallMask, titleSearchMask, source: sourceFor(file, "", origin, terminalOffset) };
  const cacheSection = lengthSection("app cache"); const cacheOffset = cacheSection.absolute; const cacheCount = cacheSection.u8(); cacheSection.skip(1);
  if (cacheCount > Math.floor(cacheSection.length / 12)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${cacheOffset}`, "BDJO app cache count exceeds section");
  const appCache = [] as NonNullable<ParsedDisc["bdjos"]>[number]["appCache"];
  for (let index = 0; index < cacheCount; index++) { const source = cacheSection.source(file.rel, origin); const type = cacheSection.u8(); const reference = cacheSection.text(5); const language = cacheSection.text(3); cacheSection.skip(3); appCache.push({ type, reference, language, source }); }
  const playlistSection = lengthSection("accessible playlists"); const playlistOffset = playlistSection.absolute;
  const playlistCount = playlistSection.read(11); const accessToAll = !!playlistSection.read(1); const autostartFirst = !!playlistSection.read(1); playlistSection.skipBits(19);
  if (playlistCount > Math.floor(playlistSection.length / 6)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${playlistOffset}`, "BDJO accessible playlist count exceeds section");
  const playlistIds: string[] = []; for (let index = 0; index < playlistCount; index++) { playlistIds.push(playlistSection.text(5)); playlistSection.skip(1); }
  const accessiblePlaylists = { accessToAll, autostartFirst, playlistIds, source: sourceFor(file, "", origin, playlistOffset) };
  const appSection = lengthSection("application management"); const applicationCount = appSection.u8(); appSection.skip(1);
  const applications: NonNullable<ParsedDisc["bdjos"]>[number]["applications"] = [];
  const readAppString = (): string => { const length = appSection.u8(); const result = utf8(appSection, length); if ((length & 1) === 0) appSection.skip(1); return result; };
  for (let appIndex = 0; appIndex < applicationCount; appIndex++) {
    const source = appSection.source(file.rel, origin); const controlCode = appSection.u8(); const type = appSection.read(4); appSection.skipBits(4); const organizationId = appSection.u32(); const applicationId = appSection.u16(); appSection.skip(10);
    const profileCount = appSection.read(4); appSection.skipBits(12); const profiles = [] as NonNullable<ParsedDisc["bdjos"]>[number]["applications"][number]["profiles"];
    if (profileCount > Math.floor(appSection.length / 6)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${appSection.absolute}`, "BDJO profile count exceeds application section");
    for (let index = 0; index < profileCount; index++) { const number = appSection.u16(); const major = appSection.u8(); const minor = appSection.u8(); const micro = appSection.u8(); appSection.skip(1); profiles.push({ number, major, minor, micro }); }
    const priority = appSection.u8(); const binding = appSection.read(2); const visibility = appSection.read(2); appSection.skipBits(4);
    const namesLength = appSection.u16(); if (namesLength > appSection.length - appSection.offset) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${appSection.absolute}`, "BDJO application names exceed section");
    const namesSection = appSection.sub(namesLength); const names: Array<{ language: string; name: string }> = [];
    while (namesSection.offset < namesSection.length) { if (namesSection.length - namesSection.offset < 4) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${namesSection.absolute}`, "BDJO application name is truncated"); const language = namesSection.text(3); const nameLength = namesSection.u8(); names.push({ language, name: utf8(namesSection, nameLength) }); }
    if ((namesLength & 1) === 1) appSection.skip(1);
    const iconLocator = readAppString(); const iconFlags = appSection.u16(); const basePath = readAppString(); const classPath = readAppString(); const initialClass = readAppString();
    const parametersLength = appSection.u8(); if (parametersLength > appSection.length - appSection.offset) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${appSection.absolute}`, "BDJO application parameters exceed section");
    const parametersSection = appSection.sub(parametersLength); const parameters: string[] = [];
    while (parametersSection.offset < parametersSection.length) { const length = parametersSection.u8(); parameters.push(utf8(parametersSection, length)); }
    if ((parametersLength & 1) === 0) appSection.skip(1);
    applications.push({ organizationId, applicationId, controlCode, type, profiles, priority, binding, visibility, names, iconLocator, iconFlags, basePath, classPath, initialClass, parameters, source });
  }
  const keyOffset = r.offset; const keyInterest: BdjoInfo["keyInterest"] = {
    play: !!r.read(1), stop: !!r.read(1), fastForward: !!r.read(1), rewind: !!r.read(1), nextTrack: !!r.read(1), previousTrack: !!r.read(1), pause: !!r.read(1), stillOff: !!r.read(1), secondaryAudioToggle: !!r.read(1), secondaryVideoToggle: !!r.read(1), textSubtitleToggle: !!r.read(1),
    source: sourceFor(file, "", origin, keyOffset),
  };
  r.skipBits(21);
  const fileAccessOffset = r.offset; const fileAccessLength = r.u16(); const rawAccessPath = utf8(r, fileAccessLength);
  const fileAccessPaths = rawAccessPath.split(";").filter((path) => path.length > 0).map((path) => ({ path, source: sourceFor(file, "", origin, fileAccessOffset) }));
  const value = { path: bdmvRelativePath(file.rel), version, terminalInfo, appCache, accessiblePlaylists, applications, keyInterest, fileAccessPaths, source: sourceFor(file, "", origin, 0) };
  return { value, version, raw: data };
}

interface XmlNode { name: string; attributes: Record<string, string>; content: Array<string | XmlNode>; offset: number; }
function xmlByteOffsets(xml: string): Uint32Array {
  const offsets = new Uint32Array(xml.length + 1); let byte = 0;
  for (let index = 0; index < xml.length;) {
    offsets[index] = byte; const point = xml.codePointAt(index)!; const width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; const units = point > 0xffff ? 2 : 1;
    if (units === 2) offsets[index + 1] = byte;
    byte += width; index += units; offsets[index] = byte;
  }
  return offsets;
}
function decodeXmlEntities(value: string): string {
  let output = "";
  for (let index = 0; index < value.length;) {
    if (value[index] !== "&") { output += value[index++]; continue; }
    const end = value.indexOf(";", index + 1); if (end < 0) throw new ContractError("BDMV_INVALID_XML", "/xml/entity", "XML entity reference is not terminated");
    const entity = value.slice(index + 1, end); let decoded: string;
    if (entity === "amp") decoded = "&"; else if (entity === "lt") decoded = "<"; else if (entity === "gt") decoded = ">"; else if (entity === "quot") decoded = "\""; else if (entity === "apos") decoded = "'";
    else if (/^#\d+$/.test(entity) || /^#x[\da-f]+$/i.test(entity)) {
      const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code < 0x20 && ![9, 10, 13].includes(code)) || code === 0xfffe || code === 0xffff) throw new ContractError("BDMV_INVALID_XML", "/xml/entity", "XML numeric entity is outside the allowed character range");
      decoded = String.fromCodePoint(code);
    } else throw new ContractError("BDMV_INVALID_XML", "/xml/entity", `XML entity &${entity}; is unsupported`);
    output += decoded; index = end + 1;
  }
  return output;
}
function parseXmlDocument(bytes: Uint8Array): XmlNode {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ContractError("BDMV_INVALID_XML", "/xml", "META/DL manifest is not valid UTF-8"); }
  const byteOffsets = xmlByteOffsets(xml); const stack: XmlNode[] = []; let root: XmlNode | null = null; let nodeCount = 0; let cursor = xml.startsWith("\uFEFF") ? 1 : 0;
  const fail = (message: string, at = cursor): never => { throw new ContractError("BDMV_INVALID_XML", `/xml/${byteOffsets[at] ?? 0}`, message); };
  const readName = (text: string, start: number): { name: string; end: number } => {
    const match = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(text.slice(start)); if (match === null) return fail("XML name is missing", start); return { name: match[0], end: start + match[0].length };
  };
  const appendText = (text: string, at: number): void => {
    if (!stack.length) { if (text.trim() !== "" && text !== "\uFEFF") fail("Text appears outside the XML root", at); return; }
    stack[stack.length - 1]!.content.push(decodeXmlEntities(text));
  };
  while (cursor < xml.length) {
    if (xml[cursor] !== "<") { const next = xml.indexOf("<", cursor); const end = next < 0 ? xml.length : next; appendText(xml.slice(cursor, end), cursor); cursor = end; continue; }
    if (xml.startsWith("<!--", cursor)) { const end = xml.indexOf("-->", cursor + 4); if (end < 0) fail("XML comment is not closed"); if (xml.slice(cursor + 4, end).includes("--")) fail("XML comment contains an invalid double hyphen"); cursor = end + 3; continue; }
    if (xml.startsWith("<?", cursor)) { const end = xml.indexOf("?>", cursor + 2); if (end < 0) fail("XML processing instruction is not closed"); cursor = end + 2; continue; }
    if (xml.startsWith("<![CDATA[", cursor)) { if (!stack.length) fail("CDATA appears outside the XML root"); const end = xml.indexOf("]]>", cursor + 9); if (end < 0) fail("XML CDATA section is not closed"); stack[stack.length - 1]!.content.push(xml.slice(cursor + 9, end)); cursor = end + 3; continue; }
    if (xml.startsWith("</", cursor)) {
      const name = readName(xml, cursor + 2); let end = name.end; while (/\s/.test(xml[end] ?? "")) end++;
      if (xml[end] !== ">") fail("XML end tag is malformed", end);
      const open = stack.pop(); if (!open || open.name !== name.name) fail(`XML end tag ${name.name} does not match its start tag`, cursor);
      cursor = end + 1; continue;
    }
    if (xml.startsWith("<!", cursor)) {
      if (/^<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml.slice(cursor))) fail("META/DL DTD and entity declarations are not supported", cursor);
      fail("Unsupported XML declaration", cursor);
    }
    let end = cursor + 1; let quote = "";
    for (; end < xml.length; end++) { const char = xml[end]!; if (quote) { if (char === quote) quote = ""; } else if (char === "\"" || char === "'") quote = char; else if (char === ">") break; }
    if (end >= xml.length) fail("XML start tag is not closed", cursor);
    const tag = xml.slice(cursor + 1, end); let pos = 0; while (/\s/.test(tag[pos] ?? "")) pos++;
    const parsedName = readName(tag, pos); const name = parsedName.name; pos = parsedName.end; const attributes: Record<string, string> = {}; let selfClosing = false;
    for (;;) {
      while (/\s/.test(tag[pos] ?? "")) pos++;
      if (pos >= tag.length) break;
      if (tag[pos] === "/") { selfClosing = true; pos++; while (/\s/.test(tag[pos] ?? "")) pos++; if (pos !== tag.length) fail("XML self-closing tag has trailing content", cursor + pos); break; }
      const attr = readName(tag, pos); pos = attr.end; if (Object.hasOwn(attributes, attr.name)) fail(`XML attribute ${attr.name} is duplicated`, cursor + pos);
      while (/\s/.test(tag[pos] ?? "")) pos++; if (tag[pos++] !== "=") fail(`XML attribute ${attr.name} has no value`, cursor + pos);
      while (/\s/.test(tag[pos] ?? "")) pos++; const delimiter = tag[pos++]; if (delimiter !== "\"" && delimiter !== "'") fail(`XML attribute ${attr.name} is not quoted`, cursor + pos);
      const valueStart = pos; while (pos < tag.length && tag[pos] !== delimiter) { if (tag[pos] === "<") fail("XML attribute contains a less-than character", cursor + pos); pos++; }
      if (pos >= tag.length) fail(`XML attribute ${attr.name} is not closed`, cursor + pos);
      attributes[attr.name] = decodeXmlEntities(tag.slice(valueStart, pos)); pos++;
    }
    const node: XmlNode = { name, attributes, content: [], offset: byteOffsets[cursor] ?? 0 }; nodeCount++; if (nodeCount > 100_000) fail("META/DL XML contains too many elements", cursor);
    if (stack.length >= 256) fail("META/DL XML nesting exceeds 256 elements", cursor);
    if (stack.length) stack[stack.length - 1]!.content.push(node); else { if (root) fail("XML contains more than one root element", cursor); root = node; }
    if (!selfClosing) stack.push(node); cursor = end + 1;
  }
  if (stack.length) fail(`XML element ${stack[stack.length - 1]!.name} is not closed`, xml.length);
  if (!root) fail("XML document has no root element", xml.length);
  return root!;
}
function xmlNodeText(node: XmlNode): string { return node.content.map((part) => typeof part === "string" ? part : xmlNodeText(part)).join("").trim(); }
function xmlLocalName(name: string): string { const separator = name.lastIndexOf(":"); return separator < 0 ? name : name.slice(separator + 1); }
function xmlDescendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const part of node.content) if (typeof part !== "string") { if (xmlLocalName(part.name) === name) found.push(part); found.push(...xmlDescendants(part, name)); }
  return found;
}
function metaField(parent: XmlNode, name: string): XmlNode | undefined { return parent.content.find((part): part is XmlNode => typeof part !== "string" && xmlLocalName(part.name) === name); }
function metaInteger(text: string | undefined): number | null { return text !== undefined && /^\d+$/.test(text.trim()) ? Number(text.trim()) : null; }
function parseMetaDl(data: Uint8Array, file: FileEntry, origin: "primary" | "backup", language: string): ParsedFile<NonNullable<ParsedDisc["metadata"]>[number]> {
  const root = parseXmlDocument(data); const titles: NonNullable<ParsedDisc["metadata"]>[number]["titles"] = []; const thumbnails: NonNullable<ParsedDisc["metadata"]>[number]["thumbnails"] = [];
  let discName: string | null = null; let alternativeName: string | null = null; let numberOfSets: number | null = null; let setNumber: number | null = null;
  for (const title of xmlDescendants(root, "title")) {
    discName = xmlNodeText(metaField(title, "name") ?? { name: "", attributes: {}, content: [], offset: title.offset }) || discName;
    alternativeName = xmlNodeText(metaField(title, "alternative") ?? { name: "", attributes: {}, content: [], offset: title.offset }) || alternativeName;
    numberOfSets = metaInteger(metaField(title, "numSets") ? xmlNodeText(metaField(title, "numSets")!) : undefined) ?? numberOfSets;
    setNumber = metaInteger(metaField(title, "setNumber") ? xmlNodeText(metaField(title, "setNumber")!) : undefined) ?? setNumber;
  }
  for (const toc of xmlDescendants(root, "tableOfContents")) for (const titleName of toc.content.filter((part): part is XmlNode => typeof part !== "string" && xmlLocalName(part.name) === "titleName")) {
    const titleNumber = metaInteger(titleName.attributes["titleNumber"]); if (titleNumber !== null) titles.push({ titleNumber, titleName: xmlNodeText(titleName), source: sourceFor(file, "", origin, titleName.offset) });
  }
  for (const description of xmlDescendants(root, "description")) for (const thumbnail of description.content.filter((part): part is XmlNode => typeof part !== "string" && xmlLocalName(part.name) === "thumbnail")) {
    const href = thumbnail.attributes.href; if (href === undefined) continue; const size = thumbnail.attributes.size ?? null; const match = size ? /^(\d+)\s*x\s*(\d+)$/i.exec(size) : null;
    thumbnails.push({ href, size, width: match?.[1] ? Number(match[1]) : null, height: match?.[2] ? Number(match[2]) : null, source: sourceFor(file, "", origin, thumbnail.offset) });
  }
  return { value: { language, discName, alternativeName, numberOfSets, setNumber, titles, thumbnails, source: sourceFor(file, "", origin, 0) }, version: "xml", raw: data };
}

export function parseMpls(data: Uint8Array, file: FileEntry, origin: "primary" | "backup", warn: Warn = ignoreWarning): ParsedFile<Playlist> {
  const r = new Bits(data); r.checkMagic("MPLS"); const version = r.version(); const listPos = r.u32(); const markPos = r.u32(); const extPos = r.u32();
  r.skip(20); const appLenOffset = r.offset; const appLen = r.u32(); if (appLen > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/appInfoLength", "MPLS app info exceeds file");
  const appEnd = r.offset + appLen;
  let appInfo: PlaylistAppInfo | null;
  if (appLen === 0) appInfo = null;
  else {
    // Twelve bytes are the minimum for the reserved byte through the UO mask;
    // the flag byte is read when declared, matching libbluray's tolerance here.
    if (appLen < 12) throw new ContractError("BDMV_INVALID_SECTION", "/appInfoLength", "MPLS app info is too short for its fixed fields");
    r.skip(1); const playbackType = r.u8();
    let playbackCount: number | null = null;
    if (playbackType === 2 || playbackType === 3) playbackCount = r.u16(); else r.skip(2);
    const uoMask = ((BigInt(r.u32()) << 32n) | BigInt(r.u32())).toString();
    const flags = appLen >= 13 ? r.u8() : 0;
    appInfo = {
      playbackType, playbackCount, uoMask,
      randomAccessFlag: ((flags >> 7) & 1) === 1, audioMixFlag: ((flags >> 6) & 1) === 1, losslessBypassFlag: ((flags >> 5) & 1) === 1,
      mvcBaseViewRFlag: ((flags >> 4) & 1) === 1, sdrConversionNotificationFlag: ((flags >> 3) & 1) === 1,
      source: sourceFor(file, "", origin, appLenOffset),
    };
  }
  if (r.offset > appEnd) throw new ContractError("BDMV_INVALID_SECTION", "/appInfo", "MPLS app info fields exceed section");
  r.seek(appEnd);
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
    const attrBytes = [0x90,0x91,0xa0,0x92,3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType) ? 4 : [1,2,0xea,0x1b].includes(codingType) ? 4 : codingType === 0x24 ? 4 : 0;
    if (context.offset + attrBytes > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${source.offset}`, "MPLS coding attributes exceed stream record");
    let dynamicRangeType: number | null = null; let colorSpace: number | null = null; let videoAttributes: StreamDeclaration["videoAttributes"];
    if ([0x90,0x91,0xa0].includes(codingType)) { language = context.text(3); context.skip(1); }
    else if (codingType === 0x92) { context.skip(1); language = context.text(3); }
    else if ([3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType)) { context.skip(1); language = context.text(3); }
    else if ([1,2,0xea,0x1b].includes(codingType)) {
      const formatFrame = context.u8(); videoAttributes = { videoFormat: formatFrame >>> 4, frameRate: formatFrame & 0x0f, dynamicRangeType: null, colorSpace: null };
    }
    else if (codingType === 0x24) {
      const formatFrame = context.u8();
      dynamicRangeType = context.read(4); colorSpace = context.read(4);
      const crFlag = !!context.read(1); const hdrPlus = !!context.read(1);
      videoAttributes = { videoFormat: formatFrame >>> 4, frameRate: formatFrame & 0x0f, dynamicRangeType, colorSpace, crFlag, hdrPlus };
    }
    if (context.offset > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${source.offset}`, "MPLS stream attributes exceed record"); context.seek(attrEnd);
    return { streamType, pid, subPathId, subClipId, codingType, language, dynamicRangeType, colorSpace, ...(videoAttributes ? { videoAttributes } : {}), source };
  };
  for (let i = 0; i < itemCount; i++) {
    const recordStart = r.offset; const itemLen = r.u16(); const end = r.offset + itemLen;
    if (end > listEnd || itemLen < 48) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${recordStart}`, "PlayItem exceeds playlist section or is too short for fixed fields");
    const source = r.source(file.rel, origin); const clipId = r.text(5); const codecId = r.text(4); r.skipBits(11);
    const multiAngle = !!r.read(1); const connectionCondition = r.read(4); const stcId = r.u8(); const inTime45k = r.u32(); const outTime45k = r.u32(); const uoMask = ((BigInt(r.u32()) << 32n) | BigInt(r.u32())).toString(); r.skipBits(1); r.skipBits(7); const stillMode = r.u8(); const stillTime = r.u16();
    if (r.offset > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem fixed fields exceed record");
    let angleCount = 1; let differentAudio = false; let seamlessAngle = false;
    const angles: NonNullable<PlayItem["angles"]> = [{ index: 0, clipId, codecId, stcId, source: sourceFor(file, "", origin, recordStart) }];
    if (multiAngle) {
      if (r.offset + 1 > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem angle count exceeds record");
      angleCount = Math.max(1, r.u8()); const angleBytes = 1 + (angleCount - 1) * 10;
      if (r.offset + angleBytes > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem angle records exceed record");
      r.skipBits(6); differentAudio = !!r.read(1); seamlessAngle = !!r.read(1);
      for (let angleIndex = 1; angleIndex < angleCount; angleIndex++) { const angleOffset = r.offset; angles.push({ index: angleIndex, clipId: r.text(5), codecId: r.text(4), stcId: r.u8(), source: sourceFor(file, "", origin, angleOffset) }); }
    }
    if (r.offset + 2 > end) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${recordStart}`, "PlayItem has no bounded STN length");
    const stnLen = r.u16(); const stnStart = r.offset; const stnEnd = stnStart + stnLen; if (stnEnd > end || stnLen < 14) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN section exceeds PlayItem or is too short for its header"); r.skip(2); const counts = Array.from({ length: 8 }, () => r.u8()); r.skip(4); if (r.offset > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN header exceeds STN section");
    const streams: StreamDeclaration[] = []; const total = counts.reduce((a, b) => a + b, 0);
    if (total > Math.floor((stnEnd - r.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${stnStart}`, "STN count exceeds STN section");
    const categories = ["primaryVideo", "primaryAudio", "primaryPresentationGraphics", "primaryInteractiveGraphics", "secondaryAudio", "secondaryVideo", "secondaryPresentationGraphics", "dolbyVision"] as const;
    const readReferences = (label: string): number[] => {
      if (r.offset + 2 > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.absolute}`, `MPLS ${label} reference header exceeds STN section`);
      const count = r.u8(); r.skip(1); if (count > stnEnd - r.offset) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.absolute}`, `MPLS ${label} reference count exceeds STN section`);
      const references = Array.from(r.bytes(count)); if (count & 1) { if (r.offset + 1 > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.absolute}`, `MPLS ${label} reference padding exceeds STN section`); r.skip(1); }
      return references;
    };
    for (let categoryIndex = 0; categoryIndex < counts.length; categoryIndex++) for (let localIndex = 0; localIndex < counts[categoryIndex]!; localIndex++) {
      const stream = parseStream(r, stnEnd); const categorized: StreamDeclaration = { ...stream, category: categories[categoryIndex]!, categoryIndex: localIndex };
      if (categories[categoryIndex] === "secondaryAudio") categorized.primaryAudioReferences = readReferences("secondary audio");
      else if (categories[categoryIndex] === "secondaryVideo") { categorized.secondaryAudioReferences = readReferences("secondary video audio"); categorized.presentationGraphicsReferences = readReferences("secondary video PIP graphics"); }
      streams.push(categorized);
    }
    if (r.offset > stnEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${stnStart}`, "STN records exceed section"); r.seek(stnEnd); r.seek(end);
    if (outTime45k < inTime45k) throw new ContractError("BDMV_INVALID_TIME_RANGE", `/offset/${recordStart}`, "PlayItem OUT precedes IN");
    playItems.push({ index: i, clipId, codecId, stcId, inTime45k, outTime45k, connectionCondition, multiAngle, angleCount, differentAudio, seamlessAngle, uoMask, stillMode, stillTime, streams, angles, source });
  }
  const subPaths: SubPath[] = [];
  for (let i = 0; i < subCount; i++) {
    const start = r.offset; const len = r.u32(); const end = r.offset + len; if (end > listEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath exceeds playlist section");
    if (len < 6) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath is too short for its header");
    const source = r.source(file.rel, origin); r.skip(1); const type = r.u8(); const flags = r.u16(); const repeat = !!(flags & 0x8000); r.skip(1); const count = r.u8(); const items = [];
    if (r.offset > end) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${start}`, "SubPath header exceeds SubPath section");
    if (count > Math.floor((end - r.offset) / 2)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${start}`, "SubPlayItem count exceeds SubPath");
    for (let j = 0; j < count; j++) {
      const rec = r.offset;
      if (r.offset + 2 > end) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem length is outside SubPath");
      const itemLen = r.u16(); const itemEnd = r.offset + itemLen;
      if (itemEnd > end || itemLen < 28) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem exceeds SubPath or is too short for fixed fields");
      const itemSource = r.source(file.rel, origin); const clipId = r.text(5); const codecId = r.text(4);
      r.skipBits(27); const connectionCondition = r.read(4); const multiClip = !!r.read(1); const stcId = r.u8();
      const inTime45k = r.u32(); const outTime45k = r.u32(); const syncPlayItemId = r.u16(); const syncPts45k = r.u32();
      const clips = [{ clipId, codecId, stcId }];
      if (multiClip) {
        if (r.offset + 1 > itemEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem multi-clip count is outside record");
        const clipCount = Math.max(1, r.u8());
        if (clipCount - 1 > Math.floor((itemEnd - r.offset) / 10)) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${rec}`, "SubPlayItem multi-clip records exceed record");
        for (let clipIndex = 1; clipIndex < clipCount; clipIndex++) clips.push({ clipId: r.text(5), codecId: r.text(4), stcId: r.u8() });
      }
      if (r.offset > itemEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${rec}`, "SubPlayItem fields exceed record");
      r.seek(itemEnd); items.push({ clipId, codecId, connectionCondition, stcId, multiClip, clips, inTime45k, outTime45k, syncPlayItemId, syncPts45k, source: itemSource });
    }
    r.seek(end); subPaths.push({ type, repeat, items, source });
  }
  r.seek(markPos); const markLen = r.u32(); const markEnd = r.offset + markLen; if (markEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/markLength", "PlayMark section exceeds file"); const markCount = r.u16();
  if (markCount > Math.floor((markEnd - r.offset) / 14)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 2}`, "PlayMark count exceeds section");
  const marks: PlayMark[] = [];
  for (let i = 0; i < markCount; i++) { const source = r.source(file.rel, origin); r.skip(1); const type = r.u8(); const playItemRef = r.u16(); const time45k = r.u32(); const entryEsPid = r.u16(); const duration45k = r.u32(); marks.push({ index: i, type, playItemRef, time45k, entryEsPid, duration45k, source }); }
  const extensionData = extPos ? optionalSection("MPLS ExtensionData", data, file, warn, extPos, () => parseExtensionData(data, extPos, file, origin, version, warn)) ?? [] : [];
  return { value: { id: file.rel.split("/").pop()!.replace(/\.mpls$/i, ""), version, appInfo, playItems, marks, subPaths, extensionData, source: sourceFor(file, "", origin, 0) }, version, raw: data };
}

export function parseClpi(data: Uint8Array, file: FileEntry, origin: "primary" | "backup", warn: Warn = ignoreWarning): ParsedFile<ClipInfo> {
  const r = new Bits(data); r.checkMagic("HDMV"); const version = r.version(); const seqPos = r.u32(); const programPos = r.u32(); const cpiPos = r.u32(); const markPos = r.u32(); const extPos = r.u32();
  for (const [name, pos] of [["sequence", seqPos], ["program", programPos], ["cpi", cpiPos], ["mark", markPos], ["extension", extPos]] as const) if (pos && pos >= data.length) throw new ContractError("BDMV_INVALID_SECTION", `/${name}Offset`, `${name} offset exceeds file`);
  r.seek(40); const infoStart = 40; const infoLen = r.u32(); const infoEnd = r.offset + infoLen;
  if (infoLen > data.length - r.offset) throw new ContractError("BDMV_INVALID_SECTION", "/clipInfoLength", "CLPI clip info exceeds file");
  let header: ClipHeader | null = null;
  if (infoLen >= 16) {
    r.skip(2); const streamType = r.u8(); const applicationType = r.u8();
    const flags = r.u32(); const tsRecordingRate = r.u32(); const sourcePacketCount = r.u32();
    let tsTypeId: string | null = null; let tsTypeValidity: number | null = null; const atcDeltaEntries: NonNullable<ClipHeader["atcDeltaEntries"]> = []; const fontFiles: string[] = [];
    // TS type info follows the 128 reserved bytes; it is absent in older layouts.
    if (infoLen >= 146) {
      const tsTypeOffset = infoStart + 4 + 144;
      r.seek(tsTypeOffset); const tsTypeLength = r.u16();
      // A self-inconsistent length field is a diagnostic, not a reason to drop the
      // whole clip: libbluray reads the TS type id without consulting `infoLen` (P1-P2-2).
      if (tsTypeLength > 0 && (tsTypeLength < 5 || tsTypeLength > data.length - r.offset)) {
        warn("BDMV_DECLARED_LENGTH_MISMATCH", `CLPI TS type info declares ${tsTypeLength} bytes, which does not fit the remaining ${data.length - r.offset} bytes; the TS type id was skipped`, file, tsTypeOffset);
      } else if (tsTypeLength >= 5 && tsTypeOffset + 2 + tsTypeLength <= infoEnd) { tsTypeValidity = r.u8(); tsTypeId = r.text(4); }
      else if (tsTypeLength > 0) warn("BDMV_DECLARED_LENGTH_MISMATCH", `CLPI TS type info exceeds its ${infoLen}-byte ClipInfo section`, file, tsTypeOffset);
      const tsTypeEnd = Math.min(infoEnd, tsTypeOffset + 2 + tsTypeLength);
      if (tsTypeEnd <= infoEnd) r.seek(tsTypeEnd);
    }
    try {
      if ((flags & 1) === 1) {
        if (r.offset + 2 > infoEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.offset}`, "CLPI ATC delta header exceeds ClipInfo section");
        r.skip(1); const countOffset = r.offset; const count = r.u8();
        if (count > Math.floor((infoEnd - r.offset) / 14)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, "CLPI ATC delta count exceeds ClipInfo section");
        for (let index = 0; index < count; index++) { const offset = r.offset; const delta = r.u32(); const fileId = r.text(5); const fileCode = r.text(4); r.skip(1); atcDeltaEntries.push({ delta, fileId, fileCode, source: sourceFor(file, "", origin, offset) }); }
      }
      if (applicationType === 6 && r.offset < infoEnd) {
        if (r.offset + 2 > infoEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.offset}`, "CLPI font table header exceeds ClipInfo section");
        r.skip(1); const countOffset = r.offset; const count = r.u8();
        if (count > Math.floor((infoEnd - r.offset) / 6)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, "CLPI font count exceeds ClipInfo section");
        for (let index = 0; index < count; index++) { fontFiles.push(r.text(5)); r.skip(1); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(error instanceof ContractError ? error.code : "BDMV_PARSE_ERROR", `CLPI optional ATC delta/font information was skipped (${message})`, file, Number(/(?:offset\/|at )([0-9]+)/.exec(message)?.[1] ?? r.offset));
    }
    if (r.offset > infoEnd) throw new ContractError("BDMV_INVALID_RECORD", "/clipInfoLength", "CLPI clip info fields exceed section");
    header = { streamType, applicationType, tsRecordingRate, sourcePacketCount, atcDelta: (flags & 1) === 1, tsTypeId, tsTypeValidity, atcDeltaEntries, fontFiles, source: sourceFor(file, "", origin, infoStart) };
  }
  r.seek(infoEnd);
  const sequence: AtcSequence[] = [];
  if (seqPos) {
    r.seek(seqPos); const seqLen = r.u32(); const seqEnd = r.offset + seqLen;
    // The record layout is self-describing (ATC/STC counts), so an inconsistent
    // length field is recorded and the records are read up to the file boundary.
    const declaredFits = seqLen >= 2 && seqEnd <= data.length;
    if (!declaredFits) warn("BDMV_DECLARED_LENGTH_MISMATCH", `CLPI sequence info declares ${seqLen} bytes at ${seqPos}, which does not fit the ${data.length}-byte file; the file boundary was used`, file, seqPos);
    const sequenceLimit = data.length;
    r.skip(1); const atcCountOffset = r.offset; const atcCount = r.u8();
    if (atcCount > Math.floor((sequenceLimit - r.offset) / 6)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${atcCountOffset}`, "CLPI ATC sequence count exceeds file");
    for (let i = 0; i < atcCount; i++) {
      const source = r.source(file.rel, origin);
      const spnAtcStart = r.u32(); const stcCountOffset = r.offset; const stcCount = r.u8(); const offsetStcId = r.u8();
      if (stcCount > Math.floor((sequenceLimit - r.offset) / 14)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${stcCountOffset}`, "CLPI STC sequence count exceeds file");
      const stcs: StcSequence[] = [];
      for (let j = 0; j < stcCount; j++) stcs.push({ pcrPid: r.u16(), spnStcStart: r.u32(), presentationStartPts: r.u32(), presentationEndPts: r.u32() });
      sequence.push({ spnAtcStart, offsetStcId, stcs, source });
    }
    r.seek(declaredFits ? seqEnd : sequenceLimit);
  }
  const programs: ClipInfo["programs"] = [];
  if (programPos) {
    r.seek(programPos); const pLen = r.u32(); const pEnd = r.offset + pLen; if (pEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/programInfoLength", "CLPI program info exceeds file"); r.skip(1); const count = r.u8(); if (r.offset > pEnd) throw new ContractError("BDMV_INVALID_SECTION", "/programInfoLength", "CLPI program info header exceeds section");
    if (count > Math.floor((pEnd - r.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 1}`, "CLPI program count exceeds section");
    for (let i = 0; i < count; i++) {
      const start = r.offset; const sequenceStartSpn = r.u32(); const programMapPid = r.u16(); const streamCount = r.u8(); const groupCount = r.u8();
      if (streamCount > Math.floor((pEnd - r.offset) / 3)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${start}`, "CLPI stream count exceeds program section");
      const streams: ClipInfo["programs"][number]["streams"] = [];
      for (let j = 0; j < streamCount; j++) {
        const streamOffset = r.offset; if (r.offset + 3 > pEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${streamOffset}`, "CLPI stream header exceeds ProgramInfo section"); const pid = r.u16(); const attrLen = r.u8(); const attrEnd = r.offset + attrLen; if (attrEnd > pEnd || r.offset >= attrEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${streamOffset}`, "CLPI stream attributes exceed ProgramInfo section or omit coding type"); const codingType = r.u8(); let language: string | null = null; let charCode: number | undefined;
        const attrBytes = [3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2,0x92].includes(codingType) ? 4 : [0x90,0x91,0xa0].includes(codingType) ? 4 : [1,2,0xea,0x1b,0x20,0x24].includes(codingType) ? 4 : 0;
        if (r.offset + attrBytes > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${streamOffset}`, "CLPI coding attributes exceed stream record");
        let dynamicRangeType: number | null = null; let colorSpace: number | null = null; let videoAttributes: StreamDeclaration["videoAttributes"]; let isrc: string | undefined;
        if ([3,4,0x80,0x81,0x82,0x83,0x84,0x85,0x86,0xa1,0xa2].includes(codingType)) { r.skip(1); language = r.text(3); }
        else if ([0x90,0x91,0xa0].includes(codingType)) { language = r.text(3); r.skip(1); }
        else if (codingType === 0x92) { charCode = r.u8(); language = r.text(3); }
        else if ([1,2,0xea,0x1b,0x20].includes(codingType)) {
          const formatFrame = r.u8(); const aspectRatio = r.read(4); r.skipBits(2); const ocFlag = !!r.read(1); r.skipBits(17);
          videoAttributes = { videoFormat: formatFrame >>> 4, frameRate: formatFrame & 0x0f, aspectRatio, ocFlag, dynamicRangeType: null, colorSpace: null };
        }
        else if (codingType === 0x24) {
          const formatFrame = r.u8(); const aspectRatio = r.read(4); r.skipBits(2); const ocFlag = !!r.read(1); const crFlag = !!r.read(1);
          dynamicRangeType = r.read(4); colorSpace = r.read(4);
          const hdrPlus = !!r.read(1); r.skipBits(7);
          videoAttributes = { videoFormat: formatFrame >>> 4, frameRate: formatFrame & 0x0f, aspectRatio, ocFlag, crFlag, hdrPlus, dynamicRangeType, colorSpace };
        }
        if (r.offset > attrEnd) throw new ContractError("BDMV_INVALID_RECORD", `/offset/${streamOffset}`, "CLPI stream attribute exceeds record");
        if (attrEnd - r.offset >= 12) {
          const value = r.text(12); let end = value.length;
          while (end > 0 && (value.charCodeAt(end - 1) === 0 || value.charCodeAt(end - 1) === 0x20)) end--;
          isrc = value.slice(0, end);
        }
        r.seek(attrEnd);
        streams.push({ pid, codingType, language, dynamicRangeType, colorSpace, ...(videoAttributes ? { videoAttributes } : {}), ...(charCode === undefined ? {} : { charCode }), ...(isrc === undefined ? {} : { isrc }), source: sourceFor(file, "", origin, streamOffset) });
      }
      programs.push({ sequenceStartSpn, programMapPid, groupCount, streams, source: sourceFor(file, "", origin, start) });
    }
  }
  const cpi = [] as ClipInfo["cpi"]; const cpiMaps = [] as NonNullable<ClipInfo["cpiMaps"]>;
  if (cpiPos) {
    r.seek(cpiPos); const cpiLen = r.u32(); const cpiEnd = r.offset + cpiLen; if (cpiEnd > data.length) throw new ContractError("BDMV_INVALID_SECTION", "/cpiLength", "CLPI CPI section exceeds file");
    // Some valid CLPI records point at a zero-length CPI section. It contains
    // no header or entry maps, so there is nothing to decode.
    if (cpiLen > 0) {
      r.skipBits(12); r.read(4); const mapBase = r.offset; r.skipBits(8); const pidCount = r.u8(); if (r.offset > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", "/cpiLength", "CLPI CPI header exceeds section");
      const maps = [] as Array<{ pid: number; type: number; coarse: number; fine: number; start: number; source: SourceLocation }>;
      if (pidCount > Math.floor((cpiEnd - r.offset) / 10)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${r.offset - 1}`, "CPI PID count exceeds section");
      for (let i = 0; i < pidCount; i++) { if (r.offset + 10 > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${r.offset}`, "CPI PID map exceeds section"); const source = r.source(file.rel, origin); const pid = r.read(16); r.skipBits(10); const type = r.read(4); const coarse = r.read(16); const fine = r.read(18); const start = r.read(32); maps.push({ pid, type, coarse, fine, start, source }); }
      for (const map of maps) {
        const block = mapBase + map.start; if (!Number.isSafeInteger(block) || block < mapBase || block + 4 > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${block}`, "CPI entry block exceeds section"); r.seek(block); const fineStart = r.u32();
        if (map.coarse > Math.floor((cpiEnd - r.offset) / 8)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${block}`, "CPI coarse entry count exceeds section");
      const coarseEntries: NonNullable<ClipInfo["cpiMaps"]>[number]["coarse"] = []; for (let j = 0; j < map.coarse; j++) { const source = r.source(file.rel, origin); const refFine = r.read(18); const pts = r.read(14); const spn = r.u32(); coarseEntries.push({ refFine, pts, spn, source }); }
        const fineBlock = block + fineStart; if (!Number.isSafeInteger(fineBlock) || fineBlock < r.offset || fineBlock > cpiEnd) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${fineBlock}`, "CPI fine entry block exceeds section"); r.seek(fineBlock);
        if (map.fine > Math.floor((cpiEnd - r.offset) / 4)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${block}`, "CPI fine entry count exceeds section");
        // Each fine entry belongs to the last coarse entry whose `refFine` does
        // not exceed it. `j` only increases, so one cursor walks the coarse
        // entries instead of scanning them for every fine entry.
        const coarseOrdered = coarseEntries.every((entry, index) => index === 0 || coarseEntries[index - 1]!.refFine <= entry.refFine);
        const sortedCoarse = coarseOrdered ? coarseEntries : [...coarseEntries].sort((a, b) => a.refFine - b.refFine);
        let coarseIndex = 0;
      const fineEntries: NonNullable<ClipInfo["cpiMaps"]>[number]["fine"] = [];
      for (let j = 0; j < map.fine; j++) { const source = r.source(file.rel, origin); const angleChange = !!r.read(1); const endPositionOffset = r.read(3); const pts = r.read(11); const spnOffset = r.read(17); fineEntries.push({ angleChange, endPositionOffset, pts, spnOffset, source }); while (coarseIndex + 1 < sortedCoarse.length && sortedCoarse[coarseIndex + 1]!.refFine <= j) coarseIndex += 1; const candidate = sortedCoarse[coarseIndex]; const coarseEntry = candidate && candidate.refFine <= j ? candidate : undefined; const pts45k = coarseEntry ? ((coarseEntry.pts & ~1) << 18) + (pts << 8) : pts << 8; const spn = ((coarseEntry?.spn ?? 0) & ~0x1ffff) + spnOffset; cpi.push({ pid: map.pid, epStreamType: map.type, pts45k, spn, angleChange, source }); }
      cpiMaps.push({ pid: map.pid, epStreamType: map.type, coarse: coarseEntries, fine: fineEntries, source: map.source });
      }
    }
  }
  const clipMarks = markPos ? optionalSection("CLPI ClipMark", data, file, warn, markPos, (cursor) => {
    cursor.seek(markPos); const markLength = cursor.u32(); if (markLength === 0) return [];
    const markEnd = cursor.offset + markLength; if (markEnd > data.length || markLength < 2) throw new ContractError("BDMV_INVALID_SECTION", `/offset/${markPos}`, "CLPI ClipMark section exceeds file or omits its count");
    const countOffset = cursor.offset; const count = cursor.u16(); if (count > Math.floor((markEnd - cursor.offset) / 11)) throw new ContractError("BDMV_INVALID_COUNT", `/offset/${countOffset}`, "CLPI ClipMark count exceeds section");
    const marks: NonNullable<ClipInfo["clipMarks"]> = [];
    for (let index = 0; index < count; index++) { const source = cursor.source(file.rel, origin); const markType = cursor.u8(); const spn = cursor.u32(); const pts90k = cursor.u32(); const duration45k = cursor.u16(); marks.push({ index, markType, spn, pts90k, duration45k, source }); }
    return marks;
  }) ?? [] : [];
  const extensionData = extPos ? optionalSection("CLPI ExtensionData", data, file, warn, extPos, () => parseExtensionData(data, extPos, file, origin, version, warn)) ?? [] : [];
  return { value: { id: file.rel.split("/").pop()!.replace(/\.clpi$/i, ""), version, header, sequence, programs, cpi, cpiMaps, clipMarks, extensionData, source: sourceFor(file, "", origin, 0) }, version, raw: data };
}

export function parseSound(data: Uint8Array, file: FileEntry, fullLength: number): SoundEntry[] {
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
    if (backup && !bytesEqual(primary.raw, backup.raw)) diagnose(diagnostics, "BDMV_BACKUP_DIFFERS", `${kind} primary and backup differ; primary selected`, located.primary, 0, "info", true);
    return primary;
  }
  const backup = attempt(located.backup, "backup", false);
  if (backup) { diagnose(diagnostics, "BDMV_BACKUP_FALLBACK", `${kind} recovered from matching BACKUP file`, located.backup, 0, "warning", true); return backup; }
  if (critical) diagnose(diagnostics, "BDMV_REQUIRED_FILE_MISSING", `Required ${kind} metadata is missing or invalid`, located.primary, 0, "fatal", false);
  return undefined;
}

export function buildGraph(entries: ParsedDisc["entries"], objects: MovieObject[], playlists: Playlist[], clips: ClipInfo[], sounds: SoundEntry[], files: FileEntry[], diagnostics: ParseDiagnostic[], bdjos: BdjoInfo[] = [], metadata: NonNullable<ParsedDisc["metadata"]> = []): ParsedDisc["graph"] {
  const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const seen = new Set<string>();
  const add = (node: GraphNode) => { if (seen.has(node.id)) return; seen.add(node.id); nodes.push(node); };
  const fileByPath = new Map(files.map((file) => [normCase(file.rel), file]));
  // The reference lookups below resolve once per node instead of rescanning the
  // arrays; the first match wins, as the linear searches did.
  const objectById = new Map<number, MovieObject>();
  for (const object of objects) if (!objectById.has(object.id)) objectById.set(object.id, object);
  const clipByKey = new Map<string, ClipInfo>();
  for (const clip of clips) { const key = normCase(clip.id); if (!clipByKey.has(key)) clipByKey.set(key, clip); }
  const fileByRelativePath = new Map<string, FileEntry>();
  for (const file of files) { const key = bdmvRelativePath(file.rel); if (!fileByRelativePath.has(key)) fileByRelativePath.set(key, file); }
  const bdjoByPath = new Map(bdjos.map((bdjo) => [normCase(bdjo.path.replace(/^BACKUP\//i, "")), bdjo]));
  const pathSource = (file: FileEntry) => sourceFor(file, "", "primary", 0);
  for (const entry of entries) {
    const id = `entry:${entry.id}`;
    add({ id, type: entry.kind === "title" ? "title" : "entry", state: "present", source: entry.source });
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") {
      const targetId = `movieObject:${entry.target.target}`; const object = objectById.get(entry.target.target);
      edges.push({ from: id, to: targetId, kind: "entry-target", resolution: object ? "resolved" : "missing", source: entry.source });
      if (!object) add({ id: targetId, type: "movieObject", state: "missing", source: entry.source });
    } else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
      const targetId = `bdjo:${entry.target.target}`; const bdjoFile = fileByPath.get(normCase(`BDMV/BDJO/${entry.target.target}.bdjo`));
      const parsedBdjo = bdjoByPath.get(normCase(`BDJO/${entry.target.target}.bdjo`));
      add({ id: targetId, type: "bdjo", state: bdjoFile ? "present" : "missing", source: parsedBdjo?.source ?? (bdjoFile ? pathSource(bdjoFile) : entry.source) });
      edges.push({ from: id, to: targetId, kind: "bdj-target", resolution: bdjoFile ? "resolved" : "missing", source: entry.source });
      if (!bdjoFile) diagnose(diagnostics, "BDMV_MISSING_BDJO", `BD-J entry ${entry.id} references missing BDJO ${entry.target.target}`, fileByRelativePath.get(entry.source.path), Number(entry.source.offset), "error", true, id);
    }
  }
  for (const manifest of metadata) add({ id: `metaDl:${manifest.language}`, type: "metaDl", state: "present", source: manifest.source });
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
      const infoId = `clipInfo:${item.clipId}`; const info = clipByKey.get(normCase(item.clipId));
      add({ id: infoId, type: "clipInfo", state: info ? "present" : "missing", source: info?.source ?? item.source });
      edges.push({ from: itemId, to: infoId, kind: "clip-info-reference", resolution: info ? "resolved" : "missing", source: item.source });
      if (!streamFile) diagnose(diagnostics, "BDMV_MISSING_STREAM", `PlayItem ${playlist.id}/${item.index} references missing STREAM clip ${item.clipId}`, fileByRelativePath.get(item.source.path), Number(item.source.offset), "error", true, itemId);
      if (!info) diagnose(diagnostics, "BDMV_MISSING_CLPI", `PlayItem ${playlist.id}/${item.index} references missing CLPI ${item.clipId}`, fileByRelativePath.get(item.source.path), Number(item.source.offset), "error", true, itemId);
      if (info) {
        const declared = new Map(info.programs.flatMap((program) => program.streams.map((stream) => [stream.pid, stream] as const)));
        for (const stream of item.streams) {
          // Stream type 2 carries a SubPath/SubClip selector. Its PID belongs to
          // that secondary clip, so comparing it with this PlayItem's CLPI is false.
          if (stream.streamType !== 1) continue;
          if (stream.pid === null) continue;
          const clipStream = declared.get(stream.pid);
          if (!clipStream) diagnose(diagnostics, "BDMV_STN_CLPI_PID_CONFLICT", `STN PID ${stream.pid} is not declared by CLPI ${info.id}`, fileByRelativePath.get(stream.source.path), Number(stream.source.offset), "warning", true, itemId);
          else if (stream.codingType !== null && stream.codingType !== clipStream.codingType) diagnose(diagnostics, "BDMV_STN_CLPI_CODING_CONFLICT", `STN and CLPI coding types differ for PID ${stream.pid}`, fileByRelativePath.get(stream.source.path), Number(stream.source.offset), "warning", true, itemId);
        }
      }
    }
    for (const [subPathIndex, subPath] of playlist.subPaths.entries()) {
      const subPathId = `subPath:${playlist.id}:${subPathIndex}`;
      add({ id: subPathId, type: "subPath", state: "present", source: subPath.source });
      edges.push({ from: playlistId, to: subPathId, kind: "contains-subpath", resolution: "resolved", source: subPath.source });
      for (const [subItemIndex, subItem] of subPath.items.entries()) {
        const clipId = `clip:${subItem.clipId}`;
        const streamFile = fileByPath.get(normCase(`BDMV/STREAM/${subItem.clipId}.m2ts`));
        add({ id: clipId, type: "clip", state: streamFile ? "present" : "missing", source: streamFile ? pathSource(streamFile) : subItem.source });
        edges.push({ from: subPathId, to: clipId, kind: "subpath-clip-reference", resolution: streamFile ? "resolved" : "missing", source: subItem.source });
        const infoId = `clipInfo:${subItem.clipId}`;
        const info = clipByKey.get(normCase(subItem.clipId));
        add({ id: infoId, type: "clipInfo", state: info ? "present" : "missing", source: info?.source ?? subItem.source });
        edges.push({ from: subPathId, to: infoId, kind: "subpath-clip-info-reference", resolution: info ? "resolved" : "missing", source: subItem.source });
        if (!streamFile) diagnose(diagnostics, "BDMV_MISSING_STREAM", `SubPlayItem ${playlist.id}/${subPathIndex}/${subItemIndex} references missing STREAM clip ${subItem.clipId}`, fileByRelativePath.get(subItem.source.path), Number(subItem.source.offset), "error", true, subPathId);
        if (!info) diagnose(diagnostics, "BDMV_MISSING_CLPI", `SubPlayItem ${playlist.id}/${subPathIndex}/${subItemIndex} references missing CLPI ${subItem.clipId}`, fileByRelativePath.get(subItem.source.path), Number(subItem.source.offset), "error", true, subPathId);
      }
    }
    for (const mark of playlist.marks) {
      const item = playlist.playItems[mark.playItemRef];
      if (!item || mark.time45k < item.inTime45k || mark.time45k > item.outTime45k) diagnose(diagnostics, "BDMV_INVALID_REFERENCE", `PlayMark ${mark.index} points outside a valid PlayItem interval`, fileByRelativePath.get(mark.source.path), Number(mark.source.offset), "error", true, playlistId);
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
  const warn: Warn = (code, message, file, offset) => diagnose(diagnostics, code, message, file, offset, "warning", true);
  const indexFile = locate(index, "BDMV/index.bdmv"); const parsedIndex = choose("index.bdmv", indexFile, allBytes, (data, file, origin) => parseIndex(data, file, origin, warn), diagnostics, true);
  const mobjFile = locate(index, "BDMV/MovieObject.bdmv"); const parsedObjects = choose("MovieObject.bdmv", mobjFile, allBytes, (data, file, origin) => parseMobj(data, file, origin), diagnostics, false);
  if (!parsedObjects) diagnose(diagnostics, "BDMV_REQUIRED_FILE_MISSING", "MovieObject.bdmv is missing or invalid", mobjFile.primary, undefined, "error", true);
  const entries: ParsedDisc["entries"] = [];
  for (const [i, target] of (parsedIndex?.value.entries ?? []).entries()) { const kind = i === 0 ? "firstPlay" : i === 1 ? "topMenu" : "title"; entries.push({ id: `${kind}:${i < 2 ? "0" : i - 2}`, kind, target, source: target.source }); if (target.objectType === "BDJ") diagnose(diagnostics, "BDMV_BDJ_UNSUPPORTED", "BD-J entry retained but not executed by this tool", indexFile.primary, Number(target.source.offset), "warning", true, `${kind}:${i}`); }
  const objects = parsedObjects?.value ?? [];
  const bdjos: BdjoInfo[] = [];
  const bdjoNames = new Set(entries.flatMap((entry) => entry.target.objectType === "BDJ" && typeof entry.target.target === "string" ? [entry.target.target] : []));
  for (const name of bdjoNames) {
    const candidates = locate(index, `BDMV/BDJO/${name}.bdjo`);
    for (const file of [candidates.primary, candidates.backup]) if (file && !allBytes.has(file.rel)) {
      try { const loaded = await readRegisteredFile(table, file.rel.slice("BDMV/".length), Math.min(limits.maxReadWindowBytes, limits.maxSegmentBytes)); file.size = loaded.byteLength; allBytes.set(file.rel, loaded.bytes); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); diagnose(diagnostics, "BDMV_FILE_READ_FAILED", `Referenced BDJO ${name} could not be read (${message})`, file, 0, "error", true); }
    }
    const available = { ...(candidates.primary && allBytes.has(candidates.primary.rel) ? { primary: candidates.primary } : {}), ...(candidates.backup && allBytes.has(candidates.backup.rel) ? { backup: candidates.backup } : {}) };
    const parsed = choose(`BDJO ${name}`, available, allBytes, parseBdjo, diagnostics, false); if (parsed) bdjos.push(parsed.value);
  }
  const metadata: NonNullable<ParsedDisc["metadata"]> = [];
  const metadataNames = new Set(files.filter((file) => /\/META\/DL\/bdmt_[a-z0-9]{3}\.xml$/i.test(file.rel)).map((file) => file.rel.replace(/^BDMV\/BACKUP\//i, "BDMV/")));
  for (const name of metadataNames) {
    const language = /bdmt_([a-z0-9]{3})\.xml$/i.exec(name)?.[1]?.toLowerCase(); if (!language) continue;
    const candidates = locate(index, name);
    for (const file of [candidates.primary, candidates.backup]) if (file && !allBytes.has(file.rel)) {
      try { const loaded = await readRegisteredFile(table, file.rel.slice("BDMV/".length), Math.min(limits.maxReadWindowBytes, limits.maxSegmentBytes)); file.size = loaded.byteLength; allBytes.set(file.rel, loaded.bytes); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); const code = error instanceof ContractError ? error.code : "BDMV_FILE_READ_FAILED"; diagnose(diagnostics, code, `META/DL manifest ${name} could not be read within the configured bound (${message})`, file, 0, "warning", true); }
    }
    const available = { ...(candidates.primary && allBytes.has(candidates.primary.rel) ? { primary: candidates.primary } : {}), ...(candidates.backup && allBytes.has(candidates.backup.rel) ? { backup: candidates.backup } : {}) };
    const parsed = choose(`META/DL ${fileName(name)}`, available, allBytes, (bytes, file, origin) => parseMetaDl(bytes, file, origin, language), diagnostics, false); if (parsed) metadata.push(parsed.value);
  }
  const playlists: Playlist[] = [];
  const playlistNames = new Set(files.filter((x) => /\/PLAYLIST\/[^/]+\.mpls$/i.test(x.rel)).map((f) => f.rel.replace(/^BDMV\/BACKUP\//i, "BDMV/")));
  for (const name of playlistNames) {
    const item = locate(index, name); const parsed = choose(`playlist ${fileName(name)}`, item, allBytes, (data, file, origin) => parseMpls(data, file, origin, warn), diagnostics, false); if (parsed) playlists.push(parsed.value);
  }
  const clips: ClipInfo[] = [];
  const clipNames = new Set(files.filter((x) => /\/CLIPINF\/[^/]+\.clpi$/i.test(x.rel)).map((f) => f.rel.replace(/^BDMV\/BACKUP\//i, "BDMV/")));
  for (const name of clipNames) {
    const parsed = choose(`CLPI ${fileName(name)}`, locate(index, name), allBytes, (data, file, origin) => parseClpi(data, file, origin, warn), diagnostics, false); if (parsed) clips.push(parsed.value);
  }
  const soundFile = files.find((x) => normCase(x.rel) === "bdmv/auxdata/sound.bdmv"); const sounds = soundFile ? parseSound(allBytes.get(soundFile.rel)!, soundFile, soundFile.size) : [];
  if (!soundFile) diagnose(diagnostics, "BDMV_OPTIONAL_SOUND_MISSING", "Optional AUXDATA/sound.bdmv is absent", undefined, undefined, "info", true);
  const graph = buildGraph(entries, objects, playlists, clips, sounds, files, diagnostics, bdjos, metadata);
  const extensionCount = playlists.reduce((count, playlist) => count + (playlist.extensionData?.length ?? 0), 0) + clips.reduce((count, clip) => count + (clip.extensionData?.length ?? 0), 0);
  const clipMarkCount = clips.reduce((count, clip) => count + (clip.clipMarks?.length ?? 0), 0);
  const declarations = { entries: entries.length, movieObjects: objects.length, playlists: playlists.length, playItems: playlists.reduce((n, p) => n + p.playItems.length, 0), clips: clips.length, streams: clips.reduce((n, c) => n + c.programs.reduce((m, p) => m + p.streams.length, 0), 0), sounds: sounds.length, bdjos: bdjos.length, metadata: metadata.length, extensionData: extensionCount, clipMarks: clipMarkCount, unknown: diagnostics.filter((d) => d.code.includes("UNSUPPORTED") || d.code.includes("UNKNOWN") || d.code.includes("UNPARSED")).length };
  const unverified = [
    "INDX candidate versions 0100 and 0240; AppInfoBDMV and UHD extension fields outside compared samples",
    "MOBJ candidate versions 0100 and 0240 outside compared samples",
    "MPLS candidate versions 0100 and 0240; alternate angles, secondary streams, and PIP/extension-SubPath payloads outside compared samples",
    "CLPI candidate versions 0100 and 0240; ClipMark, nonzero ProgramInfo groups, and typed ExtensionData outside compared samples",
    "BDJO versions and field combinations outside the compared 0200 records",
    "META/DL languages and field combinations outside the compared eng manifest",
    "sound.bdmv fields without independent field comparisons",
    "unknown ExtensionData payload semantics",
  ];
  return { schemaVersion: "1.0", analysisStage: "structural", root, discInfo: { appInfo: parsedIndex?.value.appInfo ?? null, uhd: parsedIndex?.value.uhd ?? null }, entries, movieObjects: objects, bdjos, metadata, playlists, clips, sounds, graph, declarations, diagnostics, supportPrediction: { status: "partial", supported: [], unsupported: ["BD-J execution", "MPLS multi-angle playback", "SubPath playback", "media decoding"], unverified } };
}
