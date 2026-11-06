import { checkedObjectPixels, DEFAULT_LIMITS, type Limits } from "@bdmv2web/core";
import type { IgsButton, IgsDiagnostic, IgsObject, IgsPage, IgsPalette, IgsScene, PtsValue } from "./types.js";
import { source } from "./transport.js";

export interface IgsSegment { type: number; data: Uint8Array; offset: bigint; }
export interface SegmentParseResult { segments: IgsSegment[]; residual: Uint8Array; diagnostics: IgsDiagnostic[]; }
export interface IgsStreamState {
  objects: Map<string, IgsObject>;
  palettes: Map<string, IgsPalette>;
  pendingObjects: Map<string, { id: number; version: number; width: number; height: number; declaredLength: number; bytes: Uint8Array; source: IgsObject["source"]; last: boolean }>;
  scenes: IgsScene[];
  diagnostics: IgsDiagnostic[];
  current: Map<number, { ics: Uint8Array; source: IgsScene["source"]; pts: string | null; timeDomain: number; objects: IgsObject[]; palettes: IgsPalette[]; invalid: boolean }>;
}

export function createIgsState(): IgsStreamState {
  return { objects: new Map(), palettes: new Map(), pendingObjects: new Map(), scenes: [], diagnostics: [], current: new Map() };
}

export function parseSegments(input: Uint8Array, baseOffset = 0n, residual = new Uint8Array(), clipId = "", pid = 0, pts: PtsValue | null = null): SegmentParseResult {
  const bytes = join(residual, input); const segments: IgsSegment[] = []; const diagnostics: IgsDiagnostic[] = [];
  let pos = 0;
  while (bytes.length - pos >= 3) {
    const type = bytes[pos]!; const length = (bytes[pos + 1]! << 8) | bytes[pos + 2]!;
    if (length > 0xffff) { diagnostics.push(error("IGS_INVALID_SEGMENT", "Segment length exceeds its 16-bit field", source(clipId, pid, baseOffset + BigInt(pos)))); break; }
    const total = length + 3;
    if (bytes.length - pos < total) break;
    segments.push({ type, data: bytes.slice(pos + 3, pos + total), offset: baseOffset + BigInt(pos) });
    pos += total;
  }
  return { segments, residual: bytes.slice(pos), diagnostics };
}

export function decodeRle(data: Uint8Array, width: number, height: number, limits: Limits = DEFAULT_LIMITS): Uint8Array {
  const pixelCount = checkedObjectPixels(width, height, limits);
  const output = new Uint8Array(pixelCount);
  let inPos = 0; let x = 0; let y = 0; let outPos = 0;
  while (inPos < data.length) {
    const color = data[inPos++]!;
    let run = 1; let value = color;
    if (color === 0) {
      if (inPos >= data.length) throw new IgsError("IGS_INVALID_RLE", "Zero run marker has no control byte");
      const control = data[inPos++]!;
      if (control === 0) {
        if (x !== width || y >= height) throw new IgsError("IGS_INVALID_RLE", "Line end marker occurs before a full row or beyond image height");
        x = 0;
        y++;
        continue;
      }
      const hasColor = !!(control & 0x80);
      run = control & 0x3f;
      if (control & 0x40) {
        if (inPos >= data.length) throw new IgsError("IGS_INVALID_RLE", "Extended run marker has no low length byte");
        run = (run << 8) | data[inPos++]!;
      }
      if (hasColor) {
        if (inPos >= data.length) throw new IgsError("IGS_INVALID_RLE", "Colored run marker has no color byte");
        value = data[inPos++]!;
      } else value = 0;
    }
    if (run === 0) continue;
    if (y >= height || run > width - x) throw new IgsError("IGS_RLE_OVERRUN", `Run of ${run} pixels crosses row ${y} width ${width}`);
    if (outPos + run > pixelCount) throw new IgsError("IGS_RLE_OVERRUN", "Decoded RLE exceeds declared pixel count");
    output.fill(value, outPos, outPos + run); outPos += run; x += run;
  }
  if (outPos !== pixelCount || !((x === width && y === height - 1) || (x === 0 && y === height))) throw new IgsError("IGS_RLE_TRUNCATED", `RLE ended at ${outPos}/${pixelCount} pixels (${y} rows)`);
  return output;
}

