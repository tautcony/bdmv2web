import { open, readFile } from "node:fs/promises";
import { join } from "node:path";

export const SAMPLE_FILE = "samples.f64";
export const MEMORY_FILE = "memory.f64";
export const GC_FILE = "gc.f64";
export const SAMPLE_ENCODING = "float64le";
export const BYTES_PER_SAMPLE = 8;
/** Channels of one memory snapshot, in the order they are interleaved in `memory.f64`. */
export const MEMORY_CHANNELS = ["rss", "heapUsed", "external", "arrayBuffers"];
/** Columns of one GC event, in the order they are interleaved in `gc.f64`. */
export const GC_CHANNELS = ["kind", "flags", "durationMs", "startTimeMs"];

export function isSampleRef(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.encoding === SAMPLE_ENCODING;
}

function encode(values) {
  const buffer = Buffer.allocUnsafe(values.length * BYTES_PER_SAMPLE);
  for (let index = 0; index < values.length; index += 1) buffer.writeDoubleLE(values[index], index * BYTES_PER_SAMPLE);
  return buffer;
}

function decode(block) {
  const values = new Float64Array(block.length / BYTES_PER_SAMPLE);
  for (let index = 0; index < values.length; index += 1) values[index] = block.readDoubleLE(index * BYTES_PER_SAMPLE);
  return values;
}

/** Interleave snapshots channel by channel, so a reader can slice one channel out. */
function encodePoints(points, channels) {
  const buffer = Buffer.allocUnsafe(points.length * channels.length * BYTES_PER_SAMPLE);
  let at = 0;
  for (const point of points) for (const channel of channels) { buffer.writeDoubleLE(point[channel] ?? 0, at); at += BYTES_PER_SAMPLE; }
  return buffer;
}

async function readBlock(runDir, ref) {
  if (!runDir) throw new Error(`No source run directory for ${ref.file} samples of ${ref.count} values`);
  const file = await readFile(join(runDir, ref.file));
  const block = file.subarray(ref.offset, ref.offset + ref.count * BYTES_PER_SAMPLE);
  if (block.length !== ref.count * BYTES_PER_SAMPLE) throw new Error(`${join(runDir, ref.file)}: sample block ${ref.offset}+${ref.count} is truncated`);
  return block;
}

/**
 * Writes every fork's per-call milliseconds into `<runDir>/samples.f64` as
 * little-endian float64 and leaves a `{ encoding, file, offset, count }`
 * reference on the fork. References carrying `sourceRunId` are copied from
 * the run directory registered in `sources`.
 *
 * The memory snapshots a fork took go the same way, into `<runDir>/memory.f64`
 * interleaved per channel: a fork records up to 256 four-channel snapshots, which is
 * over a kilobyte of repeated keys per fork in JSON and three times the bytes. The
 * peaks and the sample count stay on the record, so a reader that only wants the
 * summary never opens the binary file. GC events follow into `<runDir>/gc.f64` as
 * four-column float64 rows, leaving only an `eventCount` behind.
 */
export async function writeSampleStore(runDir, rows, { sources = new Map() } = {}) {
  const forks = rows.flatMap((row) => row.forks ?? []);
  await writeMemoryStore(runDir, forks, sources);
  await writeGcStore(runDir, forks, sources);
  const pending = forks.filter((fork) => Array.isArray(fork.rawMsPerCall) || (isSampleRef(fork.rawMsPerCall) && (fork.rawMsPerCall.sourceRunId ?? fork.sourceRunId)));
  if (!pending.length) return null;
  const handle = await open(join(runDir, SAMPLE_FILE), "wx");
  let offset = 0;
  try {
    for (const fork of pending) {
      const current = fork.rawMsPerCall;
      const sourceRunId = current.sourceRunId ?? fork.sourceRunId;
      const block = Array.isArray(current) ? encode(current) : await readBlock(sources.get(sourceRunId), current);
      if (!block.length) throw new Error(`Case ${fork.caseId ?? "unknown"} recorded no samples`);
      await handle.write(block, 0, block.length, offset);
      fork.rawMsPerCall = { encoding: SAMPLE_ENCODING, file: SAMPLE_FILE, offset, count: block.length / BYTES_PER_SAMPLE };
      offset += block.length;
    }
  } finally {
    await handle.close();
  }
  return { file: SAMPLE_FILE, encoding: SAMPLE_ENCODING, bytes: offset, count: offset / BYTES_PER_SAMPLE };
}

