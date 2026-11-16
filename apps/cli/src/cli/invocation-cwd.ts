import { statSync } from "node:fs";

/**
 * A package manager runs a script in the package root, so `pnpm run cli:dev
 * export Hyouka_01/clip.rsks` would otherwise resolve `Hyouka_01` against the
 * repository instead of the directory the command was typed in. npm and pnpm
 * export that directory as `INIT_CWD`; switching to it makes every relative
 * argument — input, `--out`, `--player-profile` — mean what the caller typed.
 *
 * Only the process entry calls this. Command bodies and tests keep the working
 * directory they were given, and a missing, foreign or deleted `INIT_CWD`
 * leaves the inherited directory untouched instead of failing the run.
 */
export function applyInvocationCwd(): void {
  const invocation = process.env.INIT_CWD;
  if (!invocation || invocation === process.cwd()) return;
  try {
    if (!statSync(invocation).isDirectory()) return;
    process.chdir(invocation);
  } catch {
    // An unusable `INIT_CWD` is not a reason to abort; keep the inherited directory.
  }
}
