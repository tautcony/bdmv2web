#!/usr/bin/env bash
# Stage 30: build every package. `pnpm -r` orders the builds by their
# workspace dependencies and runs independent packages concurrently. The
# check lanes after this stage consume each package's `dist/` output.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "build" "${CI_PNPM[@]}" -r build
