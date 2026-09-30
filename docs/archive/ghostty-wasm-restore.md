# Archived: Ghostty WASM terminal renderer (CODING-1487)

CODING-1487 removed the `ghostty-wasm` renderer from `rust-migration`. The code
is preserved on branch `archive/CODING-1487-ghostty-wasm`, commit
`38259cf16a5b4190b739dab92237d489c75d8c68`, taken from the `rust-migration`
working tree at `d3f16cf4` immediately before the removal.

That branch is local to this repository. Nothing has been pushed, so the only
copy is on this machine until someone runs:

```sh
git push origin archive/CODING-1487-ghostty-wasm
```

Origin is https://github.com/ticketry-hq/ticketry.git. The same text as this
file is committed on the archive branch at
`docs/archive/ghostty-wasm-restore.md`; keep the two consistent if either
changes.

## What the archive holds

- `studio/src/features/agents/terminal/ghostty-wasm/` — the whole renderer:
  component, WASM loader and runtime, VT core, frame reader, Canvas renderer,
  key and mouse encoders, viewport and scroll policy, and their tests.
- `studio/scripts/prepare-ghostty-vt-wasm.sh` — the reproducible build recipe
  for the pinned artifact, including the upstream revision and Zig version.
- The build and integration surface as it stood: the `studio/package.json`
  prepare hooks, the `desktop_ghostty_vt_artifact` Tauri command and its
  permission, the `studio/release/manifest.v1.json` artifact entries, the
  release-build script, the renderer comparison report, and the WASM acceptance
  tests.
- The renderer-selection policy and the `Terminal.tsx` dispatch as they were
  while WASM was still selectable.

No generated binaries were committed. `studio/public/ghostty-vt/`,
`studio/dist/`, `studio/.cache/` and `studio/src-tauri/target/` are gitignored
build products. Rebuild them from the recipe rather than restoring binaries.

## Pinned upstream

`prepare-ghostty-vt-wasm.sh` pins ghostty-org/ghostty revision
`e8aa098674a42e2b4ed1b8c42f4224564ad9fc1e`, built with Zig 0.16.0 for
`wasm32-freestanding` via `zig build -Demit-lib-vt`.

## Recovering the renderer

Check the branch out in its own worktree so the active branch is untouched:

```sh
git fetch origin archive/CODING-1487-ghostty-wasm   # only once it is pushed
git worktree add ../ticketry-ghostty-wasm archive/CODING-1487-ghostty-wasm
cd ../ticketry-ghostty-wasm
npm install
npm run ghostty-vt:prepare --workspace @worktracker/studio
```

`ghostty-vt:prepare` downloads Zig 0.16.0 into `studio/.cache/ghostty-vt/`,
clones the pinned revision, builds it, and writes
`studio/public/ghostty-vt/ghostty-vt.wasm` alongside `REVISION`, `OPTIMIZE`,
`LICENSE` and `NOTICE`. It skips the build when those already match the pin.
`GHOSTTY_VT_OPTIMIZE=ReleaseSmall` selects the small artifact instead of the
default `ReleaseFast`.

To bring the renderer back into an active branch, restore these paths from the
archive commit and then re-add the integration points that were deleted with
them:

- `studio/src/features/agents/terminal/ghostty-wasm/`
- `studio/scripts/prepare-ghostty-vt-wasm.sh`
- the `ghostty-vt:prepare` script and the desktop/release prepare hooks in
  `studio/package.json`
- the `desktop_ghostty_vt_artifact` command registration and its capability
  entry in `studio/src-tauri/`
- the ghostty-vt artifact entries in `studio/release/manifest.v1.json` and the
  release-build script step that stages them
- the `ghostty-wasm` branch of renderer selection and the `Terminal.tsx`
  dispatch case

## Current policy

Desktop development and packaged builds render terminals with embedded native
libghostty, which owns its PTY, runs the validated tmux attach command, and
draws in a native view inside the Ticketry window. Browser development renders
with xterm over the `browserTerminalClient` WebSocket adapter to the Rust
terminal adapter, and xterm is the compatibility fallback everywhere. tmux owns
durable terminal sessions under every renderer. This archive is historical
evidence, not a supported configuration.
