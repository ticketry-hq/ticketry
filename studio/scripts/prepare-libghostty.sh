#!/bin/sh
set -eu

GHOSTTY_REVISION="332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28"
GHOSTTY_TAG="v1.3.1"
ZIG_VERSION="0.15.2"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STUDIO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
VENDOR_DIR="$STUDIO_DIR/src-tauri/vendor/libghostty"
CACHE_DIR="${MUXED_LIBGHOSTTY_CACHE_DIR:-$STUDIO_DIR/.cache/libghostty}"
SOURCE_DIR="$CACHE_DIR/ghostty"
ZIG_DIR="$CACHE_DIR/zig-$ZIG_VERSION"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ZIG_ARCHIVE="zig-aarch64-macos-$ZIG_VERSION" ;;
  Darwin-x86_64) ZIG_ARCHIVE="zig-x86_64-macos-$ZIG_VERSION" ;;
  *)
    echo "Skipping native libghostty preparation: macOS only"
    exit 0
    ;;
esac

if [ -f "$VENDOR_DIR/REVISION" ] &&
    [ "$(tr -d '\r\n' < "$VENDOR_DIR/REVISION")" = "$GHOSTTY_REVISION" ] &&
    [ -f "$VENDOR_DIR/include/ghostty.h" ] &&
    [ -f "$VENDOR_DIR/lib/libghostty.a" ] &&
    [ -d "$VENDOR_DIR/resources/ghostty" ] &&
    [ -d "$VENDOR_DIR/resources/terminfo" ]; then
  echo "Prepared libghostty $GHOSTTY_TAG ($GHOSTTY_REVISION) is current"
  exit 0
fi

if [ ! -x "$ZIG_DIR/zig" ]; then
  mkdir -p "$CACHE_DIR"
  ARCHIVE_PATH="$CACHE_DIR/$ZIG_ARCHIVE.tar.xz"
  curl -fL "https://ziglang.org/download/$ZIG_VERSION/$ZIG_ARCHIVE.tar.xz" -o "$ARCHIVE_PATH"
  tar -xf "$ARCHIVE_PATH" -C "$CACHE_DIR"
  mv "$CACHE_DIR/$ZIG_ARCHIVE" "$ZIG_DIR"
fi

if [ ! -d "$SOURCE_DIR/.git" ]; then
  git clone https://github.com/ghostty-org/ghostty.git "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --depth 1 origin "$GHOSTTY_TAG"
git -C "$SOURCE_DIR" checkout --detach "$GHOSTTY_REVISION"
if git -C "$SOURCE_DIR" apply --check "$SCRIPT_DIR/libghostty-macos-static.patch"; then
  git -C "$SOURCE_DIR" apply "$SCRIPT_DIR/libghostty-macos-static.patch"
elif ! git -C "$SOURCE_DIR" apply --reverse --check "$SCRIPT_DIR/libghostty-macos-static.patch"; then
  echo "libghostty cache contains changes other than the expected build patch: $SOURCE_DIR" >&2
  exit 1
fi

if ! xcrun --find metal >/dev/null 2>&1 &&
    [ -d /Applications/Xcode.app/Contents/Developer ]; then
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  export DEVELOPER_DIR
fi
if ! xcrun --find metal >/dev/null 2>&1; then
  echo "building libghostty requires Xcode with the Metal compiler" >&2
  exit 1
fi

SDKROOT=$(xcrun --show-sdk-path)
export SDKROOT
export ZIG_GLOBAL_CACHE_DIR="$CACHE_DIR/zig-global-cache"

(
  cd "$SOURCE_DIR"
  "$ZIG_DIR/zig" build \
    -Dapp-runtime=none \
    -Demit-xcframework=false \
    -Demit-macos-app=false \
    -Doptimize=ReleaseFast
)

mkdir -p "$VENDOR_DIR/include" "$VENDOR_DIR/lib"
cp "$SOURCE_DIR/zig-out/include/ghostty.h" "$VENDOR_DIR/include/ghostty.h"
cp "$SOURCE_DIR/zig-out/lib/libghostty.a" "$VENDOR_DIR/lib/libghostty.a"
rm -rf "$VENDOR_DIR/resources"
mkdir -p "$VENDOR_DIR/resources"
cp -R "$SOURCE_DIR/zig-out/share/ghostty" "$VENDOR_DIR/resources/ghostty"
cp -R "$SOURCE_DIR/zig-out/share/terminfo" "$VENDOR_DIR/resources/terminfo"
printf '%s\n' "$GHOSTTY_REVISION" > "$VENDOR_DIR/REVISION"

echo "Prepared libghostty $GHOSTTY_TAG ($GHOSTTY_REVISION)"
