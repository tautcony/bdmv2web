#!/usr/bin/env bash
# Shared helpers for the scripts/ci/ stage modules. Sourced by scripts/ci.sh
# and by every stage module; not runnable directly.

set -euo pipefail

# Stage modules address every path from the workspace root, so the gate works
# from any working directory.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# `package.json` pins `packageManager: pnpm@11.25.0`, so `corepack pnpm`
# selects exactly that version. Corepack ships with Node, which means the gate
# does not depend on a globally installed pnpm - and the nested `pnpm` calls
# that `pnpm -r ...` makes inside package scripts resolve through the same
# shim. `PNPM` stays overridable for images that install pnpm themselves.
read -r -a CI_PNPM <<< "${PNPM:-corepack pnpm}"

# Run one labeled command and time it. A nonzero exit leaves the stage module
# with that status; the orchestrator reports it.
ci_run() {
  local label="$1"
  shift
  printf '\n=== %s ===\n$ %s\n' "$label" "$*"
  local started_at ended_at status
  started_at="$(date +%s)"
  set +e
  "$@"
  status=$?
  set -e
  ended_at="$(date +%s)"
  printf '=== %s: exit %d in %ss ===\n' "$label" "$status" "$((ended_at - started_at))"
  if [ "$status" -ne 0 ]; then
    printf 'Stage failed: %s\n' "$*" >&2
    exit "$status"
  fi
}
