#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

function usage() {
  console.error("Usage: node package-hdmv-metadata-fixtures.mjs --root SOURCE_ROOT --output ARCHIVE case_id=relative/BDMV/path [...]");
  process.exit(2);
}

const args = process.argv.slice(2);
let rootArg;
let outputArg;
const cases = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--root") rootArg = args[++i];
  else if (arg === "--output") outputArg = args[++i];
  else if (arg?.startsWith("--") || !arg?.includes("=")) usage();
  else {
    const equals = arg.indexOf("=");
    cases.push([arg.slice(0, equals), arg.slice(equals + 1)]);
  }
}
if (!rootArg || !outputArg || cases.length === 0 || new Set(cases.map(([id]) => id)).size !== cases.length) usage();
for (const [id, sourcePath] of cases) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || !sourcePath || isAbsolute(sourcePath) || sourcePath.split(/[\\/]/).includes("..")) usage();
}

const sourceRoot = resolve(rootArg);
const archive = resolve(outputArg);
const staging = await mkdtemp(join(tmpdir(), "hdmv-metadata-fixtures-"));
try {
  for (const [id, sourceRelative] of cases) {
    const bdmvRoot = resolve(sourceRoot, sourceRelative);
    const rootRelative = relative(sourceRoot, bdmvRoot);
    if (rootRelative.startsWith(`..${sep}`) || rootRelative === "..") throw new Error(`Case ${id} escapes the source root`);
    const fixtureBdmv = join(staging, id, "BDMV");
    await mkdir(fixtureBdmv, { recursive: true });
    const paths = ["index.bdmv", "MovieObject.bdmv"];
    for (const [directory, extension] of [["PLAYLIST", ".mpls"], ["CLIPINF", ".clpi"]]) {
      const sourceDir = join(bdmvRoot, directory);
      const names = (await readdir(sourceDir)).filter((name) => /^\d{5}\.(mpls|clpi)$/.test(name) && name.endsWith(extension)).sort();
      for (const name of names) paths.push(`${directory}/${name}`);
    }
    const files = [];
    let totalBytes = 0;
    for (const path of paths) {
      const src = join(bdmvRoot, path);
      const info = await lstat(src);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected primary metadata file: ${path}`);
      const dst = join(fixtureBdmv, path);
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      const bytes = (await stat(dst)).size;
      files.push({ path: path.replaceAll("\\", "/"), bytes });
      totalBytes += bytes;
    }
    const manifest = { case: id, files, totals: { files: files.length, bytes: totalBytes } };
    await writeFile(join(fixtureBdmv, "FIXTURE-SOURCE.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${id}: ${files.length} files, ${totalBytes} bytes`);
  }
  await mkdir(dirname(archive), { recursive: true });
  const ids = cases.map(([id]) => id);
  const result = spawnSync("tar", ["-czf", archive, ...ids], { cwd: staging, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with status ${result.status}`);
  console.log(`archive: ${basename(archive)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
