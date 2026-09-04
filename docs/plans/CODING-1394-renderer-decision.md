# CODING-1394 renderer decision

Decision date: 2026-09-04

Decision: keep `ghostty-wasm` as the default.

This task does not change renderer selection. Native libghostty remains an
explicit packaged capture override and a development diagnostic renderer.
`xterm` remains a fallback.

## Why native is not being promoted

The native underlay did not meet its promotion rule. A packaged,
same-condition native-versus-WASM campaign was not completed. In particular,
there is no packaged human-interaction capture set for the selection-gated
model and no paired WASM 1, 5, and 20-terminal resource run. Automated sibling
ordering tests are useful, but the ticket explicitly says they are not proof
that people can reliably understand and operate the selection state.

The native underlay also has two observed UX costs:

- The consumed activation click cannot act on terminal content. Cursor
  placement, selection, links, and
  mouse-report programs need a first native follow-up click.
- Copy is limited to text on the visible surface. Selection cannot extend
  through tmux scrollback.

Durable native history scrolling works only through Ticketry's direct
AppKit-to-Rust tmux scroll path. Letting libghostty handle alternate-screen
scrolling turns the gesture into application cursor input. A tmux mouse-mode
attempt to combine sticky history selection and scrolling regressed both and
was removed.

## Conditions and limits of the evidence

The CODING-1393 native resource run is valid packaged evidence for native view
retention only. It used an Apple M2 Pro Mac14,9 with 16 GiB RAM, arm64 macOS
26.2, packaged executable SHA-256
`d91529d2c05647d32228b21611cadd6bd33ab4478f936e5afa28396a4e5d9c60`, a
120-second settle, and a 60-second sample window. It did not run WASM against
the same Terminal Sessions, commands, dimensions, input device, or sample
windows, so it must not be read as a renderer performance comparison.

| Native views | CPU p95 | RSS p95 | Result |
| ---: | ---: | ---: | --- |
| 1 | 0.7% | 134.86 MiB | Passed the declared native-retention budget |
| 5 | 1.5% | 143.64 MiB | Passed, 0.8 CPU points and 8.78 MiB over baseline |
| 20 | 1.1% | 168.42 MiB | Passed, 0.4 CPU points and 33.56 MiB over baseline |

The measured native warm-retention limit is 20 mounted views. The oldest
inactive view is evicted before a twenty-first replacement is mounted.

There is a cross-renderer integration risk in the current shared viewer host.
`RetainedTerminalViewers` applies the native-derived limit to WASM and xterm as
well, although CODING-1393 measured native views only. Its final
`presentedRunIds` merge also adds every acknowledged pending run after the LRU
slice, so a burst of more than 20 acknowledgements can temporarily mount more
than the claimed cap. CODING-1393 review should either narrow the cap to native
views or add evidence and coverage for the shared policy. This decision does
not treat the cap as a WASM resource result.

## Comparison record

The table keeps unsupported and unmeasured cases visible. "Automated" means a
test covers the ordering or transport rule, not that packaged human use passed.

| Area | Native underlay | `ghostty-wasm` | Comparison status |
| --- | --- | --- | --- |
| Startup, cold and warm attach | Attach instrumentation exists; no paired capture | Instrumentation exists; no paired capture | Missing same-window samples |
| CPU and memory | Packaged native-only 1/5/20 results above | No paired 1/5/20 results | Not comparable |
| Native view and viewer counts | 1/5/20 views verified for the retention run | No matching retained-terminal capture | Not comparable |
| Hidden output | Hidden native views stop drawing and reject input in automated coverage | No matched packaged capture | Automated native result only |
| Sustained output and frame pacing | No paired capture | No paired capture | Missing |
| Rendering correctness | Development use established a usable visible surface | Known WASM implementation and artifact tests exist | ANSI, Unicode, fonts, full-screen programs, and graphics lack paired packaged results |
| Keyboard and paste | Typing and visible-surface Cmd+C/Cmd+V observed after selection | Default renderer behavior is covered by existing tests | No paired packaged latency or large-paste run |
| IME | Native text-input bridge has automated preedit and commit tests | No paired packaged capture | Required native packaged case missing |
| Selection and copy | Visible surface only; cannot extend through tmux scrollback | No paired packaged capture | Native limitation confirmed |
| Mouse reporting | Wheel path covered; no packaged mouse-program capture | Wheel reporting implemented; buttons and motion remain unsupported | Required paired case missing |
| Wheel and trackpad | Direct tmux history path is covered and observed | Local primary-screen and tmux alternate-screen paths exist | No paired packaged trackpad run |
| Links | First native action needs a follow-up click | OSC 8 activation is unsupported | Failed or unsupported for promotion evidence |
| Overlays and WebView ownership | Settings and workflow actions lower native without exercised leakage; automated ordering covers the rule | WebView owns the surface | Menus, tooltips, drag, and capture set incomplete |
| Resize and fullscreen | Geometry and fullscreen have automated coverage | No paired packaged capture | Required packaged cases missing |
| Navigation and reload | Native selection clears on lifecycle changes in automated coverage | WASM is the shipping path and falls back when its artifact is unavailable | No paired recovery campaign |
| Fallback and recovery | Native remains an explicit diagnostic override | Artifact failure falls back to xterm | Broader tmux, channel, and lease failures lack paired captures |

## Native selection-gate capture record

| Required capture | Evidence | Status |
| --- | --- | --- |
| Below by default | DOM and AppKit ordering tests | Automated only |
| Activation click and focus acquisition | Development use plus ordering tests | Development observation, no packaged capture |
| First native follow-up click | Consumed activation is implemented | Required packaged UX result missing |
| Keyboard and IME after activation | Typing observed; text-input bridge tested | Packaged IME capture missing |
| WebView action lowers terminal | Settings and workflow cases exercised | Development observation and automated coverage |
| Modal, menu, tooltip, and drag without leakage | Partial modal and Settings coverage | Menu, tooltip, and drag capture missing |
| Overlay close then explicit reselection | Automated selection model | Packaged UX capture missing |
| Rapid switching among terminals | Generation-fenced ordering tests | Automated only |

## WASM limitations retained in the decision

Keeping the current default is not a claim that every WASM case passed this
campaign. Terminal device-query replies through `WRITE_PTY` are not wired.
OSC 8 link activation, canvas selection, Kitty graphics, mouse buttons, and
mouse motion remain unsupported. Font coverage comes from the WebView. These
limitations stay visible because result 1 is a decision not to promote the
native experiment, not a new certification of the existing renderer.

## Follow-up rule

A later native migration proposal needs a new task. It must repeat native and
WASM measurements with the same Terminal Sessions, commands, dimensions,
machine, build, input device, and sample windows, and it must include the full
packaged selection-gate capture set above. Until then, `ghostty-wasm` remains
the shipping default.
