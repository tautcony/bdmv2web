import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const modeFile = "bench-build-mode.json";

export const BUILD_MODES = ["normal", "profile"];

export async function writeBuildMode(outputDirectory, profileBuildMode) {
  await mkdir(outputDirectory, { recursive: true });
  const record = { schemaVersion: 1, profileBuildMode: Boolean(profileBuildMode), buildMode: profileBuildMode ? "profile" : "normal" };
  await writeFile(join(outputDirectory, modeFile), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function readBuildMode(root, declaredMode) {
  if (declaredMode === "normal" || declaredMode === "profile") return { profileBuildMode: declaredMode === "profile", buildMode: declaredMode, buildModeSource: "cli-declaration" };
  const directories = [join(resolve(root), "apps/cli/dist"), join(resolve(root), "packages/runtime-web/dist")];
  const records = [];
  for (const directory of directories) {
    try {
      const record = JSON.parse(await readFile(join(directory, modeFile), "utf8"));
      if (record?.schemaVersion === 1 && typeof record.profileBuildMode === "boolean") records.push(record.profileBuildMode);
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  if (!records.length) return { profileBuildMode: null, buildMode: "unknown", buildModeSource: "unrecorded-build" };
  if (records.some((value) => value !== records[0])) return { profileBuildMode: null, buildMode: "mixed", buildModeSource: "build-metadata" };
  const profileBuildMode = records[0];
  return { profileBuildMode, buildMode: profileBuildMode ? "profile" : "normal", buildModeSource: "build-metadata" };
}
