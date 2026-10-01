#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export BROWSER=none
exec npm run web:dev -- --temp-sqlite --log-to-file
