#!/usr/bin/env bash
# Stage 20: generate the disc-IR contract types in @bdmv2web/core from the
# JSON schema. Every package that imports @bdmv2web/core compiles the
# generated file, so this runs before the build.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "generate:contracts" "${CI_PNPM[@]}" generate:contracts
