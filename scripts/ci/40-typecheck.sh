#!/usr/bin/env bash
# Lane 40b: per-package `tsc --noEmit` over all sources including tests.
# Workspace imports resolve through each package's `dist` declarations, so
# this needs the build stage.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "typecheck" "${CI_PNPM[@]}" -r typecheck
