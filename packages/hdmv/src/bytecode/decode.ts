import type { MovieInstruction, SourceLocation } from "@bdmv2web/bdmv-parser";
import { bytesToHex } from "@bdmv2web/utils";

export type Operand = { kind: "immediate" | "gpr" | "psr" | "encoded"; value: number; raw: number; invalid?: true };
export type OpcodeName = "NOP" | "GOTO" | "BREAK" | "JUMP_OBJECT" | "JUMP_TITLE" | "CALL_OBJECT" | "CALL_TITLE" | "RESUME" | "PLAY_PL" | "PLAY_PL_PI" | "PLAY_PL_PM" | "TERMINATE_PL" | "LINK_PI" | "LINK_MK" | "BC" | "EQ" | "NE" | "GE" | "GT" | "LE" | "LT" | "MOVE" | "SWAP" | "ADD" | "SUB" | "MUL" | "DIV" | "MOD" | "RND" | "AND" | "OR" | "XOR" | "BITSET" | "BITCLR" | "SHL" | "SHR" | "SET_STREAM" | "SET_NV_TIMER" | "SET_BUTTON_PAGE" | "ENABLE_BUTTON" | "DISABLE_BUTTON" | "SET_SEC_STREAM" | "POPUP_OFF" | "STILL_ON" | "STILL_OFF" | "SET_OUTPUT_MODE" | "SET_STREAM_SS" | "SETSYSTEM_0x10";
export interface RawCommand { words: [number, number, number]; bytes: string; source: SourceLocation; }
export interface DecodedInstruction extends RawCommand {
  group: number; subGroup: number; opCount: number; immOp1: boolean; immOp2: boolean;
  branchOption: number; compareOption: number; setOption: number; opcode: OpcodeName | null;
  operands: [Operand | null, Operand | null]; issues: string[]; status: "reference-only" | "unverified" | "invalid";
}

const goto = ["NOP", "GOTO", "BREAK"] as const;
const jump = ["JUMP_OBJECT", "JUMP_TITLE", "CALL_OBJECT", "CALL_TITLE", "RESUME"] as const;
const play = ["PLAY_PL", "PLAY_PL_PI", "PLAY_PL_PM", "TERMINATE_PL", "LINK_PI", "LINK_MK"] as const;
const compare = ["", "BC", "EQ", "NE", "GE", "GT", "LE", "LT"] as const;
const arithmetic = ["", "MOVE", "SWAP", "ADD", "SUB", "MUL", "DIV", "MOD", "RND", "AND", "OR", "XOR", "BITSET", "BITCLR", "SHL", "SHR"] as const;
const system = ["", "SET_STREAM", "SET_NV_TIMER", "SET_BUTTON_PAGE", "ENABLE_BUTTON", "DISABLE_BUTTON", "SET_SEC_STREAM", "POPUP_OFF", "STILL_ON", "STILL_OFF", "SET_OUTPUT_MODE", "SET_STREAM_SS"] as const;

const RESERVED_WORD0_BITS = 0x0030f0e0;
const RAW_SOURCE: SourceLocation = { path: "<raw-command>", origin: "primary", offset: "0" };
const SPECIAL_REGISTER_SET_OPTIONS = new Set([1, 3, 6]);
const ZERO_OPERAND_OPCODES = new Set<OpcodeName>(["NOP", "BREAK", "RESUME", "TERMINATE_PL", "POPUP_OFF", "STILL_ON", "STILL_OFF"]);
const TWO_OPERAND_OPCODES = new Set<OpcodeName>(["SWAP", "MOVE", "ADD", "SUB", "MUL", "DIV", "MOD", "RND", "AND", "OR", "XOR", "BITSET", "BITCLR", "SHL", "SHR", "BC", "EQ", "NE", "GE", "GT", "LE", "LT", "PLAY_PL_PI", "PLAY_PL_PM", "SET_STREAM", "SET_NV_TIMER", "SET_BUTTON_PAGE", "SET_SEC_STREAM", "SET_STREAM_SS"]);
const IMMEDIATE_DESTINATION_ILLEGAL = new Set<OpcodeName>(["MOVE", "SWAP", "ADD", "SUB", "MUL", "DIV", "MOD", "AND", "OR", "XOR", "BITSET", "BITCLR", "SHL", "SHR"]);

