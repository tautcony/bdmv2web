import { open, readFile } from "node:fs/promises";
import { join } from "node:path";

export const SAMPLE_FILE = "samples.f64";
export const SAMPLE_ENCODING = "float64le";
export const BYTES_PER_SAMPLE = 8;

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
 */
export async function writeSampleStore(runDir, rows, { sources = new Map() } = {}) {
  const forks = rows.flatMap((row) => row.forks ?? []);
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

export async function readSampleRef(runDir, fork) {
  const ref = fork.rawMsPerCall;
  if (Array.isArray(ref)) return Float64Array.from(ref);
  if (!isSampleRef(ref)) throw new Error(`Case ${fork.caseId ?? "unknown"} has no recorded samples`);
  return decode(await readBlock(runDir, ref));
}
