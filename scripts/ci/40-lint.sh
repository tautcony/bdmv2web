#!/usr/bin/env bash
# Lane 40a: lint. Linting is type-aware and resolves workspace imports
# through each package's `dist` declarations, so it needs the build stage.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "lint" "${CI_PNPM[@]}" lint
