import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const env = { ...process.env, BDMV2WEB_PROFILE_BUILD: "1" };
const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
for (const args of [["pnpm", "build"], ["pnpm", "bundle:cli"]]) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
