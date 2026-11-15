/**
 * Append-only log whose array is shared with snapshots until the next write.
 *
 * The VM keeps three histories (`trace`, `actions`, `diagnostics`) that only ever
 * grow (plus two truncation points) and whose entries are never mutated after
 * creation. A checkpoint borrows the live array, so it holds one reference per
 * entry, and this log copies the *pointer array* (8 B per entry) the first time
 * the VM writes again. The checkpoint therefore never changes while the VM keeps
 * running, and both directions cost O(1) at the lengths a menu session reaches.
 *
 * Arrays handed to a snapshot or installed by `restore` are treated as owned by
 * the caller: this log never mutates them in place while `shared` is set.
 */
export class TrailLog<T> {
  private items: T[];
  private shared = false;

  constructor() {
    this.items = [];
  }

  /** Live entries. Mutating this array directly bypasses copy-on-write. */
  get entries(): T[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }

  push(entry: T): void {
    if (this.shared) this.detach();
    this.items.push(entry);
  }

  /** Drop every entry at or after `index`. */
  truncate(index: number): void {
    if (index >= this.items.length) return;
    if (this.shared) this.detach();
    this.items.length = index;
  }

  /** Empty the log. Keeps array identity when no snapshot shares it. */
  clear(): void {
    if (this.shared) {
      this.items = [];
      this.shared = false;
      return;
    }
    this.items.length = 0;
  }

  /** Borrow the live array for a snapshot without copying. */
  snapshot(): T[] {
    this.shared = true;
    return this.items;
  }

  /** Adopt an externally owned array (a restored checkpoint) without copying. */
  restore(entries: T[]): void {
    this.items = entries;
    this.shared = true;
  }

  private detach(): void {
    this.items = this.items.slice();
    this.shared = false;
  }
}
