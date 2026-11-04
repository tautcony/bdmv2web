#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

function usage() {
  console.error("Usage: node scripts/extract-m2ts-pid-packets.mjs --source FILE --output FILE --source-label RELATIVE_PATH --pids PID[,PID...]");
  console.error("Retains complete 192-byte M2TS packets. Writes FILE.offset-runs.json beside the packet output.");
  process.exit(2);
}

const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || !value || options.has(key)) usage();
  options.set(key, value);
}
const sourceArg = options.get("--source");
const outputArg = options.get("--output");
const sourceLabel = options.get("--source-label");
const pidArg = options.get("--pids");
if (!sourceArg || !outputArg || !sourceLabel || !pidArg || isAbsolute(sourceLabel) || /^[A-Za-z]:[\\/]/.test(sourceLabel) || sourceLabel.split(/[\\/]/).includes("..")) usage();

const pids = [...new Set(pidArg.split(",").map((value) => {
  const pid = Number(value.trim());
  if (!Number.isInteger(pid) || pid < 0 || pid > 0x1fff) usage();
  return pid;
}))].sort((a, b) => a - b);
if (!pids.length) usage();

const source = await readFile(resolve(sourceArg));
const packetSize = 192;
if (source.length % packetSize !== 0) throw new Error(`Source length ${source.length} is not aligned to ${packetSize}-byte M2TS packets`);
const kept = [];
const runs = [];
const wanted = new Set(pids);
for (let sourcePacket = 0; sourcePacket < source.length / packetSize; sourcePacket++) {
  const packet = source.subarray(sourcePacket * packetSize, (sourcePacket + 1) * packetSize);
  const ts = packet[4];
  if (ts !== 0x47) throw new Error(`Invalid TS sync byte at source packet ${sourcePacket}`);
  const pid = ((packet[5] & 0x1f) << 8) | packet[6];
  if (!wanted.has(pid)) continue;
  const fixturePacket = kept.length;
  kept.push(packet);
  const last = runs.at(-1);
  if (last && last.fixturePacketStart + last.packetCount === fixturePacket && last.sourcePacketStart + last.packetCount === sourcePacket) last.packetCount++;
  else runs.push({ fixturePacketStart: fixturePacket, sourcePacketStart: sourcePacket, packetCount: 1 });
}

const output = resolve(outputArg);
const sidecar = {
  sourceM2ts: sourceLabel,
  packetSize,
  pids,
  runs,
};
await writeFile(output, Buffer.concat(kept));
await writeFile(`${output}.offset-runs.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
console.log(`${kept.length} packets, ${kept.length * packetSize} bytes, ${runs.length} offset runs`);
