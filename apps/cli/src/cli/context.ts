export type ParsedOptions = Record<string, unknown>;

/**
 * The options of the command currently running. Commander owns parsing,
 * help and dispatch; this module-level snapshot is what the command bodies
 * read, and each handler keeps a flat `options.x` shape.
 */
let activeInput: string | undefined;
let activeOptions: ParsedOptions = {};

/** `--player-profile` is stored by Commander as `options.playerProfile`. */
export function optionKey(name: string): string {
  return name.replace(/^--/, "").replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
export function optionValue(name: string): string | undefined {
  const value = activeOptions[optionKey(name)];
  return typeof value === "string" ? value : undefined;
}
export function optionNumber(name: string): number | undefined {
  const value = activeOptions[optionKey(name)];
  return typeof value === "number" ? value : undefined;
}
export function flagEnabled(name: string): boolean {
  return activeOptions[optionKey(name)] === true;
}
/** Tri-state flag: `undefined` when the caller did not pass the option at all. */
export function optionState(name: string): boolean | undefined {
  const value = activeOptions[optionKey(name)];
  return typeof value === "boolean" ? value : undefined;
}

export function inputPath(): string | undefined {
  return activeInput;
}

export function setActiveCommand(input: string | undefined, options: ParsedOptions): void {
  activeInput = input;
  activeOptions = options;
}
