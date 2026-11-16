import assert from "node:assert/strict";
import { test } from "node:test";
import { NULL_SHARE_CEILING, assertScanInput, growWithNullPackets, growWithRepeatedPackets } from "./clip-growth.mjs";

const PACKET = 192;
const SYNC = 4;
const packet = (pid, payload, cc = 0) => {
  const frame = new Uint8Array(PACKET);
  frame.fill(0xff);
  frame[SYNC] = 0x47;
  frame[SYNC + 1] = (pid >> 8) & 0x1f;
  frame[SYNC + 2] = pid & 0xff;
  frame[SYNC + 3] = 0x10 | (cc & 0x0f);
  frame.set(payload, SYNC + 4);
  return frame;
};
const read = (bytes, offset) => {
  const header = offset * PACKET + SYNC;
  return { pid: ((bytes[header + 1] & 0x1f) << 8) | bytes[header + 2], cc: bytes[header + 3] & 0x0f };
};

test("keeps the committed packets and appends null packets up to the target", () => {
  const clip = new Uint8Array([...packet(0x1400, [1, 2, 3]), ...packet(0x1200, [4, 5])]);
  const grown = growWithNullPackets(clip, PACKET * 6);
  assert.equal(grown.byteLength, PACKET * 6);
  assert.deepEqual(grown.subarray(0, clip.byteLength), clip);
  for (let frame = clip.byteLength / PACKET; frame < grown.byteLength / PACKET; frame++) {
    assert.equal(grown[frame * PACKET + SYNC], 0x47);
    assert.equal(read(grown, frame).pid, 0x1fff);
  }
});

test("repeats the real packets, drops the stuffing, and continues every counter", () => {
  const clip = new Uint8Array([
    ...packet(0x1400, [1], 0), ...packet(0x1200, [2], 0), ...packet(0x1fff, [], 0),
    ...packet(0x1400, [3], 1), ...packet(0x1200, [4], 1), ...packet(0x1fff, [], 0),
  ]);
  const grown = growWithRepeatedPackets(clip, PACKET * 12);
  assert.equal(grown.byteLength % PACKET, 0);
  assert.ok(grown.byteLength >= PACKET * 12);
  const frames = grown.byteLength / PACKET;
  const counters = new Map();
  for (let frame = 0; frame < frames; frame++) {
    const { pid, cc } = read(grown, frame);
    assert.notEqual(pid, 0x1fff, "the repeat carries no null packets");
    const expected = counters.has(pid) ? (counters.get(pid) + 1) & 0x0f : cc;
    assert.equal(cc, expected, `frame ${frame} on PID ${pid.toString(16)} continued its counter`);
    counters.set(pid, cc);
  }
});

test("a repeated clip reports no stuffing and a null clip reports all of it", () => {
  const clip = new Uint8Array([...packet(0x1400, [1]), ...packet(0x1200, [2]), ...packet(0x1fff, [])]);
  const share = (bytes) => {
    let nulls = 0;
    for (let frame = 0; frame < bytes.byteLength / PACKET; frame++) if (read(bytes, frame).pid === 0x1fff) nulls++;
    return nulls / (bytes.byteLength / PACKET);
  };
  assert.equal(share(growWithRepeatedPackets(clip, PACKET * 9)), 0);
  assert.equal(share(growWithNullPackets(clip, PACKET * 9)), 7 / 9);
});

test("a clip case above the stuffing ceiling is rejected unless it is an I/O ceiling", () => {
  const transport = { packets: 100, nullPackets: 40, nullPacketShare: 0.4 };
  assert.throws(() => assertScanInput("cli.perf.example", transport), /40\.0% of its 100 packets are null/);
  assert.doesNotThrow(() => assertScanInput("cli.io.example", transport, { ioCeiling: true }));
  assert.doesNotThrow(() => assertScanInput("cli.perf.example", { packets: 100, nullPackets: 10, nullPacketShare: 0.1 }));
  assert.ok(NULL_SHARE_CEILING < 0.5);
});

test("rejects a target smaller than the clip", () => {
  assert.throws(() => growWithNullPackets(new Uint8Array(PACKET), 100), RangeError);
  assert.throws(() => growWithRepeatedPackets(new Uint8Array(PACKET), 100), RangeError);
});

test("rejects a clip that is not frame aligned", () => {
  assert.throws(() => growWithRepeatedPackets(new Uint8Array(PACKET + 3), PACKET * 4), RangeError);
});
