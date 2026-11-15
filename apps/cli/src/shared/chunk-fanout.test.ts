import { describe, expect, it } from "vitest";
import { fanOutChunks, fanOutWithDone } from "./chunk-fanout.js";

async function* chunksOf(...sizes: number[]): AsyncGenerator<Uint8Array> {
  for (const size of sizes) yield new Uint8Array(size).fill(size);
}

async function collect(stream: AsyncIterable<Uint8Array>, onChunk?: (chunk: Uint8Array) => Promise<void> | void): Promise<Uint8Array[]> {
  const seen: Uint8Array[] = [];
  for await (const chunk of stream) {
    await onChunk?.(chunk);
    seen.push(chunk);
  }
  return seen;
}

describe("fanOutChunks", () => {
  it("hands the same ordered chunks to every consumer", async () => {
    const [left, right] = fanOutChunks(chunksOf(3, 4, 5), 2);
    const [a, b] = await Promise.all([collect(left!), collect(right!)]);

    expect(a.map((chunk) => chunk.byteLength)).toEqual([3, 4, 5]);
    expect(b.map((chunk) => chunk.byteLength)).toEqual([3, 4, 5]);
    // One read, shared buffers: consumers must copy anything they keep.
    expect(a[0]).toBe(b[0]);
  });

  it("delivers every chunk once while a slow consumer drains", async () => {
    const order: string[] = [];
    const [left, right] = fanOutChunks(chunksOf(1, 2, 3), 2);
    const [a, b] = await Promise.all([
      collect(left!, () => { order.push("a"); }),
      collect(right!, async (chunk) => { await Promise.resolve(); order.push(`b${chunk.byteLength}`); }),
    ]);

    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(order.filter((entry) => entry.startsWith("b"))).toEqual(["b1", "b2", "b3"]);
  });

  it("keeps the file read within a bounded queue of the slowest consumer", async () => {
    let produced = 0;
    let consumed = 0;
    const source = (async function* () {
      for (let index = 0; index < 5; index++) { produced++; yield new Uint8Array(8); }
    })();
    const [left, right] = fanOutChunks(source, 2);
    const [a, b] = await Promise.all([
      collect(left!),
      collect(right!, async () => { await Promise.resolve(); consumed++; }),
    ]);

    expect(produced - consumed).toBeLessThanOrEqual(1);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
  });

  it("detaches a consumer that leaves early without stalling the others", async () => {
    const [left, right] = fanOutChunks(chunksOf(1, 1, 1, 1), 2);
    const first = await (async () => {
      for await (const chunk of left!) return chunk;
      return null;
    })();
    const rest = await collect(right!);

    expect(first).not.toBeNull();
    expect(rest).toHaveLength(4);
  });

  it("rethrows a read failure in every consumer that is still open", async () => {
    const source = (async function* () {
      yield new Uint8Array(1);
      throw new Error("disk went away");
    })();
    const [left, right] = fanOutChunks(source, 2);
    const results = await Promise.allSettled([collect(left!), collect(right!)]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({ message: "disk went away" });
    }
  });

  it("rejects a consumer count below one", () => {
    expect(() => fanOutChunks(chunksOf(1), 0)).toThrow(RangeError);
  });
});

describe("fanOutWithDone", () => {
  it("drains the source after every consumer leaves when readToEnd is set", async () => {
    let produced = 0;
    const source = (async function* () {
      for (let index = 0; index < 4; index++) { produced++; yield new Uint8Array(1); }
    })();
    const { streams, done } = fanOutWithDone(source, 1, { readToEnd: true });
    for await (const chunk of streams[0]!) { expect(chunk).toHaveLength(1); break; }
    await done;
    expect(produced).toBe(4);
  });

  it("stops the source when every consumer leaves by default", async () => {
    let produced = 0;
    const source = (async function* () {
      for (let index = 0; index < 4; index++) { produced++; yield new Uint8Array(1); }
    })();
    const { streams, done } = fanOutWithDone(source, 1);
    for await (const chunk of streams[0]!) { expect(chunk).toHaveLength(1); break; }
    await done;
    expect(produced).toBeLessThan(4);
  });
});
