# `ghostty-wasm` — WebView-hosted Ghostty renderer (CODING-1304)

A feature-gated third terminal renderer, built to answer one question with
measurements: does rendering the terminal inside Ticketry's WKWebView improve
focus, layout, modal behaviour and maintainability enough to justify any loss
in rendering speed, terminal features or native integration?

It is an experiment. Native libghostty stays the desktop default and xterm
stays the compatibility fallback. Nothing here is on a path to shipping without
a separate follow-up ticket.

## What it does and does not own

- **tmux stays the durable session owner.** Switching renderers does not change
  the run, the tmux session identity, or any persisted terminal record.
- **The transport is unchanged.** Bytes arrive over Ticketry's existing Rust
  tmux attachment and Tauri byte channel (`terminalClientTransport`). There is
  no Node PTY and no second session manager.
- **Frames never reach React.** `internal/surface.ts` drives a
  `requestAnimationFrame` loop off Ghostty's own damage tracking; the React
  component owns a host element and nothing else.

## Enabling it

The gate is development-only — `import.meta.env.DEV` — so a packaged build can
never reach it. Within a development build, in precedence order:

1. Launch flag: open Studio with `?terminalRenderer=ghostty-wasm`.
2. Development setting: `localStorage["ticketry:terminal-renderer"]`.

Accepted values are `native`, `xterm` and `ghostty-wasm`. Anything else, or no
value, keeps the default native/xterm behaviour.

## Preparing the artifact

```bash
npm run ghostty-vt:prepare --workspace @worktracker/studio
```

This builds `public/ghostty-vt/ghostty-vt.wasm` from a pinned Ghostty revision
with a pinned Zig toolchain, and copies Ghostty's licence next to it. The
default `ReleaseFast` artifact is ~4.5 MB; set `GHOSTTY_VT_OPTIMIZE=ReleaseSmall`
to build the small one for the cold-start comparison. The mode is recorded in
`public/ghostty-vt/OPTIMIZE` so a rebuild switches artifacts rather than
reusing the wrong one. The pin is
**separate from** the native libghostty pin in `prepare-libghostty.sh`: the
released tag Ticketry links natively predates the VT C ABI (terminal, screen,
render, snapshot, selection) this renderer needs. The artifact is not committed.

Without the artifact the renderer reports `wasm_artifact_unavailable` and
Studio falls back to xterm — that is a supported posture, and one of the
failure cases the experiment has to cover.

## Layout

| File | Purpose |
| --- | --- |
| `rendererSelection.ts` | The development-only renderer gate. |
| `GhosttyWasmTerminal.tsx` | React host: owns the surface's lifetime, nothing else. |
| `internal/wasmRuntime.ts` | Singleton wasm module, memory views, ABI manifest. |
| `internal/abi.ts` | The enum members this experiment names. |
| `internal/terminalCore.ts` | One Ghostty terminal plus its render state; produces frames. |
| `internal/canvasRenderer.ts` | Canvas 2D painter for dirty rows. |
| `internal/keyCodes.ts` | `KeyboardEvent.code` to `GhosttyKey` name. |
| `internal/keyEncoder.ts` | Ghostty's own key encoder, re-read from the terminal per keystroke. |
| `internal/surface.ts` | Transport, core, renderer and input joined together. |
| `internal/rendererMeasurement.ts` | The counters the comparison matrix is built from. |

Struct offsets, struct sizes and enum values are read from the artifact's own
`ghostty_type_json()` ABI manifest, never transcribed from headers, so a
re-pinned artifact fails loudly instead of reading the wrong field.
`internal/ghosttyVtContract.test.ts` is what proves that binding still holds; it
skips when the artifact has not been prepared.

## Known gaps

- **Terminal replies are not sent.** Ghostty answers device attribute and
  status queries through its `WRITE_PTY` callback, which needs a function
  reference in the wasm indirect table. The artifact is built with an exported,
  growable table for exactly this, but installing a JS function into it has not
  been wired or verified against WKWebView's JavaScriptCore. Until it is, those
  queries go unanswered and a program that waits on one will stall. Resolving
  or ruling this out is a prerequisite for any promotion decision.
- **Mouse reporting, OSC 8 hyperlinks, selection and Kitty graphics** are
  present in the C ABI but not wired to the canvas yet.
- **Font handling is the browser's.** Nerd Font and Powerline coverage depends
  on what the WebView has, not on Ghostty's font stack.

## Reporting

Measurements are read from a live Studio window:

```js
copy(JSON.stringify({ context: { /* … */ }, samples: window.__ticketryRendererMeasurements() }))
```

then reduced into the comparison matrix:

```bash
node scripts/renderer-comparison-report.mjs capture-*.json
```

Findings belong in
[`docs/plans/CODING-1304-webview-ghostty-renderer-evidence.md`](../../../../../../docs/plans/CODING-1304-webview-ghostty-renderer-evidence.md).
