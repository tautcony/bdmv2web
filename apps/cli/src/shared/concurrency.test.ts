import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("bounded concurrency", () => {
  it("keeps the result in input order regardless of completion order", async () => {
    const items = [30, 10, 1, 20];
    const results = await mapWithConcurrency(items, 2, async (delay) => { await new Promise((resolve) => setTimeout(resolve, delay)); return delay * 2; });
    expect(results).toEqual([60, 20, 2, 40]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, index) => index), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return null;
    });
    expect(peak).toBe(3);
  });

  it("stops starting new work after a failure and rethrows that failure", async () => {
    const started: number[] = [];
    await expect(mapWithConcurrency([0, 1, 2, 3, 4, 5], 1, async (item) => {
      started.push(item);
      if (item === 2) throw new Error(`item ${item} failed`);
      return item;
    })).rejects.toThrow("item 2 failed");
    expect(started).toEqual([0, 1, 2]);
  });

  it("handles an empty list and a limit above the item count", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1, 2], 16, async (item) => item + 1)).resolves.toEqual([2, 3]);
  });
});
