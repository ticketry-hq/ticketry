#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/muxed-backend-<target-triple>" >&2
  exit 2
fi

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sidecar_binary="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$backend_dir"
MUXED_SIDECAR_BINARY="$sidecar_binary" uv run --extra dev python -m pytest -q packaging/tests/test_sidecar.py
