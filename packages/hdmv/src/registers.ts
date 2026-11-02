export const GPR_COUNT = 4096;
export const PSR_COUNT = 128;
export type PlayerProfile = { audioLanguage?: number; subtitleLanguage?: number; menuLanguage?: number; country?: number; region?: number; outputPreference?: number; capabilityValues?: Partial<Record<number, number>> };
export const PSR = { igStream: 0, primaryAudio: 1, pgStream: 2, angle: 3, title: 4, chapter: 5, playlist: 6, playItem: 7, presentationTime: 8, navigationTimer: 9, selectedButton: 10, menuPage: 11, style: 12, parentalLevel: 13, secondaryAudioVideo: 14, audioCapability: 15, audioLanguage: 16, pgSubtitleLanguage: 17, menuLanguage: 18, country: 19, region: 20, outputPreference: 21, stereoscopicStatus: 22, displayCapability: 23, threeDCapability: 24, uhdCapability: 25, uhdDisplayCapability: 26, hdrPreference: 27, sdrConversionPreference: 28, videoCapability: 29, textCapability: 30, profileVersion: 31 } as const;
export type RegisterRef = { kind: "gpr" | "psr"; index: number };
export class RegisterFault extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Register defaults observed in libbluray 1.5.0 register.c (reference-only). Capability words that depend on player build/profile are supplied in PlayerProfile. */
export class RegisterFile {
  readonly gpr = new Uint32Array(GPR_COUNT);
  readonly psr = new Uint32Array(PSR_COUNT);
  constructor(profile: PlayerProfile = {}) { this.reset(profile); }
  reset(profile: PlayerProfile = {}): void {
    this.gpr.fill(0); this.psr.fill(0);
    const defaults: Record<number, number> = { 0: 1, 1: 0xff, 2: 0x0fff0fff, 3: 1, 4: 0xffff, 5: 0xffff, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0xffff, 11: 0, 12: 0xff, 13: 0xff, 14: 0xffff, 16: 0xffffff, 17: 0xffffff, 18: 0xffffff, 19: 0xffff, 22: 0, 30: 0x1ffff, 36: 0xffff, 37: 0xffff, 38: 0, 39: 0, 40: 0, 42: 0xffff, 43: 0, 44: 0xff };
    for (const [index, value] of Object.entries(defaults)) this.psr[Number(index)] = value;
    this.psr[16] = profile.audioLanguage ?? defaults[16]!; this.psr[17] = profile.subtitleLanguage ?? defaults[17]!; this.psr[18] = profile.menuLanguage ?? defaults[18]!;
    this.psr[19] = profile.country ?? defaults[19]!; this.psr[20] = profile.region ?? 2; this.psr[21] = profile.outputPreference ?? 0;
    for (const [index, value] of Object.entries(profile.capabilityValues ?? {})) {
      const psr = Number(index);
      if (!(psr === 15 || (psr >= 23 && psr <= 31) || (psr >= 48 && psr <= 61))) throw new TypeError(`PSR ${psr} is not a player capability/profile register`);
      this.systemWrite(psr, value as number);
    }
    for (let i = 48; i <= 61; i++) this.psr[i] = 0xffffffff;
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
  systemWrite(index: number, value: number): void { this.writeSlot(this.psr, index, value); }
  snapshot(): { gpr: number[]; psr: number[] } { return { gpr: [...this.gpr], psr: [...this.psr] }; }
  private writeSlot(slot: Uint32Array, index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= slot.length) throw new RegisterFault("INVALID_REGISTER_ACCESS", `Register index ${index} is out of range`);
    slot[index] = value >>> 0;
  }
}
