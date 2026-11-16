/**
 * Grow a committed clip into the input a whole-clip read case needs.
 *
 * Every case input ships with the repository, so the clips themselves are small
 * (kilobytes). A command that reads a clip end to end spends its time in the
 * scan, and a few kilobytes of input measures process start instead. Two ways of
 * growing a clip answer different questions:
 *
 * - `growWithNullPackets` appends stuffing (PID 0x1fff). The scan reads the bytes
 *   and skips every packet, so the row is the I/O ceiling of that command and not
 *   a description of what a real clip costs.
 * - `growWithRepeatedPackets` repeats the clip's own packets and continues each
 *   PID's continuity counter. The readers key their output on presentation
 *   timestamps, so the printed sizes and the extracted assets stay identical while
 *   the scan walks megabytes of real packets.
 *
 * A case that should describe a real input uses the second; the first stays only
 * for rows that are explicitly named as an I/O ceiling.
 */
const PACKET = 192;
/** M2TS: a 4-byte TP_extra_header precedes each 188-byte packet. */
const SYNC_OFFSET = 4;
const NULL_PID = 0x1fff;
/** Payload share above which a clip case measures skipped stuffing instead of work. */
export const NULL_SHARE_CEILING = 0.3;

function nullPacket() {
  const frame = new Uint8Array(PACKET);
  frame.fill(0xff);
  frame[SYNC_OFFSET] = 0x47;
  // PID 0x1fff is the null packet; it belongs to no program.
  frame[SYNC_OFFSET + 1] = 0x1f;
  frame[SYNC_OFFSET + 2] = 0xff;
  frame[SYNC_OFFSET + 3] = 0x10;
  return frame;
}

function checkTarget(bytes, targetBytes, name) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < bytes.byteLength) throw new RangeError(`${name} needs a target of at least ${bytes.byteLength} bytes; received ${targetBytes}`);
  if (bytes.byteLength % PACKET !== 0) throw new RangeError(`${name} needs a clip aligned to ${PACKET}-byte frames; received ${bytes.byteLength} bytes`);
}

/** `bytes` followed by null packets up to `targetBytes`, aligned to the 192-byte frame. */
export function growWithNullPackets(bytes, targetBytes) {
  checkTarget(bytes, targetBytes, "growWithNullPackets");
  const packets = Math.ceil((targetBytes - bytes.byteLength) / PACKET);
  const out = new Uint8Array(bytes.byteLength + packets * PACKET);
  out.set(bytes);
  const frame = nullPacket();
  for (let index = 0; index < packets; index++) out.set(frame, bytes.byteLength + index * PACKET);
  return out;
}

/**
 * `bytes` repeated up to `targetBytes` with the null packets left out of the
 * repeat, so the grown clip carries real payload end to end.
 *
 * Each PID's continuity counter continues across the repeat boundary, and an
 * adaptation-field-only packet leaves it alone, which is what the transport
 * readers validate. Repeated packets inside one PID do not change the extracted
 * assets: the readers collapse repeated presentation timestamps.
 */
export function growWithRepeatedPackets(bytes, targetBytes) {
  checkTarget(bytes, targetBytes, "growWithRepeatedPackets");
  const offsets = [];
  for (let offset = 0; offset + PACKET <= bytes.byteLength; offset += PACKET) {
    const header = offset + SYNC_OFFSET;
    if (bytes[header] !== 0x47) throw new Error(`growWithRepeatedPackets found no sync byte at frame ${offset / PACKET}`);
    const pid = ((bytes[header + 1] & 0x1f) << 8) | bytes[header + 2];
    if (pid !== NULL_PID) offsets.push(offset);
  }
  if (!offsets.length) throw new Error("growWithRepeatedPackets needs at least one real packet");
  const copies = Math.max(1, Math.ceil(targetBytes / (offsets.length * PACKET)));
  const out = new Uint8Array(copies * offsets.length * PACKET);
  const counters = new Map();
  let write = 0;
  for (let copy = 0; copy < copies; copy++) {
    for (const offset of offsets) {
      const source = offset + SYNC_OFFSET;
      const pid = ((bytes[source + 1] & 0x1f) << 8) | bytes[source + 2];
      out.set(bytes.subarray(offset, offset + PACKET), write);
      const header = write + SYNC_OFFSET;
      write += PACKET;
      // An adaptation field without payload keeps the counter; only payload advances it.
      if (((bytes[source + 3] >> 4) & 0x3) === 0x2) continue;
      const previous = counters.get(pid);
      const next = previous === undefined ? bytes[source + 3] & 0x0f : (previous + 1) & 0x0f;
      counters.set(pid, next);
      out[header + 3] = (out[header + 3] & 0xf0) | next;
    }
  }
  return out;
}

/**
 * Reject a clip case whose input is mostly stuffing.
 *
 * A case that reads a whole clip is only informative while real packets dominate
 * it; otherwise the row measures how fast the reader skips, which the startup row
 * already states more cheaply. A row that exists to report that ceiling passes
 * `ioCeiling` and is exempt.
 */
export function assertScanInput(caseId, transport, { ioCeiling = false } = {}) {
  if (ioCeiling || !transport || transport.nullPacketShare <= NULL_SHARE_CEILING) return;
  throw new Error(`${caseId}: ${(transport.nullPacketShare * 100).toFixed(1)}% of its ${transport.packets} packets are null. A whole-clip case needs real packets or it only measures a skipped scan; mark it as an I/O ceiling case to keep that meaning.`);
}
