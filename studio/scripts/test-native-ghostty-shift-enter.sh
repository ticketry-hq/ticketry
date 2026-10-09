#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STUDIO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
VENDOR_DIR="$STUDIO_DIR/src-tauri/vendor/libghostty"
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ticketry-native-shift-enter.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT

if [ ! -f "$VENDOR_DIR/lib/libghostty.a" ]; then
  echo "missing pinned libghostty; run bun run libghostty:prepare" >&2
  exit 1
fi

clang -fno-objc-arc -Wall -Wextra -Werror \
  -I "$VENDOR_DIR/include" \
  "$STUDIO_DIR/src-tauri/native/tests/libghostty_shift_enter_tests.m" \
  "$VENDOR_DIR/lib/libghostty.a" \
  -lc++ -lbz2 -liconv -lresolv -lz \
  -framework AppKit -framework Carbon -framework CoreFoundation \
  -framework CoreGraphics -framework CoreText -framework Foundation \
  -framework IOSurface -framework Metal -framework QuartzCore \
  -framework Security -framework UniformTypeIdentifiers \
  -o "$TEST_DIR/libghostty_shift_enter_tests"

export GHOSTTY_RESOURCES_DIR="$VENDOR_DIR/resources/ghostty"
export TERMINFO="$VENDOR_DIR/resources/terminfo"
"$TEST_DIR/libghostty_shift_enter_tests" \
  "${1:-$STUDIO_DIR/src-tauri/native/ticketry-ghostty.conf}" "$TEST_DIR"
