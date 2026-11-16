# Interactive Disc Inspection Specification

## Purpose

Provide one inspection session that combines existing structural and graphics extraction data while preserving non-interactive CLI use.

## ADDED Requirements

### Requirement: Single combined collection
The CLI SHALL parse the BDMV structure once and extract IGS scenes once per inspection invocation, reusing the parsed input table. The extraction SHALL follow the current list scope, measure payload sizes for the combined report, and SHALL NOT render PNG assets. The TUI SHALL browse only collected data and SHALL NOT read source files.

#### Scenario: TTY inspection
- **WHEN** inspect runs on a TTY
- **THEN** one structure parse and one graphics extraction complete before browsing, and all browsing uses the collected model

#### Scenario: JSON or text inspection
- **WHEN** inspect runs in JSON or text mode
- **THEN** it uses the same combined collection and emits the selected non-interactive format without initializing the TUI

### Requirement: Command alias and formats
`list` SHALL be an alias for unified `inspect`. TTY defaults to the TUI; explicit table format and piped default output SHALL be deterministic text. JSON and `--out` SHALL serialize the combined inspection model. Existing list asset filters SHALL select the graphics subset without changing structural results.

#### Scenario: Alias parity
- **WHEN** a user runs `list` or `inspect` with the same input and options
- **THEN** both commands expose the same report and interface

#### Scenario: Combined JSON
- **WHEN** `inspect --format json` or `list --format json` runs
- **THEN** stdout is parseable JSON with schema version, disc data, graphics data, and separate structure and graphics stage statuses

### Requirement: Layered source-linked browsing
The TUI SHALL expose Navigation, MPLS, M2TS, Metadata, and Diagnostics sections with selection and details. MPLS files SHALL be ordered by filename and PlayItems by declared index. Navigation destinations and M2TS associations SHALL use parsed or explicitly declared references only; unknown associations SHALL remain unknown. Every displayed source-backed record SHALL preserve its available source location.

#### Scenario: MPLS and PlayItem navigation
- **WHEN** a user enters an MPLS row and selects a PlayItem
- **THEN** PlayItems appear in declaration index order and a known clip reference can open its M2TS entry

#### Scenario: Unknown reference
- **WHEN** a navigation or media association is unresolved
- **THEN** the TUI shows the unresolved state and does not infer a destination

#### Scenario: Graphics details
- **WHEN** an M2TS entry has extracted graphics data
- **THEN** details show associated CLPI, IGS scenes and image elements, reachable SUP declarations, measured payload, reverse references, and source locations when available

### Requirement: Stage and interaction state
The TUI SHALL distinguish scan failure, successful empty data, and unavailable/unknown data. Structure and graphics SHALL retain independent status and diagnostics. Recoverable structural data SHALL remain browsable after a non-fatal extraction issue. The UI SHALL support up/down selection, Enter to enter, Escape to return with prior selection and scroll restored, `d` detail toggle, `?` help, and `q` exit. Progress SHALL report actual phase and elapsed time without fabricated percentages.

#### Scenario: Empty successful extraction
- **WHEN** graphics extraction succeeds and returns no assets
- **THEN** the interface reports an empty result and a successful graphics stage

#### Scenario: Extraction failure with structure available
- **WHEN** graphics extraction fails after structural parsing succeeds
- **THEN** structural navigation remains available and graphics status and diagnostics identify the failure

### Requirement: Structured domain details
The detail pane SHALL organize the selected object's information into labeled domain sections and fields. Navigation entries SHALL show identity, target, available command count, direct static MPLS references, and provenance. Media details SHALL distinguish file availability, scan state, declarations, measurements, and references. Commands SHALL show decoded instructions, raw bytes, and static outgoing references.

#### Scenario: Selected navigation title
- **WHEN** a user selects a title entry
- **THEN** the pane shows the declared target, available related program information, and a dedicated source section

#### Scenario: Missing media with declared streams
- **WHEN** a referenced M2TS is missing while CLPI and SUP declarations are available
- **THEN** the pane shows missing file/scan state and unavailable measurements alongside the available declarations

#### Scenario: Long-running collection
- **WHEN** graphics collection takes multiple seconds
- **THEN** the Ink animation and elapsed time continue updating while the worker performs the same single collection

#### Scenario: Conditional navigation graph
- **WHEN** static navigation contains many branches, merges, or loops
- **THEN** the browsing model indexes each command and target once and follows links when selected

#### Scenario: Structural clip with IGS on a SubPath
- **WHEN** a present M2TS has collected structural declarations and its IGS reference points to a separately scanned SubPath clip
- **THEN** the M2TS row shows `structure-only`, details explain unavailable payload measurements, and an indexed link opens the related IGS clip
