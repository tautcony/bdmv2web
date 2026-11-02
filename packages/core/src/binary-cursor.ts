import { ContractError } from "./index.js";

export class BinaryCursor {
  private position = 0;
  constructor(private readonly window: Uint8Array, readonly baseOffset = 0) {
    if (!Number.isSafeInteger(baseOffset) || baseOffset < 0 || !Number.isSafeInteger(baseOffset + window.byteLength)) {
      throw new ContractError("INVALID_WINDOW", "/window", "Window base and length must fit safe integer offsets");
    }
  }
  get offset(): number { return this.position; }
  get length(): number { return this.window.byteLength; }
  get sourceOffset(): number { return this.baseOffset + this.position; }
  private checkLength(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) throw new ContractError("INVALID_LENGTH", "/length", "Length must be a non-negative safe integer");
    if (size > this.length - this.position) throw new ContractError("TRUNCATED_INPUT", "/offset", `Expected ${size} bytes, only ${this.length - this.position} remain`);
  }
  u8(): number { this.checkLength(1); const v = this.window[this.position]!; this.position += 1; return v; }
  u16be(): number { this.checkLength(2); const p = this.position; const v = (this.window[p]! << 8) | this.window[p + 1]!; this.position += 2; return v; }
  u32be(): number { this.checkLength(4); const p = this.position; const v = new DataView(this.window.buffer, this.window.byteOffset + p, 4).getUint32(0, false); this.position += 4; return v; }
  u64be(): bigint {
    this.checkLength(8); const p = this.position;
    const v = new DataView(this.window.buffer, this.window.byteOffset + p, 8).getBigUint64(0, false);
    this.position += 8; return v;
  }
  bytes(size: number): Uint8Array { this.checkLength(size); const p = this.position; this.position += size; return this.window.subarray(p, p + size); }
  seek(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ContractError("INVALID_OFFSET", "/offset", "Offset must be a non-negative safe integer");
    if (offset > this.length) throw new ContractError("TRUNCATED_INPUT", "/offset", `Offset ${offset} exceeds window length ${this.length}`);
    this.position = offset;
  }
  subview(size: number): BinaryCursor {
    this.checkLength(size);
    const p = this.position;
    const sub = new BinaryCursor(this.window.subarray(p, p + size), this.baseOffset + p);
    this.position += size;
    return sub;
  }
  checkedProduct(count: number, size: number): number {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(size) || size < 0) throw new ContractError("INVALID_LENGTH", "/count", "Count and item size must be non-negative safe integers");
    const product = count * size;
    if (!Number.isSafeInteger(product)) throw new ContractError("INTEGER_OVERFLOW", "/count", "Count multiplied by item size exceeds safe integer range");
    return product;
  }
}
