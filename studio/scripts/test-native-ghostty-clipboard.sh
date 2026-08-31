#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STUDIO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
INCLUDE_DIR=${MUXED_LIBGHOSTTY_INCLUDE_DIR:-"$STUDIO_DIR/src-tauri/vendor/libghostty/include"}
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ticketry-native-clipboard.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT

if [ ! -f "$INCLUDE_DIR/ghostty.h" ]; then
  echo "missing pinned ghostty.h; run npm run libghostty:prepare" >&2
  exit 1
fi

clang \
  -fblocks \
  -fno-objc-arc \
  -Wall \
  -Wextra \
  -Werror \
  -I "$INCLUDE_DIR" \
  -framework AppKit \
  "$STUDIO_DIR/src-tauri/native/tests/libghostty_clipboard_tests.m" \
  -o "$TEST_DIR/libghostty_clipboard_tests"

"$TEST_DIR/libghostty_clipboard_tests"