async function writeMemoryStore(runDir, forks, sources) {
  const pending = forks.filter((fork) => Array.isArray(fork.memory?.samples) || (isSampleRef(fork.memory?.series) && (fork.memory.series.sourceRunId ?? fork.sourceRunId)));
  if (!pending.length) return;
  const handle = await open(join(runDir, MEMORY_FILE), "wx");
  let offset = 0;
  try {
    for (const fork of pending) {
      const current = fork.memory.samples;
      const sourceRunId = fork.memory.series?.sourceRunId ?? fork.sourceRunId;
      const block = Array.isArray(current) ? encodePoints(current, MEMORY_CHANNELS) : await readBlock(sources.get(sourceRunId), fork.memory.series);
      if (!block.length) throw new Error(`Case ${fork.caseId ?? "unknown"} recorded no memory snapshots`);
      await handle.write(block, 0, block.length, offset);
      fork.memory.series = { encoding: SAMPLE_ENCODING, file: MEMORY_FILE, offset, count: block.length / BYTES_PER_SAMPLE, stride: MEMORY_CHANNELS.length, channels: [...MEMORY_CHANNELS], ...(sourceRunId ? { sourceRunId } : {}) };
      delete fork.memory.samples;
      offset += block.length;
    }
  } finally {
    await handle.close();
  }
}

async function writeGcStore(runDir, forks, sources) {
  const pending = forks.filter((fork) => Array.isArray(fork.gc?.events) || (isSampleRef(fork.gc?.series) && (fork.gc.series.sourceRunId ?? fork.sourceRunId)));
  if (!pending.length) return;
  const handle = await open(join(runDir, GC_FILE), "wx");
  let offset = 0;
  try {
    for (const fork of pending) {
      const current = fork.gc.events;
      const sourceRunId = fork.gc.series?.sourceRunId ?? fork.sourceRunId;
      // A fork with no GC during the window is normal, so an empty block is written
      // as a zero-count reference rather than being rejected like missing timing samples.
      const block = Array.isArray(current) ? encodePoints(current, GC_CHANNELS) : await readBlock(sources.get(sourceRunId), fork.gc.series);
      await handle.write(block, 0, block.length, offset);
      fork.gc.series = { encoding: SAMPLE_ENCODING, file: GC_FILE, offset, count: block.length / BYTES_PER_SAMPLE, stride: GC_CHANNELS.length, channels: [...GC_CHANNELS], ...(sourceRunId ? { sourceRunId } : {}) };
      fork.gc.eventCount = block.length / (BYTES_PER_SAMPLE * GC_CHANNELS.length);
      delete fork.gc.events;
      offset += block.length;
    }
  } finally {
    await handle.close();
  }
}

export async function readSampleRef(runDir, fork) {
  const ref = fork.rawMsPerCall;
  if (Array.isArray(ref)) return Float64Array.from(ref);
  if (!isSampleRef(ref)) throw new Error(`Case ${fork.caseId ?? "unknown"} has no recorded samples`);
  return decode(await readBlock(runDir, ref));
}

/** Read one fork's memory snapshots back as `{ rss, heapUsed, external, arrayBuffers }` points. */
export async function readMemorySeries(runDir, memory) {
  const ref = memory?.series;
  if (!ref) return [];
  if (!isSampleRef(ref)) throw new Error("memory series reference is not a float64le block");
  return decodeSeries(await readBlock(runDir, ref), ref, MEMORY_CHANNELS);
}

/** Read one fork's GC events back as `{ kind, flags, durationMs, startTimeMs }` records. */
export async function readGcSeries(runDir, gc) {
  const ref = gc?.series;
  if (!ref) return [];
  if (!isSampleRef(ref)) throw new Error("gc series reference is not a float64le block");
  return decodeSeries(await readBlock(runDir, ref), ref, GC_CHANNELS);
}

function decodeSeries(block, ref, fallbackChannels) {
  const values = decode(block);
  const channels = ref.channels ?? fallbackChannels;
  const stride = ref.stride ?? channels.length;
  const records = [];
  for (let at = 0; at + stride <= values.length; at += stride) {
    const record = {};
    for (let index = 0; index < channels.length; index += 1) record[channels[index]] = values[at + index];
    records.push(record);
  }
  return records;
}
