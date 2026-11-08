#!/usr/bin/env bash
# Platform-agnostic build gate for the bdmv2web workspace.
#
# Local one-command gate. It composes stage modules from scripts/ci/, ordered
# by their data dependencies; .github/workflows/ci.yml runs the same modules
# as separate job nodes (build, then parallel lint, typecheck, and
# per-package test jobs). Pipeline provider concerns - triggers, caches,
# credentials - live in the workflow, not here.
#
#
#   10-install.sh    install --frozen-lockfile
#   20-generate.sh   generate:contracts (core compiles the generated types)
#   30-build.sh      -r build (topological; produces each package's dist/)
#   40-lint.sh       |
#   40-typecheck.sh  |- parallel lanes; each only consumes dist/
#   40-test.sh       |
#
# Lint resolves workspace imports through `dist`, typecheck resolves them
# through `dist` declarations, and the test suites import workspace packages
# through `dist`, so all three lanes run after the build. They are mutually
# independent: a failing lane does not stop the others, every lane runs to
# completion, and all lane results are reported before the gate exits.
#
# Usage: bash scripts/ci.sh
#        PNPM=pnpm bash scripts/ci.sh     # only if pnpm is installed globally
set -euo pipefail

CI_DIR="$(cd "$(dirname "$0")/ci" && pwd)"
# shellcheck source=scripts/ci/lib.sh
source "$CI_DIR/lib.sh"

# Run one stage module in the foreground; its output streams live and a
# nonzero exit stops the gate at that stage.
run_stage() {
  printf '\n>>> stage: %s\n' "$(basename "$1")"
  bash "$1"
}

# Run the given lane modules in parallel. Each lane streams its output live
# with a `[lane-name]` prefix, so the interleaved lines stay attributable in
# the pipeline log and one lane can be replayed by filtering its prefix. A
# failing lane does not stop the others; the summary prints after every lane
# has finished and the gate exits with the first failed lane's status.
run_lanes() {
  local names=() starts=() pids=() script name
  for script in "$@"; do
    name="$(basename "$script" .sh)"
    names+=("$name")
    starts+=("$(date +%s)")
    printf '\n>>> lane: %s\n' "$name"
    (
      bash "$script" 2>&1 | while IFS= read -r line || [ -n "$line" ]; do
        printf '[%s] %s\n' "$name" "$line"
      done
      exit "${PIPESTATUS[0]}"
    ) &
    pids+=("$!")
  done

  local failed_status=0 failed_name="" i status elapsed
  for i in "${!names[@]}"; do
    status=0
    wait "${pids[$i]}" || status=$?
    elapsed=$(( $(date +%s) - ${starts[$i]} ))
    printf '=== lane %s: exit %d in %ss ===\n' "${names[$i]}" "$status" "$elapsed"
    if [ "$status" -ne 0 ] && [ "$failed_status" -eq 0 ]; then
      failed_status=$status
      failed_name="${names[$i]}"
    fi
  done

  if [ "$failed_status" -ne 0 ]; then
    printf '\nGate failed in a parallel lane: %s (exit %d)\n' "$failed_name" "$failed_status" >&2
    exit "$failed_status"
  fi
}

run_stage "$CI_DIR/10-install.sh"
run_stage "$CI_DIR/20-generate.sh"
run_stage "$CI_DIR/30-build.sh"
run_lanes "$CI_DIR/40-lint.sh" "$CI_DIR/40-typecheck.sh" "$CI_DIR/40-test.sh"

printf '\nGate passed.\n'
