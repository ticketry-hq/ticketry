#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
studio_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
manifest="$studio_root/src-tauri/Cargo.toml"

set -- test --manifest-path "$manifest" --features native-libghostty --lib --bins
for source in "$studio_root"/src-tauri/tests/*.rs; do
  target=$(basename -- "$source" .rs)
  case "$target" in
    automation_attempts|crash_safe_launch_reconciliation|design_document_adoption|installation_adoption|installation_classification|installation_preflight|prepared_launch_effects|runs_persistence|slice3_ownership_handoff|slice4_ownership_handoff|terminal_persistence_adoption|work_management_adoption|work_management_shape_parity|worktree_metadata_adoption)
      # These preserve the pre-cutover Django source-corpus tests. The Rust-only
      # repository no longer ships the Python backend they execute.
      continue
      ;;
  esac
  set -- "$@" --test "$target"
done

cargo "$@"
cargo test --manifest-path "$manifest" --features native-libghostty --doc
