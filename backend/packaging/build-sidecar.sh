#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_dir="$(cd "$backend_dir/.." && pwd)"
target="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
output_dir="${2:-$backend_dir/../studio/src-tauri/binaries}"

if [[ -z "$target" ]]; then
  echo "Could not determine target triple; pass it as the first argument." >&2
  exit 2
fi

mkdir -p "$output_dir"

hook_extension=""
if [[ "$target" == *-windows-* ]]; then
  hook_extension=".exe"
fi
rustc \
  --edition=2021 \
  --target "$target" \
  -C opt-level=2 \
  -C strip=symbols \
  "$repository_dir/studio/src-tauri/native/ticketry_hook.rs" \
  -o "$output_dir/ticketry-hook-$target$hook_extension"

cd "$backend_dir/packaging"

MUXED_SIDECAR_NAME="muxed-backend-$target" uv run --extra packaging pyinstaller \
  --noconfirm \
  --clean \
  --distpath "$output_dir" \
  --workpath "${TMPDIR:-/tmp}/muxed-backend-pyinstaller-$target" \
  muxed-backend.spec

echo "$output_dir/muxed-backend-$target"