function appendIcsFragment(previous: Uint8Array, fragment: Uint8Array): Uint8Array {
  if (previous.length < 12 || fragment.length < 9) throw new IgsError("IGS_INVALID_SEGMENT", "ICS fragment is shorter than its header");
  const payload = previous.subarray(12);
  // Continuation ICS segments repeat the common fields and sequence flags but
  // omit the 24-bit total data length present in the start segment.
  const nextPayload = fragment.subarray(9);
  const combined = new Uint8Array(12 + payload.length + nextPayload.length);
  combined.set(previous.subarray(0, 9));
  combined.set(payload, 12);
  combined.set(nextPayload, 12 + payload.length);
  return combined;
}

function u24Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff) throw new IgsError("IGS_INVALID_SEGMENT", "ICS data length exceeds its 24-bit field");
  return Uint8Array.of(value >>> 16, value >>> 8, value & 0xff);
}

export function consumeSegment(state: IgsStreamState, segment: IgsSegment, clipId: string, pid: number, pts: PtsValue | null, packetOffset: bigint, pesOffset: bigint, segmentFileOffset: bigint, limits: Limits = DEFAULT_LIMITS): void {
  const src = source(clipId, pid, packetOffset, pesOffset, segment.offset, pts?.normalized.toString() ?? null, pts?.timeDomain ?? 0, segmentFileOffset);
  let current = state.current.get(pid);
  if (current && current.timeDomain !== src.timeDomain) {
    const abandonedDomain = current.timeDomain;
    state.diagnostics.push(error("IGS_TIME_DOMAIN_RESET", `Time domain changed from ${current.timeDomain} to ${src.timeDomain} before Display Set END; the active composition was discarded`, current.source, [sceneId(current.source)]));
    state.current.delete(pid);
    current = undefined;
    for (const [key, pending] of state.pendingObjects) {
      if (!key.startsWith(cachePrefix(pid, abandonedDomain))) continue;
      state.diagnostics.push(error("IGS_INCOMPLETE_OBJECT", `Time-domain reset left ODS object ${pending.id} version ${pending.version} incomplete`, pending.source));
      state.pendingObjects.delete(key);
    }
  }
  try {
    if (segment.type === 0x18) {
      const sequenceFlags = segment.data[8] ?? 0;
      const startsComposition = (sequenceFlags & 0x80) !== 0;
      const endsComposition = (sequenceFlags & 0x40) !== 0;
      if (startsComposition) {
        if (current) {
          state.diagnostics.push(error("IGS_UNCOMPLETED_DISPLAY_SET", "New ICS arrived before prior Display Set reached END", current.source, [sceneId(current.source)]));
          for (const key of [...state.pendingObjects.keys()]) if (key.startsWith(cachePrefix(pid, current.timeDomain))) state.pendingObjects.delete(key);
        }
        const compositionState = (segment.data[7] ?? 0) >> 6;
        if (compositionState === 2) {
          for (const key of [...state.objects.keys()]) if (key.startsWith(cachePrefix(pid, src.timeDomain))) state.objects.delete(key);
          for (const key of [...state.palettes.keys()]) if (key.startsWith(cachePrefix(pid, src.timeDomain))) state.palettes.delete(key);
          for (const key of [...state.pendingObjects.keys()]) if (key.startsWith(cachePrefix(pid, src.timeDomain))) state.pendingObjects.delete(key);
        }
        current = { ics: segment.data.slice(), source: src, pts: pts?.normalized.toString() ?? null, timeDomain: pts?.timeDomain ?? 0, objects: [], palettes: [], invalid: false };
        state.current.set(pid, current);
        return;
      }
      if (!current) {
        state.diagnostics.push(error("IGS_INVALID_SEGMENT", "ICS continuation has no active composition", src));
        return;
      }
      current.ics = appendIcsFragment(current.ics, segment.data);
      if (endsComposition) {
        // The combined composition is parsed at the following END segment.
        current.ics[8] = 0xc0;
        current.ics.set(u24Bytes(current.ics.length - 12), 9);
      }
      return;
    }
    if (segment.type === 0x14) {
      const palette = parsePalette(segment.data, src);
      state.palettes.set(cacheKey(pid, src.timeDomain, palette.id, palette.version), palette);
      if (current?.timeDomain === src.timeDomain) current.palettes.push(palette);
      return;
    }
    if (segment.type === 0x15) {
      consumeObjectSegment(state, segment.data, src, limits);
      return;
    }
    if (segment.type === 0x80) {
      if (!current) { state.diagnostics.push(error("IGS_ORPHAN_END", "END segment has no active ICS composition", src)); return; }
      for (const [pendingKey, pending] of state.pendingObjects) {
        if (!pendingKey.startsWith(cachePrefix(pid, current.timeDomain))) continue;
        current.invalid = true;
        state.diagnostics.push(error("IGS_INCOMPLETE_OBJECT", `END arrived with incomplete ODS object ${pending.id} version ${pending.version}`, pending.source, [sceneId(current.source)]));
        state.objects.delete(cacheKey(pid, current.timeDomain, pending.id, pending.version));
        current.objects = current.objects.filter((object) => object.id !== pending.id || object.version !== pending.version);
      }
      for (const key of [...state.pendingObjects.keys()]) if (key.startsWith(cachePrefix(pid, current.timeDomain))) state.pendingObjects.delete(key);
      const scene = parseIcs(current.ics, limits);
      scene.id = `${clipId}:${pid}:${scene.compositionNumber}:${current.timeDomain}:${current.pts ?? "no-pts"}`;
      scene.source = current.source; scene.clipId = clipId; scene.pid = pid; scene.pts90k = current.pts; scene.timeDomain = current.timeDomain;
      scene.rawIcs = current.ics.slice();
      for (const page of scene.pages) {
        page.scopeId = `${scene.id}:page:${page.id}`;
        for (const button of page.buttons) button.scopeId = `${page.scopeId}:button:${button.id}`;
      }
      for (const page of scene.pages) for (const button of page.buttons) for (const command of button.commands) {
        command.sourceOffset = (BigInt(scene.source.segmentFileOffset) + 3n + BigInt(command.sourceOffset)).toString();
      }
      scene.objects = [...new Map([...current.objects, ...[...state.objects.entries()].filter(([key]) => key.startsWith(cachePrefix(pid, current!.timeDomain))).map(([, object]) => object)].map((o) => [`${o.id}:${o.version}`, o])).values()];
      scene.palettes = [...new Map([...current.palettes, ...[...state.palettes.entries()].filter(([key]) => key.startsWith(cachePrefix(pid, current!.timeDomain))).map(([, palette]) => palette)].map((p) => [`${p.id}:${p.version}`, p])).values()];
      scene.complete = !current.invalid;
      if (validateButtonReferences(scene, state.diagnostics)) scene.complete = false;
      state.scenes.push(scene);
      state.current.delete(pid);
      return;
    }
    state.diagnostics.push({ severity: "warning", code: "IGS_UNSUPPORTED_SEGMENT", message: `Segment type 0x${segment.type.toString(16).padStart(2, "0")} is retained only as an unknown segment`, source: src, affectedSceneIds: current ? [sceneId(current.source)] : [] });
  } catch (e) {
    const err = e instanceof IgsError ? e : new IgsError("IGS_INVALID_SEGMENT", e instanceof Error ? e.message : String(e));
    state.diagnostics.push(error(err.code, err.message, src, current ? [sceneId(current.source)] : []));
    if (current) current.invalid = true;
    if (segment.type === 0x15 && segment.data.length >= 3) {
      const id = u16(segment.data, 0), key = cacheKey(pid, src.timeDomain, id, segment.data[2]!);
      state.pendingObjects.delete(key);
      state.objects.delete(key);
      if (current) current.objects = current.objects.filter((object) => object.id !== id || object.version !== segment.data[2]);
    } else if (segment.type === 0x14 && segment.data.length >= 2) {
      const id = segment.data[0]!, key = cacheKey(pid, src.timeDomain, id, segment.data[1]!);
      state.palettes.delete(key);
      if (current) current.palettes = current.palettes.filter((palette) => palette.id !== id || palette.version !== segment.data[1]);
    }
    if (segment.type === 0x18) state.current.delete(pid);
  }
}

