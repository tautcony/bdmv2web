# Asset CLI

## Requirements

### Requirement: Inspect and list command output formats
The CLI SHALL print a readable table by default for `inspect` and `list-assets`. Both commands SHALL support `--format table|json` for stdout and `--out FILE` for a complete JSON report. File output SHALL remain JSON regardless of the stdout format.

#### Scenario: Inspect to terminal and file
- **WHEN** the user runs `inspect` with `--out FILE`
- **THEN** stdout contains a structural summary table and FILE contains the complete ParsedDisc JSON

#### Scenario: List asset details
- **WHEN** the user runs `list-assets`
- **THEN** the report includes IGS image element counts and object attributes, SUP track counts by M2TS clip, and per-asset metadata

### Requirement: List IGS and SUP resources
The CLI SHALL list IGS MNU streams, IGS image element attributes and reachable PGS subtitle tracks for a BDMV input. It SHALL support selecting all resources, IGS only, or SUP only, with optional M2TS clip and PID filters. The list command SHALL report the same source identifiers accepted by `export-assets`.

#### Scenario: Select resource types
- **WHEN** the user selects `all`, `igs`, or `sup`
- **THEN** the report contains matching clip/PID resources, IGS image attributes and SUP track counts by M2TS clip

### Requirement: Extract protocol analysis data by type
The CLI SHALL require `extract` to select one of `hdmv`, `igs`, or `sup`, or select `--all`. It SHALL write protocol analysis data and source mappings into type-specific directories. IGS scene extraction SHALL remain independent of PNG rendering. Extract SHALL NOT write PNG or SUP media files.

#### Scenario: Extract one protocol type
- **WHEN** the user runs `extract --type igs`
- **THEN** the output contains IGS scene data, source maps, diagnostics, and a manifest without rendered PNG files

#### Scenario: Extract all protocol types
- **WHEN** the user runs `extract --all`
- **THEN** the output contains HDMV command/structure data, IGS scene data, SUP track analysis metadata, and a manifest with the selected types and generated files

### Requirement: Export ready-to-use IGS and SUP assets
The CLI SHALL provide `export-assets` to write IGS MNU files framed as `IG` + PTS + DTS + segment records, and reachable, validated PGS SUP tracks to a caller-selected output directory. MNU files SHALL be accepted by igstools. The command SHALL support selecting all assets, IGS only, or SUP only, and filtering by M2TS clip and PID. With `--decode png`, it SHALL also write PNGs for IGS image elements and SUP display sets. The manifest SHALL contain resource type, format, generated relative path, byte length, and subtitle language when applicable.

#### Scenario: Export both asset types
- **WHEN** the user runs `export-assets` with type `all` and a valid output directory
- **THEN** selected IGS MNU streams and SUP tracks are committed with their manifest; PNG files are included when `--decode png` is set

#### Scenario: Export one asset type
- **WHEN** the user selects `igs` or `sup`
- **THEN** the output contains only the selected asset type
