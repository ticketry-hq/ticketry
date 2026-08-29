#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STUDIO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ticketry-native-studio-chords.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT

clang \
  -fno-objc-arc \
  -Wall \
  -Wextra \
  -Werror \
  -framework AppKit \
  "$STUDIO_DIR/src-tauri/native/tests/libghostty_studio_chord_tests.m" \
  -o "$TEST_DIR/libghostty_studio_chord_tests"

"$TEST_DIR/libghostty_studio_chord_tests"
