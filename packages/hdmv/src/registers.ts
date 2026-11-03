import type { PlayerProfile as CorePlayerProfile } from "@bdmv-web/core";

export const GPR_COUNT = 4096;
export const PSR_COUNT = 128;
const READ_ONLY_PSRS = new Set([
  13, // parental level
  ...Array.from({ length: 7 }, (_, i) => 15 + i), // player settings/capabilities
  ...Array.from({ length: 9 }, (_, i) => 23 + i), // display/profile capabilities
  ...Array.from({ length: 14 }, (_, i) => 48 + i), // player capability words
]);
/**
 * Product-facing profile values follow the shared core contract. Numeric values
 * remain accepted as already encoded PSR words for callers that have their own
 * verified profile source. Raw capability/output words are caller supplied.
 */
export type PlayerProfile = Omit<Partial<CorePlayerProfile>, "audioLanguage" | "subtitleLanguage" | "menuLanguage" | "country" | "region"> & {
  audioLanguage?: string | number;
  subtitleLanguage?: string | number;
  menuLanguage?: string | number;
  country?: string | number;
  region?: "A" | "B" | "C" | number;
  /** Product profile label. There is no verified mapping from `portable` to PSR21. */
  outputProfile?: "portable";
  /** Raw PSR21 value, if a caller has verified the intended encoding. */
  outputPreference?: number;
  /** Raw uint32 values indexed by capability/profile PSR number. */
  capabilityValues?: Partial<Record<number, number>>;
};
export const PSR = { igStream: 0, primaryAudio: 1, pgStream: 2, angle: 3, title: 4, chapter: 5, playlist: 6, playItem: 7, presentationTime: 8, navigationTimer: 9, selectedButton: 10, menuPage: 11, style: 12, parentalLevel: 13, secondaryAudioVideo: 14, audioCapability: 15, audioLanguage: 16, pgSubtitleLanguage: 17, menuLanguage: 18, country: 19, region: 20, outputPreference: 21, stereoscopicStatus: 22, displayCapability: 23, threeDCapability: 24, uhdCapability: 25, uhdDisplayCapability: 26, hdrPreference: 27, sdrConversionPreference: 28, videoCapability: 29, textCapability: 30, profileVersion: 31 } as const;
export type RegisterRef = { kind: "gpr" | "psr"; index: number };
export class RegisterFault extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Register defaults observed in pinned libbluray 1.5.0 register.c (reference-only). */
export class RegisterFile {
  readonly gpr = new Uint32Array(GPR_COUNT);
  readonly psr = new Uint32Array(PSR_COUNT);
  constructor(profile: PlayerProfile = {}) { this.reset(profile); }
  reset(profile: PlayerProfile = {}): void {
    this.gpr.fill(0); this.psr.fill(0);
    const defaults: Record<number, number> = { 0: 1, 1: 0xff, 2: 0x0fff0fff, 3: 1, 4: 0xffff, 5: 0xffff, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0xffff, 11: 0, 12: 0xff, 13: 0xff, 14: 0xffff, 15: 0xaaaa, 16: 0xffffff, 17: 0xffffff, 18: 0xffffff, 19: 0xffff, 20: 2, 21: 0, 22: 0, 23: 0, 24: 0, 25: 0, 26: 0, 27: 0, 28: 0, 29: 0x03, 30: 0x1ffff, 31: 0x00030200, 36: 0xffff, 37: 0xffff, 38: 0, 39: 0, 40: 0, 42: 0xffff, 43: 0, 44: 0xff };
    for (const [index, value] of Object.entries(defaults)) this.psr[Number(index)] = value;
    this.psr[16] = profileWord(profile.audioLanguage, "eng", 3, "audioLanguage");
    this.psr[17] = profileWord(profile.subtitleLanguage, "eng", 3, "subtitleLanguage");
    this.psr[18] = profileWord(profile.menuLanguage, "eng", 3, "menuLanguage");
    this.psr[19] = profileWord(profile.country, "US", 2, "country");
    this.psr[20] = regionWord(profile.region ?? "A");
    // `outputProfile: portable` is intentionally a product-level label only.
    // PSR21 expresses a distinct output preference and no verified portable mapping exists.
    this.psr[21] = uint32(profile.outputPreference ?? defaults[21]!, "outputPreference");
    for (let i = 48; i <= 61; i++) this.psr[i] = 0xffffffff;
    for (const [index, value] of Object.entries(profile.capabilityValues ?? {})) {
      const psr = Number(index);
      if (!(psr === 15 || (psr >= 23 && psr <= 31) || (psr >= 48 && psr <= 61))) throw new TypeError(`PSR ${psr} is not a player capability/profile register`);
      // Profile initialization supplies values for registers that are read-only
      // to runtime updates. This is the constructor/reset path, not a PSR write.
      this.psr[psr] = uint32(value as number, `capabilityValues[${psr}]`);
    }
  }
  read(ref: RegisterRef): number {
    const slot = ref.kind === "gpr" ? this.gpr : this.psr;
    if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= slot.length) throw new RegisterFault("INVALID_REGISTER_ACCESS", `${ref.kind.toUpperCase()} index ${ref.index} is out of range`);
    return slot[ref.index]!;
  }
  write(ref: RegisterRef, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RegisterFault("INVALID_REGISTER_VALUE", `Register value ${value} is not uint32`);
    if (ref.kind === "psr") throw new RegisterFault("INVALID_REGISTER_ACCESS", `Program write to PSR ${ref.index} is not permitted`);
    this.writeSlot(this.gpr, ref.index, value);
  }
  /** Apply a runtime/system PSR update using libbluray's writable-register policy. */
  systemWrite(index: number, value: number): void {
    this.validateIndex(this.psr, index, "PSR");
    if (READ_ONLY_PSRS.has(index)) throw new RegisterFault("INVALID_REGISTER_ACCESS", `System update to read-only PSR ${index} is not permitted`);
    this.writeSlot(this.psr, index, value);
  }
  snapshot(): { gpr: number[]; psr: number[] } { return { gpr: [...this.gpr], psr: [...this.psr] }; }
  private writeSlot(slot: Uint32Array, index: number, value: number): void {
    this.validateIndex(slot, index);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RegisterFault("INVALID_REGISTER_VALUE", `Register value ${value} is not uint32`);
    slot[index] = value >>> 0;
  }
  private validateIndex(slot: Uint32Array, index: number, kind = "Register"): void {
    if (!Number.isInteger(index) || index < 0 || index >= slot.length) throw new RegisterFault("INVALID_REGISTER_ACCESS", `${kind} index ${index} is out of range`);
  }
}

function profileWord(value: string | number | undefined, fallback: string, width: number, name: string): number {
  if (value === undefined) value = fallback;
  if (typeof value === "number") return uint32(value, name);
  if (value.length !== width || !/^[A-Za-z]+$/.test(value)) throw new TypeError(`${name} must be ${width} ASCII letters or an encoded uint32 PSR word`);
  let word = 0;
  for (let i = 0; i < value.length; i += 1) word = (word * 256 + value.charCodeAt(i)) >>> 0;
  return word;
}

function regionWord(value: "A" | "B" | "C" | number): number {
  if (typeof value === "number") return uint32(value, "region");
  if (value === "A") return 1;
  if (value === "B") return 2;
  if (value === "C") return 4;
  throw new TypeError("region must be A, B, C, or an encoded uint32 PSR word");
}

function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError(`${name} must be an unsigned 32-bit integer`);
  return value;
}
