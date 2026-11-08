#!/usr/bin/env bash
# Stage 10: install workspace dependencies with the frozen lockfile.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "install" "${CI_PNPM[@]}" install --frozen-lockfile
