# CODING-1304 WebView-hosted Ghostty renderer — evidence

Post-release experiment. Not a release blocker, and not a migration: the
deliverable is evidence and one recommendation.

## What shipped in this branch

A feature-gated third renderer, `ghostty-wasm`, under
`studio/src/features/agents/terminal/ghostty-wasm/`. It draws libghostty-vt
frames onto a Canvas 2D surface inside Ticketry's WKWebView, fed by the
existing Rust tmux attachment over the existing Tauri byte channel.

- tmux remains the durable session owner.
- Native libghostty remains the desktop default; xterm remains the fallback.
- The gate is development-only (`import.meta.env.DEV`), read from
  `?terminalRenderer=` then `localStorage["ticketry:terminal-renderer"]`.
- Switching renderers changes no run, no tmux session identity, and no
  persisted terminal record. No GraphQL contract changed.
- Experiment failures are deliberately excluded from the window-scoped native
  render recovery campaign: a WebView reload cannot produce a missing wasm
  artifact, and reloading on that failure would escalate to the reload cap.

## The pin

| | Native renderer | `ghostty-wasm` |
| --- | --- | --- |
| Ghostty revision | `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28` (v1.3.1) | `e8aa098674a42e2b4ed1b8c42f4224564ad9fc1e` |
| Toolchain | Zig 0.15.2 | Zig 0.16.0 |
| Script | `studio/scripts/prepare-libghostty.sh` | `studio/scripts/prepare-ghostty-vt-wasm.sh` |
| Output | `src-tauri/vendor/libghostty/lib/libghostty.a` | `studio/public/ghostty-vt/ghostty-vt.wasm` |

The two pins are separate on purpose. At v1.3.1 the `libghostty-vt` C ABI
exposes only the OSC parser, SGR parser, key encoder, paste-safety helpers and
colour utilities — there is no terminal, screen or render-state API, so a
WebView renderer cannot be built against it at all. The newer revision adds
`terminal.h`, `screen.h`, `render.h`, `snapshot.h`, `selection.h`,
`mouse/encoder.h` and `kitty_graphics.h`, which is the surface T3's renderer
uses. **Nothing in this experiment changes what the native renderer links
against.**

The binding reads struct offsets, struct sizes and enum values from the
artifact's own `ghostty_type_json()` ABI manifest rather than transcribing
headers, so re-pinning surfaces a removed member as a load-time error.
`internal/ghosttyVtContract.test.ts` exercises that binding against the real
artifact and skips when it has not been prepared.

## Measurement method

All three renderers record through the same seam
(`internal/rendererMeasurement.ts`): cold attach, warm attach, painted frames,
paint duration percentiles, bytes parsed, and wasm linear memory.

What each renderer can report differs, and the difference is itself a result:

| Counter | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| Cold and warm attach | yes | yes | yes |
| Bytes parsed | no | yes | yes |
| Paint duration | no | parse-and-enqueue only | yes |
| Wasm memory | n/a | n/a | yes |

Native reports attach latency only because its bytes never leave Rust and
libghostty — that is the renderer's central advantage, and an empty column
here means "no JavaScript work to measure", not "not measured". xterm renders
its buffer asynchronously, so its paint figure is the cost of parsing and
enqueuing, not of a frame. Only `ghostty-wasm` times an actual paint. Read the
columns accordingly; do not compare paint numbers across renderers as if they
measured the same thing. CPU, memory and frame pacing for the native renderer
must come from Instruments or Activity Monitor, not from this harness.

Read the counters out of a live Studio window:

```js
JSON.stringify({
  context: {
    label: "burst-80x24",
    command: "cat large.ansi",
    dimensions: "80x24",
    sampleSeconds: 30,
    machine: "<model, macOS version>",
    buildMode: "release",
    method: "window.__ticketryRendererMeasurements()",
  },
  samples: window.__ticketryRendererMeasurements(),
})
```

then reduce the captures:

```bash
node scripts/renderer-comparison-report.mjs capture-*.json
```

