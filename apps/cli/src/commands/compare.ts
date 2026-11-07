import { optionValue, strictDefault } from "../cli/context.js";

export async function compareReference(): Promise<void> {
  const strict = strictDefault(); const format = optionValue("--format");
  const detail = { code: "E_NOT_IMPLEMENTED", command: "compare", strict, message: "The 'compare' command is not implemented yet." };
  process.stderr.write(format === "json" ? `${JSON.stringify(detail)}\n` : `${detail.code}: ${detail.message}\n`);
  process.exitCode = 1;
}
