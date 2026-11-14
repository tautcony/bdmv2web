/**
 * Progress step vocabulary shared by `export` and `render`.
 *
 * Both commands run the same pipelines, so they must print the same step names:
 * a user comparing `export --render` with `render` sees identical progress.
 */
export const BDMV_STEPS = {
  structure: "Parse BDMV structure",
  igs: "Extract IGS scenes",
  sup: "Extract SUP tracks",
  decode: "Decode display sets",
  commit: "Write manifest and commit",
} as const;

export const STREAM_STEPS = {
  probe: "Probe stream tables",
  extract: "Extract graphics streams",
  decode: "Decode display sets",
  commit: "Write manifest and commit",
} as const;

export const FILE_STEPS = {
  read: "Read graphics assets",
  decode: "Decode display sets",
  commit: "Write manifest and commit",
} as const;
