#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
source scripts/codex-cloud/edition.sh

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
  check 'shipping caller gate' bun run caller:check
  check 'TypeScript' bun run typecheck
  check 'UI acceptance' bun run --cwd studio test:overhaul
  check 'frontend tests' bun run --cwd studio test
  check 'frontend build' bun run build
}

rust() {
  check 'portable Rust tests' cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
    --workspace --exclude ticketry --exclude ticketry-desktop --no-fail-fast \
    ${edition_cargo_features[@]+"${edition_cargo_features[@]}"}
}

graphql() {
  check 'GraphQL drift' bun run --cwd studio graphql:drift
}

e2e() {
  # Playwright starts the existing Rust adapter with a unique temporary SQLite
  # directory and tmux socket. It must not reuse a manually started server.
  check 'browser E2E' env BROWSER=none bun run --cwd studio test:e2e "$@"
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
