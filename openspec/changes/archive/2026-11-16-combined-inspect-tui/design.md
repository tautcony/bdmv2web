# Design

## Collection

The inspect handler resolves its input and options, then calls `parseBdmvWithInputTable` once. It passes that ParsedDisc and input table to `extractIgsScenes` once with `renderAssets: false` and `measurePayloadBytes: true`. Collection also records source file sizes, reachable SUP declarations, and browser indexes before the UI starts. The TUI consumes an immutable in-memory model and performs no source file IO.

Structure and graphics retain independent stage status and diagnostics. Structural fatality follows current inspect semantics. A failed or empty graphics extraction remains distinguishable from a successful extraction containing no scenes. Existing recoverable navigation data remains browsable.

## Command and serialization

`inspect` is canonical; `list` dispatches to the same handler and output. TTY defaults to the TUI. `--format table` renders the combined deterministic text report, `--format json` writes a combined object with `schemaVersion`, `disc`, `graphics`, and stage statuses, and `--out` writes the same JSON object. When stdout is not a TTY and no format is specified, output is text. Existing list selection flags filter the graphics view. JSON conversion represents payload Maps as objects keyed by clip ID and decimal PID. JSON is constructed only for JSON stdout or an explicit output file.

## TUI

Ink and React provide terminal input, rendering, and text layout; `@inkjs/ui` supplies established selectable and help components where suitable. The screen contains a source path, stage indicators, section navigation (Navigation, MPLS, M2TS, Metadata, Diagnostics), a main selection pane, and a structured details pane. `inspect-details.ts` projects the selected domain record into labeled sections and fields: entry targets, playlist duration and marks, PlayItem stream declarations, decoded commands and static outgoing references, media scan state, measured payload, and asset metadata. The view wraps and pages these fields using `wrap-ansi`. Layout places details beside the list on wide terminals and below it on narrow terminals.

Navigation targets are indexed once by object, command, playlist, and clip ID. Edges retain target IDs; Enter resolves one target from memory. Conditional merges and loops share indexed records. Navigation is derived only from the parsed navigation analysis and existing static references. MPLS records use filename order; PlayItems use declared index order. A resolved clip reference can navigate to its M2TS entry. Unresolved targets remain explicitly unresolved. M2TS details show associated CLPI, extracted IGS scenes and image elements, reachable SUP declarations, measured payload sizes, and reverse references with source locations.

Up/down selects rows, Enter enters a row, Escape returns and restores selection/scroll state, `d` toggles details, `?` opens help, and `q` exits. Loading UI reports real stage and elapsed time. TTY collection runs in a Node worker thread, which transfers collected buffers back to the parent. The source development entry uses the TSX ESM API to load its worker with the development tsconfig; emitted and bundled entries load the JavaScript worker included in the CLI distribution. The parent owns Ink and its elapsed timer.

## Compatibility

Keep Node 22 compatibility verified for the chosen Ink release and avoid TSX compilation changes by using React.createElement in TypeScript. Put UI dependencies only in `apps/cli`. Keep command handlers dynamically loaded. Text and JSON modes do not initialize Ink.
