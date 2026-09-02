# `ghostty-wasm` — Ticketry's WebView-hosted terminal renderer

CODING-1304 introduced this renderer as an experiment. CODIN-1514 promotes it
to Ticketry's default terminal renderer. Native libghostty and xterm remain
available for diagnostics and fallback.

## What it does and does not own

- **tmux stays the durable session owner.** Switching renderers does not change
  the run, the tmux session identity, or any persisted terminal record.
- **The transport is unchanged.** Bytes arrive over Ticketry's existing Rust
  tmux attachment and Tauri byte channel (`terminalClientTransport`). There is
  no Node PTY and no second session manager.
- **Frames never reach React.** `internal/surface.ts` drives a
  `requestAnimationFrame` loop off Ghostty's own damage tracking; the React
  component owns a host element and nothing else.
- **Warm story navigation keeps the viewer live.** Hidden viewers keep their
  tmux attachment and continue parsing output into the Ghostty terminal, but
  they do not paint. Returning to a story only fits and paints the current
  state. It does not reattach or replay terminal output.

## Renderer selection

Packaged builds always select `ghostty-wasm`. Development builds use it unless
one of these diagnostic overrides selects another renderer, in precedence
order:

1. Launch flag: open Studio with `?terminalRenderer=native` or
   `?terminalRenderer=xterm`.
2. Development setting: `localStorage["ticketry:terminal-renderer"]`.

Accepted values are `native`, `xterm` and `ghostty-wasm`. Anything else, or no
value, selects `ghostty-wasm`.

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
**separate from** the retained native libghostty pin in
`prepare-libghostty.sh`. The artifact is generated and not committed.

Browser and desktop development builds fetch the prepared file from Vite.
Packaged desktop builds read the same file from Tauri's embedded frontend
assets through `desktop_ghostty_vt_artifact`; WKWebView cannot fetch that
embedded file through the root URL used by Vite.

Without the artifact the renderer reports `wasm_artifact_unavailable` and
Studio uses an available fallback. Normal development and build commands treat
the artifact as required and prepare it before Vite starts.

## Layout

| File | Purpose |
| --- | --- |
| `rendererSelection.ts` | The product default and development diagnostic overrides. |
| `GhosttyWasmTerminal.tsx` | React host: owns the surface's lifetime, nothing else. |
| `internal/wasmRuntime.ts` | Singleton wasm module, memory views, ABI manifest. |
| `internal/abi.ts` | The enum members this experiment names. |
| `internal/terminalCore.ts` | One Ghostty terminal plus its render state; produces frames. |
| `internal/terminalViewport.ts` | Move and read the terminal's own viewport and scrollbar. |
| `internal/canvasRenderer.ts` | Canvas 2D painter for dirty rows. |
| `internal/keyCodes.ts` | `KeyboardEvent.code` to `GhosttyKey` name. |
| `internal/keyEncoder.ts` | Ghostty's own key encoder, re-read from the terminal per keystroke. |
| `internal/mouseEncoder.ts` | Ghostty's own mouse encoder, for programs that track the mouse. |
| `internal/wheelPolicy.ts` | What a wheel gesture means: mouse report, local scroll, or tmux. |
| `internal/viewportScroll.ts` | Pixel-to-row scroll arithmetic; no DOM, no terminal. |
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
  queries go unanswered and a program that waits on one will stall. Xterm
  remains the compatibility fallback while this is unresolved.
- **OSC 8 hyperlinks, selection and Kitty graphics** are present in the C ABI
  but not wired to the canvas yet. Mouse *wheel* reporting is wired; mouse
  buttons and motion are not.
- **Font handling is the browser's.** Nerd Font and Powerline coverage depends
  on what the WebView has, not on Ghostty's font stack.

## Running it

The renderer runs inside the real Studio window; there is no separate harness
page. Start the app normally:

```bash
npm run web            # or npm run desktop:dev
```

Any task terminal opened in that window is drawn by libghostty into a Canvas.
The bytes come from the same tmux viewer the native and xterm renderers use, so
the run, the tmux session and the persisted terminal records are unchanged.

Below the transport there is nothing simulated: the wasm runtime, frame reader,
Canvas painter and key encoder are the shipped modules, and the ABI contract
test in `internal/ghosttyVtContract.test.ts` exercises them against the real
artifact.

## Scrolling

Scrolling is the renderer's own, because the wasm terminal already holds the
scrollback the transport's bytes built. `internal/wheelPolicy.ts` answers a
wheel gesture one of three ways, in precedence order:

1. **A program tracking the mouse** gets a report encoded by
   `ghostty_mouse_encoder_*` and sent as ordinary input, so it scrolls its own
   viewport exactly as it would under any other terminal. The local scroll
   position snaps to the bottom with it: the program redraws into the live
   viewport, so a position held back would hide everything it draws.
2. **On the primary screen** the gesture is answered entirely locally.
   `internal/viewportScroll.ts` accumulates it in pixels; whole rows move
   Ghostty's viewport through `ghostty_terminal_scroll_viewport` with tag
   `DELTA`, and the sub-row remainder becomes a vertical shift the painter
   applies to the whole grid. So a gesture shorter than one row still moves the
   picture, there is no subprocess in the path, and tmux is not involved at all.
   A negative delta moves the viewport back into history — proven against the
   pinned artifact in `internal/ghosttyVtContract.test.ts` rather than assumed.

   The position of record is Ghostty's scrollbar, not the accumulated pixels.
   Every gesture re-anchors to `SCROLLBAR.total - SCROLLBAR.len -
   SCROLLBAR.offset` before folding itself in, and arriving at the bottom is
   issued as tag `BOTTOM` rather than as a delta that ought to land there.
   Without both, output arriving while the reader is scrolled back moves the
   live bottom away from the viewport, and a purely relative row count drifts
   one row per line until nothing can reach the live output again.
3. **On the alternate screen**, which keeps no scrollback of its own, the
   gesture scrolls the durable tmux viewer. This keeps Codex wheel gestures out
   of the app's cursor-key input path.

Any input — a keystroke, a paste — snaps the viewport back to the live bottom
first, and so does a resize, whose reflow makes a row-measured position
meaningless. That snap asks the terminal whether the viewport is live rather
than trusting the accumulated position, so it cannot be skipped while the
viewport sits off the bottom. At the bottom the remainder is exactly zero, so a
terminal nobody has scrolled paints exactly as it did before pixel-smooth
scrolling existed.

tmux's own `mouse` option stays off in every case, so a renderer switch leaves
no trace on the session. Verified against a live session: with a program
holding DECSET 1000/1006, four wheel notches arrived as
`ESC[<64;38;7M` and tmux reported `pane_in_mode=0`.

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
