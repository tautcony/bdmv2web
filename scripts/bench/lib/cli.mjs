import { Command, InvalidArgumentError } from "commander";

/** Commander program that throws instead of ending the process, so callers own exit codes. */
export function createProgram(name, description) {
  return new Command(name)
    .description(description)
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
}

export function parseOptions(command, argv) {
  command.parse(argv, { from: "user" });
  return command.opts();
}

export function appendArgument(value, previous) {
  return [...(previous ?? []), value];
}

export function appendList(value, previous) {
  return [...(previous ?? []), ...splitList(value)];
}

export function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function numberArgument(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError("expected a number");
  return parsed;
}

export function integerArgument(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new InvalidArgumentError("expected an integer");
  return parsed;
}

export function exitWithError(error, exitCode, { stack = false } = {}) {
  if (error?.code === "commander.helpDisplayed") return;
  const message = error instanceof Error ? error.message : String(error);
  const output = stack && error instanceof Error && error.name !== "CommanderError" ? error.stack ?? message : message;
  process.stderr.write(`${output}\n`);
  process.exitCode = exitCode;
}