function consumeObjectSegment(state: IgsStreamState, data: Uint8Array, src: IgsObject["source"], limits: Limits): void {
  if (data.length < 4) throw new IgsError("IGS_INVALID_SEGMENT", "ODS is shorter than its object id, version and sequence descriptor");
  const id = u16(data, 0), version = data[2]!, flags = data[3]!;
  const first = !!(flags & 0x80), last = !!(flags & 0x40);
  const key = cacheKey(src.pid, src.timeDomain, id, version);
  let pending = state.pendingObjects.get(key);
  let cursor = 4;
  if (first) {
    if (pending) {
      const current = state.current.get(src.pid);
      if (current) current.invalid = true;
      state.diagnostics.push(error("IGS_INCOMPLETE_OBJECT", `New first fragment replaced incomplete ODS object ${id} version ${version}`, pending.source, current ? [sceneId(current.source)] : []));
      state.pendingObjects.delete(key);
    }
    if (data.length < 10) throw new IgsError("IGS_INVALID_SEGMENT", "First ODS fragment has no length and dimensions");
    const declaredLength = u24(data, cursor); cursor += 3;
    const width = u16(data, cursor); const height = u16(data, cursor + 2); cursor += 4;
    const pixels = checkedObjectPixels(width, height, limits);
    if (declaredLength < 4 || declaredLength > limits.maxSegmentBytes || declaredLength - 4 > limits.maxReassemblyBytes) throw new IgsError("LIMIT_EXCEEDED", `ODS declared data length ${declaredLength} exceeds supported limits`);
    pending = { id, version, width, height, declaredLength, bytes: new Uint8Array(), source: src, last };
    state.pendingObjects.set(key, pending);
    void pixels;
  } else if (!pending) {
    throw new IgsError("UNRESOLVED_OBJECT", `ODS continuation for object ${id} version ${version} has no first fragment`);
  }
  if (!pending) return;
  const fragment = data.subarray(cursor);
  const activeBytes = [...state.pendingObjects.values()].reduce((sum, item) => sum + item.bytes.length, 0) - pending.bytes.length;
  if (activeBytes + pending.bytes.length + fragment.length > limits.maxReassemblyBytes) {
    state.pendingObjects.delete(key);
    throw new IgsError("LIMIT_EXCEEDED", `Active ODS reassembly bytes exceed maxReassemblyBytes ${limits.maxReassemblyBytes}`);
  }
  pending.bytes = join(pending.bytes, fragment);
  pending.last ||= last;
  if (pending.bytes.length > limits.maxReassemblyBytes || pending.bytes.length > pending.declaredLength - 4) throw new IgsError("IGS_INVALID_SEGMENT", `ODS object ${id} fragment bytes exceed declared object length`);
  if (!pending.last) return;
  if (pending.bytes.length !== pending.declaredLength - 4) throw new IgsError("IGS_INVALID_SEGMENT", `ODS object ${id} ended at ${pending.bytes.length} bytes; expected ${pending.declaredLength - 4}`);
  const indices = decodeRle(pending.bytes, pending.width, pending.height, limits);
  const object: IgsObject = { id, version, width: pending.width, height: pending.height, indices, source: pending.source };
  state.objects.set(key, object);
  const current = state.current.get(src.pid);
  if (current?.timeDomain === src.timeDomain) current.objects.push(object);
  state.pendingObjects.delete(key);
}

