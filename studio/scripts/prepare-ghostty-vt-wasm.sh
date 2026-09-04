#!/bin/sh
# CODING-1304 — reproducible build of the pinned libghostty-vt WebAssembly
# artifact used by Ticketry's browser-default `ghostty-wasm` renderer.
#
# This pin is deliberately separate from the retained native libghostty pin in
# `prepare-libghostty.sh`. The VT C ABI needed for the WebView renderer exists
# only on newer revisions.
set -eu

GHOSTTY_VT_REVISION="e8aa098674a42e2b4ed1b8c42f4224564ad9fc1e"
ZIG_VERSION="0.16.0"
# ReleaseFast by default. Set GHOSTTY_VT_OPTIMIZE=ReleaseSmall to build the
# small artifact for the cold-start half of the comparison matrix; the two
# differ by several megabytes, which the WebView pays for on every load.
OPTIMIZE="${GHOSTTY_VT_OPTIMIZE:-ReleaseFast}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STUDIO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUT_DIR="$STUDIO_DIR/public/ghostty-vt"
CACHE_DIR="${TICKETRY_GHOSTTY_VT_CACHE_DIR:-$STUDIO_DIR/.cache/ghostty-vt}"
SOURCE_DIR="$CACHE_DIR/ghostty"
ZIG_DIR="$CACHE_DIR/zig-$ZIG_VERSION"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ZIG_ARCHIVE="zig-aarch64-macos-$ZIG_VERSION" ;;
  Darwin-x86_64) ZIG_ARCHIVE="zig-x86_64-macos-$ZIG_VERSION" ;;
  Linux-aarch64) ZIG_ARCHIVE="zig-aarch64-linux-$ZIG_VERSION" ;;
  Linux-x86_64) ZIG_ARCHIVE="zig-x86_64-linux-$ZIG_VERSION" ;;
  *)
    echo "Skipping ghostty-vt wasm preparation: unsupported host"
    exit 0
    ;;
esac

if [ -f "$OUT_DIR/REVISION" ] &&
    [ "$(tr -d '\r\n' < "$OUT_DIR/REVISION")" = "$GHOSTTY_VT_REVISION" ] &&
    [ -f "$OUT_DIR/OPTIMIZE" ] &&
    [ "$(tr -d '\r\n' < "$OUT_DIR/OPTIMIZE")" = "$OPTIMIZE" ] &&
    [ -f "$OUT_DIR/ghostty-vt.wasm" ] &&
    [ -f "$OUT_DIR/LICENSE" ]; then
  echo "Prepared ghostty-vt wasm ($GHOSTTY_VT_REVISION) is current"
  exit 0
fi

if [ ! -x "$ZIG_DIR/zig" ]; then
  mkdir -p "$CACHE_DIR"
  ARCHIVE_PATH="$CACHE_DIR/$ZIG_ARCHIVE.tar.xz"
  curl -fL "https://ziglang.org/download/$ZIG_VERSION/$ZIG_ARCHIVE.tar.xz" -o "$ARCHIVE_PATH"
  tar -xf "$ARCHIVE_PATH" -C "$CACHE_DIR"
  rm -rf "$ZIG_DIR"
  mv "$CACHE_DIR/$ZIG_ARCHIVE" "$ZIG_DIR"
fi

if [ ! -d "$SOURCE_DIR/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/ghostty-org/ghostty.git "$SOURCE_DIR"
fi
git -C "$SOURCE_DIR" fetch --depth 1 origin "$GHOSTTY_VT_REVISION"
git -C "$SOURCE_DIR" checkout --detach --force "$GHOSTTY_VT_REVISION"
if [ -n "$(git -C "$SOURCE_DIR" status --porcelain)" ]; then
  echo "ghostty-vt cache has local modifications: $SOURCE_DIR" >&2
  exit 1
fi

export ZIG_GLOBAL_CACHE_DIR="$CACHE_DIR/zig-global-cache"
BUILD_PREFIX="$CACHE_DIR/out"
rm -rf "$BUILD_PREFIX"
(
  cd "$SOURCE_DIR"
  "$ZIG_DIR/zig" build \
    -Demit-lib-vt \
    -Dtarget=wasm32-freestanding \
    "-Doptimize=$OPTIMIZE" \
    --prefix "$BUILD_PREFIX"
)

mkdir -p "$OUT_DIR"
cp "$BUILD_PREFIX/bin/ghostty-vt.wasm" "$OUT_DIR/ghostty-vt.wasm"
cp "$SOURCE_DIR/LICENSE" "$OUT_DIR/LICENSE"
printf '%s\n' "$GHOSTTY_VT_REVISION" > "$OUT_DIR/REVISION"
printf '%s\n' "$OPTIMIZE" > "$OUT_DIR/OPTIMIZE"
cat > "$OUT_DIR/NOTICE" <<NOTICE
ghostty-vt.wasm is built from Ghostty (https://github.com/ghostty-org/ghostty)
at revision $GHOSTTY_VT_REVISION and is distributed under the MIT license
reproduced in LICENSE next to this file.

Rebuild with: npm run ghostty-vt:prepare --workspace @worktracker/studio
NOTICE

echo "Prepared ghostty-vt wasm ($GHOSTTY_VT_REVISION, $OPTIMIZE) in $OUT_DIR"
