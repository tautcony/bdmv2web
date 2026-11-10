# Design

## Context

`parseBdmv` already receives a validated table containing every file under the BDMV root. It currently loads INDX, MOBJ, MPLS, CLPI, and sound files. BDJO graph nodes record file presence only. MPLS angle records are skipped, CLPI ClipMark and ExtensionData are not read, and current stream models omit several attributes. See `proposal.md` and `specs/bdmv-disc-inspection/spec.md`.

## Goals / Non-Goals

**Goals:**

- Add source-traceable read-only structures to `ParsedDisc` and the `inspect` report.
- Keep optional format sections recoverable and bounded by existing input read limits.
- Expose field-level parse coverage while retaining `unverified` protocol evidence until independent expected values are available.

**Non-Goals:**

- Execute BD-J, load BD-J application JARs, or resolve application runtime behavior.
- Write BDMV files, modify metadata, or add menu editing.
- Decode every vendor-specific ExtensionData payload. Unknown entries remain visible by identity, version, bounds, and source.

## Decisions

### Shared source-aware records

Add typed models for BDJO, META/DL entries, extension table entries, MPLS angle/STN detail, and CLPI marks/program groups/CPI maps. Attach `SourceLocation` to each section and record. Add fields to the existing `ParsedDisc` output as additive data under the existing schema version; keep existing fields and derived CPI entries available to current consumers.

### One ExtensionData table reader

Implement the common address-table layout once and call it from MPLS and CLPI parsing. Resolve each entry against its containing file and section bounds before parsing. Dispatch known `(id1,id2,version)` payloads to format-specific readers. Return unknown entry metadata without interpreting its payload. A malformed optional entry produces a recoverable diagnostic while other valid sections remain available.

Alternatives considered: include every unknown payload in inspect JSON, or discard unknown entries. Full payload embedding can multiply report size; discarding entries hides declarations. The report keeps entry metadata and source offsets, and typed payload fields for recognized types.

### Bounded BDJO parsing

Parse the BDJO header and seven declared records using the existing `Bits` cursor, checked counts, and per-record end offsets. Resolve only BDJO files referenced by INDEX entries. Do not follow JAR names or execute application data.

### Bounded META/DL XML parsing

Read only `META/DL/bdmt_<language>.xml` files from the validated table, under the current maximum read window. Use a small local XML reader for the required element and attribute data. Reject DTD and entity declarations; decode built-in and numeric XML entities; do not fetch external resources. A malformed manifest adds a file-scoped diagnostic and does not stop structural parsing.

Alternatives considered: add an XML package or use regular-expression extraction. The package adds a runtime dependency, while regular expressions do not safely represent nested XML. A bounded local reader keeps the parser dependency-free and reports unsupported XML constructs explicitly.

### MPLS and CLPI detail preservation

Retain each MPLS alternative angle record and classify each STN stream by its declared category and category-local index. Decode video format, frame rate, aspect ratio, and available dynamic-range/color signalling. Parse CLPI ClipMark, retain ProgramInfo group counts, expose CPI map/coarse/fine records, and retain current derived PTS/SPN access points. Decode the pinned libbluray ExtensionData types listed in the specification.

### Evidence status

Keep protocol capability status `unverified` unless an independent field-level expected value is recorded with its source, version, and comparison method. Parser implementation and project-authored fixtures are implementation evidence; they do not upgrade protocol support by themselves.

## Risks / Trade-offs

- **Format layouts vary by candidate version** → Keep version, field source, and unknown extension metadata; diagnose unsupported payload versions without dropping unrelated structures.
- **Optional sections contain corrupt lengths** → Validate all counts/offsets before reading and attach recoverable diagnostics to the owning file.
- **META/DL XML uses unsupported constructs** → Reject DTD/entity declarations and report the manifest path; continue parsing the disc.
- **Reports grow with added records** → Emit parsed declarations and references rather than copying source payloads into JSON.
- **Existing consumers depend on current fields** → Add fields without changing existing field names or derived outputs; keep browser packages free of new Node APIs.

## Migration Plan

No source disc migration is required. Additive JSON fields are produced by `inspect`; existing consumers continue to read the fields they use. Update the structural support matrix and parser reference index with the new field boundary and evidence status.