function parsePalette(data: Uint8Array, src: IgsPalette["source"]): IgsPalette {
  if (data.length < 2 || (data.length - 2) % 5 !== 0) throw new IgsError("IGS_INVALID_SEGMENT", "PDS must contain palette id/version and complete 5-byte entries");
  const entries = new Map<number, IgsPalette["entries"] extends Map<number, infer E> ? E : never>();
  for (let i = 2; i < data.length; i += 5) entries.set(data[i]!, { y: data[i + 1]!, cr: data[i + 2]!, cb: data[i + 3]!, alpha: data[i + 4]! });
  return { id: data[0]!, version: data[1]!, entries, source: src };
}

function parseIcs(data: Uint8Array, limits: Limits): IgsScene {
  const r = new BitReader(data);
  const width = r.u16(), height = r.u16(); const frameRateCode = r.u8() >>> 4;
  const compositionNumber = r.u16(); const compositionState = r.bits(2); r.bits(6); const sequenceFlags = r.u8();
  if (!(sequenceFlags & 0x80) || !(sequenceFlags & 0x40)) throw new IgsError("IGS_INVALID_SEGMENT", "ICS sequence must be complete before decoding");
  const dataLength = r.u24();
  if (dataLength !== r.remaining) throw new IgsError("IGS_INVALID_SEGMENT", `ICS data length ${dataLength} does not match ${r.remaining} remaining bytes`);
  const streamModel = r.bits(1), uiModel = r.bits(1); r.bits(6);
  let compositionTimeout90k: string | null = null, selectionTimeout90k: string | null = null;
  if (streamModel === 0) { r.bits(7); compositionTimeout90k = r.bigBits(33).toString(); r.bits(7); selectionTimeout90k = r.bigBits(33).toString(); }
  const userTimeoutDuration = r.u24();
  const pageCount = r.u8();
  if (pageCount > 255) throw new IgsError("IGS_INVALID_SEGMENT", "Invalid page count");
  checkedObjectPixels(width, height, limits);
  const pages: IgsPage[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) pages.push(parsePage(r));
  if (r.remaining !== 0) throw new IgsError("IGS_INVALID_SEGMENT", `ICS has ${r.remaining} unparsed bytes`);
  return { id: "", clipId: "", pid: 0, compositionNumber, compositionState, width, height, frameRateCode, timeDomain: 0, pts90k: null, streamModel, uiModel, compositionTimeout90k, selectionTimeout90k, userTimeoutDuration, rawIcs: data.slice(), pages, objects: [], palettes: [], complete: false, source: source("", 0, 0n) };
}

