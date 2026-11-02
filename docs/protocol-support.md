# Protocol support register

No Blu-ray field, opcode, or file-format behavior is marked supported by the M0 contract fixtures. Add a row only after recording the fixed specification/reference location, fixture, expected result, license, and independent verification. “Unverified” is not supported.

| Format/version or opcode | Field/semantics | Normative source and exact section | Reference repository/revision and path | Fixture ID | Expected result source | License | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DiscIR contract 1.0 (project schema, not Blu-ray protocol) | HDMV/BDJ tagged navigation and schema checks | `packages/core/schema/disc-ir.schema.json` | Project source | `core-contracts-minimal-hdmv`, `core-contracts-mixed-bdj` | Hand-authored fixture JSON checked by the project schema; no parser-generated golden | Project-authored | unverified for Blu-ray semantics |
