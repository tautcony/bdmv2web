/**
 * Grow a committed clip into the input a whole-clip read case needs.
 *
 * Every case input ships with the repository, so the clips themselves are small
 * (kilobytes). A command that reads a clip end to end spends its time in the
 * scan, and a few kilobytes of input measures process start instead. Appending
 * null transport packets keeps the stream valid — the PID carries no elementary
 * stream, so the extracted assets and their byte counts stay identical — and
 * gives the scan the megabytes it needs to be the measured cost.
 */
const NULL_PACKET = 192;

function nullPacket() {
  const frame = new Uint8Array(NULL_PACKET);
  frame.fill(0xff);
  frame[4] = 0x47;
  // PID 0x1fff is the null packet; it belongs to no program.
  frame[5] = 0x1f;
  frame[6] = 0xff;
  frame[7] = 0x10;
  return frame;
}

/** `bytes` followed by null packets up to `targetBytes`, aligned to the 192-byte frame. */
export function padClipBytes(bytes, targetBytes) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < bytes.byteLength) throw new RangeError(`padClipBytes needs a target of at least ${bytes.byteLength} bytes; received ${targetBytes}`);
  const packets = Math.ceil((targetBytes - bytes.byteLength) / NULL_PACKET);
  const out = new Uint8Array(bytes.byteLength + packets * NULL_PACKET);
  out.set(bytes);
  const frame = nullPacket();
  for (let index = 0; index < packets; index++) out.set(frame, bytes.byteLength + index * NULL_PACKET);
  return out;
}
