#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

failures=()
check() {
  local label=$1
  shift
  if "$@"; then
    echo "PASS: $label"
  else
    failures+=("$label")
    echo "FAIL: $label" >&2
  fi
}

frontend() {
  check 'shipping caller gate' npm run caller:check
  check 'TypeScript' npm run typecheck
  check 'UI acceptance' npm run test:overhaul --workspace @worktracker/studio
  check 'frontend tests' npm run test --workspace @worktracker/studio
  check 'frontend build' npm run build
}

rust() {
  check 'portable Rust tests' cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
    --workspace --exclude ticketry --exclude ticketry-desktop --no-fail-fast
}

graphql() {
  check 'GraphQL drift' npm run graphql:drift --workspace @worktracker/studio
}

e2e() {
  # Playwright starts the existing Rust adapter with a unique temporary SQLite
  # directory and tmux socket. It must not reuse a manually started server.
  check 'browser E2E' env BROWSER=none npm run test:e2e --workspace @worktracker/studio -- "$@"
}

mode=${1:-frontend}
if [[ $# -gt 0 ]]; then shift; fi
if [[ $mode != e2e && $# -gt 0 ]]; then
  echo 'Only the e2e mode accepts additional arguments.' >&2
  exit 2
fi
case "$mode" in
  frontend) frontend ;;
  rust) rust ;;
  graphql) graphql ;;
  e2e) e2e "$@" ;;
  all) frontend; rust; graphql; e2e ;;
  *) echo 'Usage: bash scripts/codex-cloud/check.sh [frontend|rust|graphql|e2e|all]' >&2; exit 2 ;;
esac

if [[ ${#failures[@]} -gt 0 ]]; then
  printf 'Failed check: %s\n' "${failures[@]}" >&2
  exit 1
fi
