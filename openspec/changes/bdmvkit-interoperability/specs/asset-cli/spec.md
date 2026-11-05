# Asset CLI

## Requirements

### Requirement: List IGS and PGS resources
The CLI SHALL provide a command that lists decoded IGS image assets and reachable PGS subtitle stream declarations for a BDMV input. The command SHALL support selecting all resources, IGS only, or PGS only. Listing PGS declarations SHALL not require media extraction. Results SHALL omit source paths and source provenance.

#### Scenario: List resources from a generated disc
- **WHEN** the user runs `list-assets` on a valid BDMV directory
- **THEN** the CLI returns resource type, generated export path and size for each image, plus the language and stream number for each reachable subtitle

### Requirement: Export IGS and PGS resources
The CLI SHALL provide a command that exports selected IGS images and reachable PGS SUP tracks to a caller-selected output directory. It SHALL validate extracted PGS display sets before committing output and write an asset manifest containing resource type, generated relative export path, byte length, and subtitle language when applicable. It SHALL omit source paths and source provenance from output records and exported paths.

#### Scenario: Export both resource types
- **WHEN** the user runs `export-assets` with type `all` and a valid output directory
- **THEN** PNG assets and parsed SUP tracks are committed together with their manifest

#### Scenario: Export one resource type
- **WHEN** the user selects `igs` or `pgs`
- **THEN** the output contains only the selected resource type