The report emits one row per renderer and lists any capture missing required
context, so an incomplete matrix cannot read as a complete one. Measurements
must come from Ticketry's WKWebView — not Node, Electron, or a standalone
browser.

## Comparison matrix

Run every case against native Ghostty, xterm and `ghostty-wasm` in the same
Ticketry build on the same machine. Nothing below has been filled in yet.

### Startup and resource use

| Case | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| Cold: selection to first painted prompt | | | |
| Warm attach after the wasm runtime is cached | | | |
| Idle CPU, one visible terminal | | | |
| Idle CPU, several retained hidden terminals | | | |
| Memory per opened terminal | | | |
| CPU and frame pacing under sustained output | | | |
| Large ANSI-coloured output burst | | | |

### Rendering correctness

| Case | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| ANSI colours, attributes, cursor styles, alternate screen, clear | | | |
| Combining marks, emoji families, wide characters, Arabic, graphemes | | | |
| Nerd Font and Powerline glyphs | | | |
| Rapid full-screen updates in `vim`, `less`, `htop` | | | |
| OSC 8 hyperlinks | | | |
| Terminal graphics, including Kitty graphics if present | | | |
| Scrollback anchoring, selection, copy across wrapped lines | | | |

### Input and interaction

| Case | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| Printable input and echo latency | | | |
| Command, Control, Option, Shift, function, navigation keys | | | |
| Studio global shortcuts while the terminal has focus | | | |
| `Cmd+Escape` typing disengagement | | | |
| Copy, paste, bracketed paste, large paste | | | |
| IME and composed input | | | |
| Mouse reporting, Shift bypass, drag selection, wheel | | | |
| Link hover and activation | | | |

### Studio integration

| Case | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| Settings opened over a terminal | | | |
| Confirms and state configuration over a terminal | | | |
| Continuous bottom-panel resize | | | |
| Enter and leave fullscreen | | | |
| Switch terminal tabs, work items, navigation destinations | | | |
| Hidden viewers retained without input or continuous repaint | | | |
| Ownership moved between task workspace and drawer | | | |
| WebView reload with terminals alive in tmux | | | |

### Failure and recovery

| Case | native | xterm | `ghostty-wasm` |
| --- | --- | --- | --- |
| Renderer initialisation failure | | | covered — falls back to xterm |
| Wasm artifact load failure | n/a | n/a | covered — `wasm_artifact_unavailable` |
| tmux session missing or ending during attach | | | |
| Tauri channel backpressure and disconnect | | | |
| Viewer lease acquisition, renewal, release failure | | | |
| Reconnect and scrollback reconstruction without replaying device queries | | | |

## Known gaps found while building it

1. **Terminal replies are not sent.** Ghostty answers device attribute and
   status queries through its `WRITE_PTY` callback, which needs a function
   reference in the wasm indirect table. The artifact is built with an exported,
   growable table for exactly this purpose, but installing a JS function into it
   is not wired and has not been verified against WKWebView's JavaScriptCore.
   Until it is, those queries go unanswered and a program that waits on one will
   stall. This blocks a promotion decision on its own and must be resolved or
   ruled out before the matrix is read as favourable.
2. **Mouse reporting, OSC 8 hyperlinks, selection rendering and Kitty
   graphics** exist in the C ABI but are not wired to the canvas.
3. **Font coverage is the WebView's,** not Ghostty's font stack, so Nerd Font
   and Powerline results are a property of the host.

These are the reproducible correctness gaps the ticket asks for; each needs a
command in the matrix above before the recommendation is written.

## Viewer lease locking is out of scope

The `database is locked` failure seen behind native render recovery is a
control-plane problem. Both renderers take the same durable viewer lease, so
moving Ghostty into Canvas cannot fix it. Treat it separately unless a result
here proves the ownership rule itself must change.

## Recommendation

Not yet written. It must be exactly one of: promote the WebView renderer in a
follow-up, keep native and borrow selected ideas, or abandon the experiment —
supported by the filled matrix above. Any production migration is a separate
ticket.
