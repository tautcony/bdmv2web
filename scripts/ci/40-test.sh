#!/usr/bin/env bash
# Lane 40c: run every package's vitest suite. Suites import workspace
# packages through `dist` and the cli integration tests spawn the built
# executable, so this needs the build stage. `test:all` is `--no-bail`: a
# failing package does not stop the remaining suites.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ci_run "test:all" "${CI_PNPM[@]}" test:all
