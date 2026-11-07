#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

function usage() {
  console.error("Usage: node package-igs-fixture-materials.mjs --root SOURCE_ROOT --output ARCHIVE --plan PLAN.json");
  process.exit(2);
}

const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (!key?.startsWith("--") || !value || options.has(key)) usage();
  options.set(key, value);
}
const rootArg = options.get("--root");
const outputArg = options.get("--output");
const planArg = options.get("--plan");
if (!rootArg || !outputArg || !planArg || options.size !== 3) usage();

const sourceRoot = resolve(rootArg);
const archive = resolve(outputArg);
const plan = JSON.parse(await readFile(resolve(planArg), "utf8"));
if (!Array.isArray(plan) || plan.length === 0) usage();
const caseIds = new Set();
for (const item of plan) {
  if (!item || !/^[a-z0-9][a-z0-9_-]*$/i.test(item.id) || caseIds.has(item.id) || !item.bdmv || isAbsolute(item.bdmv) || item.bdmv.split(/[\\/]/).includes("..") || !Array.isArray(item.clips) || item.clips.length === 0) usage();
  caseIds.add(item.id);
  const clipIds = new Set();
  for (const clip of item.clips) {
    if (!clip || !/^\d{5}$/.test(clip.id) || clipIds.has(clip.id)) usage();
    clipIds.add(clip.id);
  }
}

const staging = await mkdtemp(join(tmpdir(), "igs-fixture-materials-"));
try {
  const packageCases = [];
  for (const item of plan) {
    const bdmvRoot = resolve(sourceRoot, item.bdmv);
    const rootRelative = relative(sourceRoot, bdmvRoot);
    if (rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) throw new Error(`Case ${item.id} escapes SOURCE_ROOT`);
    const fixtureBdmv = join(staging, item.id, "BDMV");
    for (const clip of item.clips) {
      const clpiRelative = `CLIPINF/${clip.id}.clpi`;
      const clpiSource = join(bdmvRoot, clpiRelative);
      const clpiInfo = await lstat(clpiSource);
      if (!clpiInfo.isFile() || clpiInfo.isSymbolicLink()) throw new Error(`Expected regular file: ${item.id}/${clpiRelative}`);
      const sourceRelative = `STREAM/${clip.id}.m2ts`;
      const m2tsSource = join(bdmvRoot, sourceRelative);
      const m2tsInfo = await lstat(m2tsSource);
      if (!m2tsInfo.isFile() || m2tsInfo.isSymbolicLink()) throw new Error(`Expected regular file: ${item.id}/${sourceRelative}`);
      const m2tsBytes = await readFile(m2tsSource);
      const packetSize = 192;
      if (m2tsBytes.length % packetSize !== 0) throw new Error(`M2TS packet alignment failure: ${item.id}/${sourceRelative}`);
      const packets = [];
      const runs = [];
      const keptPids = new Set([0x0000, 0x0100, 0x1400]);
      for (let sourcePacket = 0; sourcePacket < m2tsBytes.length / packetSize; sourcePacket++) {
        const packet = m2tsBytes.subarray(sourcePacket * packetSize, (sourcePacket + 1) * packetSize);
        if (packet[4] !== 0x47) throw new Error(`TS sync byte failure in ${item.id}/${sourceRelative} packet ${sourcePacket}`);
        const pid = ((packet[5] & 0x1f) << 8) | packet[6];
        if (!keptPids.has(pid)) continue;
        const fixturePacket = packets.length;
        packets.push(packet);
        const previous = runs.at(-1);
        if (previous && previous.fixturePacketStart + previous.packetCount === fixturePacket && previous.sourcePacketStart + previous.packetCount === sourcePacket) previous.packetCount++;
        else runs.push({ fixturePacketStart: fixturePacket, sourcePacketStart: sourcePacket, packetCount: 1 });
      }
      if (!packets.some((packet) => (((packet[5] & 0x1f) << 8) | packet[6]) === 0x1400)) throw new Error(`No PID 0x1400 packets in ${item.id}/${sourceRelative}`);
      const streamRelative = `STREAM/${clip.id}.m2ts_ig-packets.bin`;
      const streamDestination = join(fixtureBdmv, streamRelative);
      await mkdir(dirname(streamDestination), { recursive: true });
      const packetBytes = Buffer.concat(packets);
      await writeFile(streamDestination, packetBytes);
      const sidecar = {
        sourceM2ts: `BDMV/${sourceRelative}`,
        packetSize,
        pids: [...keptPids],
        runs,
      };
      await writeFile(`${streamDestination}.offset-runs.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
      console.log(`${item.id}/${clip.id}: ${packets.length} packets for PIDs 0x0000/0x0100/0x1400 (${packetBytes.length} bytes) from ${m2tsInfo.size}-byte source; source M2TS excluded`);
    }
    packageCases.push(item.id);
  }
  const packageManifest = { kind: "IGS packet fixtures", pids: ["0x0000", "0x0100", "0x1400"], packetSize: 192, sourceM2tsIncluded: false, cases: packageCases };
  await writeFile(join(staging, "PACKAGE-MANIFEST.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
  await mkdir(dirname(archive), { recursive: true });
  const result = spawnSync("tar", ["-czf", archive, "PACKAGE-MANIFEST.json", ...packageCases], { cwd: staging, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with status ${result.status}`);
  console.log(`archive: ${archive} (${(await stat(archive)).size} bytes)`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
