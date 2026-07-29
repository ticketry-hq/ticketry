#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/muxed-backend-<target-triple>" >&2
  exit 2
fi

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sidecar_binary="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
target_triple="${sidecar_binary##*muxed-backend-}"
hook_runner="$(dirname "$sidecar_binary")/ticketry-hook-$target_triple"
if [[ ! -x "$hook_runner" ]]; then
  echo "Built hook runner is missing or not executable: $hook_runner" >&2
  exit 2
fi
cd "$backend_dir"
MUXED_SIDECAR_BINARY="$sidecar_binary" \
MUXED_HOOK_RUNNER_BINARY="$hook_runner" \
MUXED_PACKAGED_HOOK_RUNNER="$hook_runner" \
uv run --extra dev python -m pytest -q packaging/tests/test_sidecar.py
