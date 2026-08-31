#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
studio_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
target=${CARGO_BUILD_TARGET:-$(rustc -vV | awk '/^host: / { print $2 }')}

case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin) ;;
  *)
    echo "ticketry-hook preparation does not support target $target" >&2
    exit 1
    ;;
esac

output="$studio_root/src-tauri/binaries/ticketry-hook-$target"
mkdir -p "$(dirname -- "$output")"
rustc "$studio_root/src-tauri/native/ticketry_hook.rs" \
  --edition 2021 \
  --target "$target" \
  -C opt-level=2 \
  -o "$output"

echo "Prepared $output"