function parsePage(r: BitReader): IgsPage {
  const id = r.u8(), version = r.u8(); const uoMask = BigInt(`0x${[...r.bytes(8)].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
  const enter = parseEffectSequence(r); const exit = parseEffectSequence(r);
  const animationFrameRateCode = r.u8(); const defaultSelectedButtonId = r.u16(); const defaultActivatedButtonId = r.u16(); const paletteId = r.u8(); const bogCount = r.u8();
  const buttons: IgsButton[] = [];
  const bogs: IgsPage["bogs"] = [];
  for (let i = 0; i < bogCount; i++) {
    const defaultButtonId = r.u16(); const count = r.u8(); const buttonIds: number[] = [];
    for (let j = 0; j < count; j++) {
      const buttonStart = r.position;
      const buttonId = r.u16(); const numericSelectValue = r.u16(); const flags = r.u8(); const x = r.u16(), y = r.u16();
      const up = r.u16(), down = r.u16(), left = r.u16(), right = r.u16();
      const normalStart = r.u16(), normalEnd = r.u16(), normalFlags = r.u8();
      const selectedSoundId = r.u8(), selectedStart = r.u16(), selectedEnd = r.u16(), selectedFlags = r.u8();
      const activatedSoundId = r.u8(), activatedStart = r.u16(), activatedEnd = r.u16(); const commandCount = r.u16();
      const commands: IgsButton["commands"] = [];
      for (let commandIndex = 0; commandIndex < commandCount; commandIndex++) {
        const sourceOffset = r.position; commands.push({ bytes: r.bytes(12), recordIndex: commandIndex, sourceOffset: String(sourceOffset) });
      }
      buttons.push({ id: buttonId, numericSelectValue, x, y, autoAction: !!(flags & 0x80), neighbors: { up, down, left, right }, visuals: { normal: { startObjectId: normalStart, endObjectId: normalEnd, repeat: !!(normalFlags & 0x80) }, selected: { startObjectId: selectedStart, endObjectId: selectedEnd, repeat: !!(selectedFlags & 0x80), soundId: selectedSoundId }, activated: { startObjectId: activatedStart, endObjectId: activatedEnd, soundId: activatedSoundId } }, commands });
      buttonIds.push(buttonId);
      void buttonStart;
    }
    bogs.push({ defaultButtonId, buttonIds });
  }
  return { id, version, uoMask, defaultSelectedButtonId, defaultActivatedButtonId, paletteId, buttons, bogs, animationFrameRateCode, effects: { enter, exit } };
}

function validateButtonReferences(scene: IgsScene, diagnostics: IgsDiagnostic[]): boolean {
  let invalid = false;
  const report = (pageId: number, referencedButtonId: number, referenceKind: string, buttonId?: number) => {
    invalid = true;
    diagnostics.push({
      ...error("IGS_INVALID_BUTTON_REFERENCE", `Page ${pageId} ${referenceKind} references button ${referencedButtonId}, which is invalid for that reference scope`, scene.source, [scene.id]),
      details: { pageId, referencedButtonId, referenceKind, buttonId: buttonId ?? null },
    });
  };
  for (const page of scene.pages) {
    const buttonIds = new Set(page.buttons.map((button) => button.id));
    // default_selected_button_id_ref has only one sentinel: 0xffff means dynamic
    // selection. For default_activated_button_id_ref, 0xfffe means activate the
    // currently selected button at timeout and 0xffff means no auto-activation.
    if (page.defaultSelectedButtonId !== 0xffff && !buttonIds.has(page.defaultSelectedButtonId)) {
      report(page.id, page.defaultSelectedButtonId, "page-default-selected");
    }
    if (page.defaultActivatedButtonId !== 0xfffe && page.defaultActivatedButtonId !== 0xffff && !buttonIds.has(page.defaultActivatedButtonId)) {
      report(page.id, page.defaultActivatedButtonId, "page-default-activated");
    }
    for (const [bogIndex, bog] of page.bogs.entries()) {
      const members = new Set(bog.buttonIds);
      for (const memberId of bog.buttonIds) if (!buttonIds.has(memberId)) report(page.id, memberId, `bog-${bogIndex}-member`);
      if (bog.defaultButtonId !== 0xffff && (!members.has(bog.defaultButtonId) || !buttonIds.has(bog.defaultButtonId))) report(page.id, bog.defaultButtonId, `bog-${bogIndex}-default`);
    }
    for (const button of page.buttons) {
      for (const [direction, neighborId] of Object.entries(button.neighbors)) {
        if (neighborId !== 0xffff && !buttonIds.has(neighborId)) report(page.id, neighborId, `neighbor-${direction}`, button.id);
      }
    }
  }
  return invalid;
}

function parseEffectSequence(r: BitReader): IgsPage["effects"]["enter"] {
  const windowCount = r.u8();
  const windows = Array.from({ length: windowCount }, () => ({ id: r.u8(), x: r.u16(), y: r.u16(), width: r.u16(), height: r.u16() }));
  const effectCount = r.u8();
  const effects = Array.from({ length: effectCount }, () => {
    const duration90k = r.u24();
    const paletteId = r.u8();
    const objectCount = r.u8();
    const objects = Array.from({ length: objectCount }, () => {
      const objectId = r.u16();
      const windowId = r.u8();
      const flags = r.u8();
      const x = r.u16();
      const y = r.u16();
      const crop = flags & 0x80 ? { x: r.u16(), y: r.u16(), width: r.u16(), height: r.u16() } : undefined;
      return { objectId, windowId, forcedOn: (flags & 0x40) !== 0, x, y, ...(crop ? { crop } : {}) };
    });
    return { duration90k, paletteId, objects };
  });
  return { windows, effects };
}

export class IgsError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "IgsError"; } }

class BitReader {
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}
  get remaining(): number { return Math.ceil((this.data.length * 8 - this.bit) / 8); }
  get position(): number { return this.bit >>> 3; }
  bits(n: number): number { if (n < 0 || n > 32 || this.bit + n > this.data.length * 8) throw new IgsError("IGS_INVALID_SEGMENT", `ICS field of ${n} bits exceeds segment`); let value = 0; for (let i = 0; i < n; i++) value = (value << 1) | ((this.data[this.bit >>> 3]! >> (7 - (this.bit & 7))) & 1), this.bit++; return value >>> 0; }
  bigBits(n: number): bigint { if (n < 0 || n > 64 || this.bit + n > this.data.length * 8) throw new IgsError("IGS_INVALID_SEGMENT", `ICS field of ${n} bits exceeds segment`); let value = 0n; for (let i = 0; i < n; i++) value = (value << 1n) | BigInt((this.data[this.bit >>> 3]! >> (7 - (this.bit & 7))) & 1), this.bit++; return value; }
  u8(): number { this.align(); return this.bits(8); }
  u16(): number { this.align(); return this.bits(16); }
  u24(): number { this.align(); return this.bits(24); }
  bytes(n: number): Uint8Array { this.align(); const start = this.position; this.skip(n); return this.data.slice(start, start + n); }
  skip(n: number): void { this.align(); if (!Number.isSafeInteger(n) || n < 0 || this.bit + n * 8 > this.data.length * 8) throw new IgsError("IGS_INVALID_SEGMENT", `ICS skip of ${n} bytes exceeds segment`); this.bit += n * 8; }
  private align(): void { this.bit = (this.bit + 7) & ~7; }
}

function error(code: string, message: string, src: IgsDiagnostic["source"], affectedSceneIds: string[] = []): IgsDiagnostic { return { severity: "error", code, message, source: src, affectedSceneIds }; }
function sceneId(src: IgsDiagnostic["source"]): string { return `${src?.clipId ?? "unknown"}:${src?.pid ?? 0}:${src?.packetOffset ?? 0}`; }
function u16(bytes: Uint8Array, pos: number): number { return (bytes[pos]! << 8) | bytes[pos + 1]!; }
function u24(bytes: Uint8Array, pos: number): number { return (bytes[pos]! << 16) | (bytes[pos + 1]! << 8) | bytes[pos + 2]!; }
function join(a: Uint8Array, b: Uint8Array): Uint8Array { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
function cachePrefix(pid: number, timeDomain: number): string { return `${pid}:${timeDomain}:`; }
function cacheKey(pid: number, timeDomain: number, id: number, version: number): string { return `${cachePrefix(pid, timeDomain)}${id}:${version}`; }
