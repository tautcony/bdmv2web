/** Compatibility identity for run records. One field list drives comparison and trends. */

export const ENVIRONMENT_FIELDS = ["node", "v8", "platform", "release", "architecture", "cpuModel", "cpuCount", "execArgv", "nodeOptions", "profileBuildMode", "buildMode"];
export const CONFIGURATION_FIELDS = ["engine", "engineVersion", "warmupMs", "timeMs", "minSamples"];

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function pick(source, fields) {
  return Object.fromEntries(fields.map((key) => [key, source?.[key]]));
}

export function environmentIdentity(environment) {
  return stable(pick(environment, ENVIRONMENT_FIELDS));
}

export function configurationIdentity(configuration) {
  return stable(pick(configuration, CONFIGURATION_FIELDS));
}

export function runIdentity(run) {
  return stable({ environment: environmentIdentity(run?.environment), configuration: configurationIdentity(run?.configuration) });
}

export function mismatchedFields(baseline, candidate, fields) {
  return fields.filter((key) => stable(baseline?.[key]) !== stable(candidate?.[key]));
}
