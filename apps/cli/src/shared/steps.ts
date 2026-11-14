/**
 * Progress step vocabulary shared by `export` and `render`.
 *
 * Both commands run the same pipelines and print the same step names, so
 * `export --render` and `render` report the same progress line by line.
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
