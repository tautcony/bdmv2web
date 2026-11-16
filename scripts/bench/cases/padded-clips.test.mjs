import assert from "node:assert/strict";
import { test } from "node:test";
import { padClipBytes } from "./padded-clips.mjs";

const packet = (pid, payload) => {
  const frame = new Uint8Array(192);
  frame.fill(0xff);
  frame[4] = 0x47;
  frame[5] = (pid >> 8) & 0x1f;
  frame[6] = pid & 0xff;
  frame[7] = 0x10;
  frame.set(payload, 8);
  return frame;
};

test("keeps the committed packets and appends null packets up to the target", () => {
  const clip = new Uint8Array([...packet(0x1400, [1, 2, 3]), ...packet(0x1200, [4, 5])]);
  const padded = padClipBytes(clip, 192 * 6);
  assert.equal(padded.byteLength, 192 * 6);
  assert.deepEqual(padded.subarray(0, clip.byteLength), clip);
  for (let offset = clip.byteLength; offset < padded.byteLength; offset += 192) {
    assert.equal(padded[offset + 4], 0x47);
    assert.equal(((padded[offset + 5] & 0x1f) << 8) | padded[offset + 6], 0x1fff);
  }
});

test("rounds the appended packets up to the next 192-byte frame", () => {
  const clip = new Uint8Array(192);
  const padded = padClipBytes(clip, 500);
  assert.equal(padded.byteLength % 192, 0);
  assert.ok(padded.byteLength >= 500);
});

test("rejects a target smaller than the clip", () => {
  assert.throws(() => padClipBytes(new Uint8Array(192), 100), RangeError);
});
