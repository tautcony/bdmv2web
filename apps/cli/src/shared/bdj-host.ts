import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

/** Compile the workspace Java host, or use the host embedded in the published CLI. */
export async function buildBdjHostApiJar(): Promise<Uint8Array> {
  const builder = fileURLToPath(new URL("../../../../scripts/build-bdj-host.mjs", import.meta.url));
  try {
    await access(builder);
    const temporary = await mkdtemp(join(tmpdir(), "bdmv2web-bdj-host-"));
    const jarPath = join(temporary, "bdj-host-api.jar");
    try {
      await execFileAsync(process.execPath, [builder, jarPath], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      return await readFile(jarPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not build the BD-J Java host: ${detail}`, { cause: error });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) throw error;
    const bundledJar = new URL("runtime/bdj-host-api.jar", import.meta.url);
    try { return await readFile(bundledJar); }
    catch (bundleError) {
      const detail = bundleError instanceof Error ? bundleError.message : String(bundleError);
      throw new Error(`The BD-J Java host is unavailable: ${detail}`, { cause: bundleError });
    }
  }
}