/** A canonical lowercase 24-character hex command needs no normalization. */
function isPlainCommandHex(value: string): boolean {
  if (value.length !== 24) return false;
  for (let index = 0; index < 24; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false;
  }
  return true;
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** Decode 24 hex characters straight into the three big-endian words. */
function wordsFromHex(value: string): [number, number, number] | null {
  if (value.length !== 24) return null;
  let w0 = 0, w1 = 0, w2 = 0;
  for (let index = 0; index < 24; index++) {
    const nibble = hexNibble(value.charCodeAt(index));
    if (nibble < 0) return null;
    if (index < 8) w0 = (w0 << 4) | nibble;
    else if (index < 16) w1 = (w1 << 4) | nibble;
    else w2 = (w2 << 4) | nibble;
  }
  return [w0 >>> 0, w1 >>> 0, w2 >>> 0];
}

function wordsFrom(bytes: Uint8Array): [number, number, number] {
  return [
    ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0,
    ((bytes[4]! << 24) | (bytes[5]! << 16) | (bytes[6]! << 8) | bytes[7]!) >>> 0,
    ((bytes[8]! << 24) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!) >>> 0,
  ];
}

function bytesFrom(input: MovieInstruction | RawCommand | Uint8Array | string): { bytes: string; words: [number, number, number]; source: SourceLocation } {
  if (input instanceof Uint8Array) {
    if (input.length !== 12) throw new RangeError(`HDMV command must be 12 bytes; received ${input.length}`);
    return { bytes: bytesToHex(input), words: wordsFrom(input), source: RAW_SOURCE };
  }
  if (typeof input === "string") {
    // Canonical lowercase input is used as-is; other input is normalized once
    // before word extraction.
    const bytes = isPlainCommandHex(input) ? input : input.replace(/\s|0x/gi, "").toLowerCase();
    const words = wordsFromHex(bytes);
    if (!words) throw new TypeError("HDMV command hex must contain exactly 24 hexadecimal characters");
    return { bytes, words, source: RAW_SOURCE };
  }
  const bytes = isPlainCommandHex(input.bytes) ? input.bytes : input.bytes.toLowerCase();
  const words = wordsFromHex(bytes);
  if (!words) throw new TypeError("M1 instruction bytes must contain exactly 24 hexadecimal characters");
  if ("words" in input && input.words.some((word, index) => word !== words[index])) throw new TypeError("M1 instruction words do not match its raw bytes");
  return { bytes, words, source: input.source };
}

function operand(raw: number, immediate: boolean): Operand {
  if (immediate) return { kind: "immediate", value: raw >>> 0, raw: raw >>> 0 };
  const isPsr = (raw & 0x80000000) !== 0;
  const validMask = isPsr ? 0x8000007f : 0x00000fff;
  return { kind: isPsr ? "psr" : "gpr", value: raw & (isPsr ? 0x7f : 0xfff), raw: raw >>> 0, ...(raw & ~validMask ? { invalid: true } : {}) };
}

export function decodeInstruction(input: MovieInstruction | RawCommand | Uint8Array | string, source?: SourceLocation): DecodedInstruction {
  const raw = bytesFrom(input);
  const [w0, w1, w2] = raw.words;
  const opCount = w0 >>> 29;
  const group = (w0 >>> 27) & 3;
  const subGroup = (w0 >>> 24) & 7;
  const immOp1 = !!(w0 & 0x00800000);
  const immOp2 = !!(w0 & 0x00400000);
  const branchOption = (w0 >>> 16) & 0xf;
  const compareOption = (w0 >>> 8) & 0xf;
  const setOption = w0 & 0x1f;
  const issues: string[] = [];
  if ((w0 & RESERVED_WORD0_BITS) !== 0) issues.push("HDMV_RESERVED_BITS_NONZERO");
  if (opCount > 2) issues.push("HDMV_INVALID_OPERAND_COUNT");
  const specialRegisterWords = group === 2 && subGroup === 1 && SPECIAL_REGISTER_SET_OPTIONS.has(setOption);
  const operands: [Operand | null, Operand | null] = [opCount > 0 ? specialRegisterWords && !immOp1 ? { kind: "encoded", value: w1 >>> 0, raw: w1 >>> 0 } : operand(w1, immOp1) : null, opCount > 1 ? specialRegisterWords && !immOp2 ? { kind: "encoded", value: w2 >>> 0, raw: w2 >>> 0 } : operand(w2, immOp2) : null];
  if ((operands[0] !== null && "invalid" in operands[0]) || (operands[1] !== null && "invalid" in operands[1])) issues.push("HDMV_INVALID_REGISTER_ENCODING");
  let opcode: OpcodeName | null = null;
  if (group === 0) opcode = subGroup === 0 ? goto[branchOption] ?? null : subGroup === 1 ? jump[branchOption] ?? null : subGroup === 2 ? play[branchOption] ?? null : null;
  else if (group === 1) opcode = compare[compareOption] || null;
  else if (group === 2) opcode = subGroup === 0 ? arithmetic[setOption] || null : subGroup === 1 ? (system[setOption] as OpcodeName | undefined) ?? (setOption === 0x10 ? "SETSYSTEM_0x10" : null) : null;
  else issues.push("HDMV_UNKNOWN_GROUP");
  if (!opcode) issues.push("HDMV_UNKNOWN_OPCODE");
  const expected = !opcode ? 0
    : ZERO_OPERAND_OPCODES.has(opcode) ? 0
      : opcode === "SETSYSTEM_0x10" ? 2
        : TWO_OPERAND_OPCODES.has(opcode) ? 2 : 1;
  if (opcode && opCount !== expected) issues.push("HDMV_ILLEGAL_OPERAND_COUNT");
  if (operands[0]?.kind === "immediate" && opcode && IMMEDIATE_DESTINATION_ILLEGAL.has(opcode)) issues.push("HDMV_ILLEGAL_DESTINATION");
  if (opcode === "RND" && operands[0]?.kind !== "gpr") issues.push("HDMV_ILLEGAL_DESTINATION");
  return { ...raw, source: source ?? raw.source, group, subGroup, opCount, immOp1, immOp2, branchOption, compareOption, setOption, opcode, operands, issues, status: !opcode ? "invalid" : issues.length ? "unverified" : "reference-only" };
}

export function disassemble(input: MovieInstruction | RawCommand | Uint8Array | string, source?: SourceLocation): string {
  const d = decodeInstruction(input, source);
  const args = d.operands.filter((x): x is Operand => x !== null).map((x) => `${x.kind.toUpperCase()}[${x.value}]`).join(", ");
  return `${d.opcode ?? "UNKNOWN"}${args ? ` ${args}` : ""}${d.issues.length ? ` ; ${d.issues.join(",")}` : ""}`;
}
