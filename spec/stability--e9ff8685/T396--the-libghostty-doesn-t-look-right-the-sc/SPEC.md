# CODING-396 — Correct native libghostty first-attach geometry and scrolling

Status: Spec complete
Story: WorkTracker #396 (`8d87b1ab-7ea7-4280-a05c-94c435f67db5`)
Date: 2026-08-10

Related decisions: [Grill handoff](grill-handoff.md) · [Scroll bridge ADR](../../../backend/apps/terminals/docs/adr/0001-viewers-scroll-the-session-through-the-scroll-bridge.md)

## Problem Statement

The native libghostty terminal viewer does not look correct when it first
appears. It briefly renders the durable terminal session at a hard-coded
80-by-24 grid and stretches that redraw into the actual pane. The viewer only
snaps to the correct dimensions after a later layout event, such as resizing
the Ticketry window. The same first-attach sequence runs when switching back to
or reopening a terminal tab, so those paths can show the same wrong-size
redraw.

Wheel and trackpad gestures are also being interpreted by libghostty as input
to the hosted command. In alternate-screen applications this becomes
synthesized up/down arrow keys, which can change a TUI instead of reviewing the
durable terminal session's history. Ticketry's browser terminal viewer already
avoids this by using the Scroll bridge to move tmux copy-mode scrollback, but
the native viewer does not yet use that mechanism.

## Solution

Ticketry will prepare each native terminal viewer at its real pane geometry
before presenting it. The native libghostty surface will remain hidden while
its actual grid and Retina content scale are established, the tmux viewer is
attached at that grid, and the first correctly sized redraw is delivered. Only
then will Ticketry reveal the native surface and retire the pooled browser
viewer. First open, tab switching, and reopen will all use this readiness gate;
ordinary window resizing will continue to resize the already-visible surface
live.

The native view will consume vertical wheel and trackpad gestures and report
their direction and line count through the native terminal adapter. The adapter
will drive the existing Scroll bridge, giving both terminal viewers the same
tmux copy-mode behavior. Scrolling upward will enter history, scrolling down
past the bottom will return to the live prompt, tmux mouse mode will remain off,
and no wheel gesture will reach the hosted command as a synthesized key.

## User Stories

1. As a Ticketry user, I want a native terminal to appear at the pane's real grid on first open, so that I never see an incorrectly stretched terminal.
2. As a Ticketry user, I want the first visible terminal redraw to use the correct rows and columns, so that TUIs do not visibly reflow immediately after appearing.
3. As a Ticketry user, I want the correctly sized viewer to appear without resizing the Ticketry window, so that normal startup needs no corrective gesture.
4. As a Ticketry user, I want switching away from and back to a native terminal tab to preserve correct presentation, so that tab navigation does not reintroduce the first-attach defect.
5. As a Ticketry user, I want reopening a native terminal viewer to use its current pane geometry, so that a renewed attachment does not flash at 80 by 24.
6. As a Ticketry user, I want the pooled browser viewer or blank terminal host to remain until the native viewer is ready, so that incomplete native rendering is never exposed.
7. As a Ticketry user, I want a failed native preparation to leave the fallback available, so that a geometry or bridge failure does not strand me with a broken terminal surface.
8. As a Ticketry user, I want resizing the Ticketry window after attach to continue resizing the terminal live, so that the fix does not regress responsive layout.
9. As a Retina-display user, I want the native terminal's content scale to match the window from its first frame, so that cells and text are not initially blurred or mismeasured.
10. As a user moving Ticketry between displays, I want later backing-scale changes to continue updating the native surface, so that first-attach scale initialization does not replace existing display-change handling.
11. As a mouse-wheel user, I want upward scrolling in the native viewer to review the durable terminal session's history, so that the wheel behaves like terminal scrollback.
12. As a trackpad user, I want precise vertical gestures converted into bounded line scrolling, so that small and large gestures remain controlled.
13. As a Ticketry user, I want downward scrolling past the end of history to return to the live prompt, so that I can resume interaction naturally.
14. As a Ticketry user running a TUI, I want wheel gestures never to become arrow-key input, so that reviewing history cannot move selection or change the hosted command.
15. As a Ticketry user, I want scrolling to leave the durable terminal session alive, so that history navigation cannot terminate ongoing work.
16. As a Ticketry user, I want tmux mouse mode to remain off, so that browser-viewer click-drag selection keeps working.
17. As a Ticketry user, I want native and browser viewers to use the same Scroll bridge semantics, so that switching renderers does not change scrollback ownership or configuration.
18. As a browser-viewer user, I want its existing scroll frames, selection, and fallback behavior to remain unchanged, so that fixing the native viewer creates no browser regression.
19. As a Ticketry user, I want horizontal-only trackpad gestures to produce no terminal input, so that an unsupported gesture cannot be translated into keys.
20. As a maintainer, I want native attach readiness and scrolling verified at stable product and terminal-runtime seams, so that future renderer changes cannot restore the flash or arrow-key behavior.

## Implementation Decisions

* Keep tmux as the durable terminal session and scrollback owner. The native
  libghostty surface remains a temporary Terminal viewer and continues to use
  the existing viewer ownership lease and pooled browser fallback.
* Make initial pane geometry part of the native attach contract. Studio will
  measure and viewport-clip the mounted terminal host after acquiring viewer
  ownership, then supply that frame when beginning the native attachment.
  Later frame updates remain a separate live-resize operation.
* Treat native attachment as a preparation state followed by a presented
  state. A newly created AppKit view is hidden while Ticketry applies the real
  frame, obtains libghostty's actual rows and columns, and establishes the
  terminal attachment at that exact grid. The hard-coded 80-by-24 grid is not
  a valid prepared or ready result.
* Do not expose the native surface merely because libghostty accepted a frame.
  Readiness requires a non-empty grid, a successful tmux attachment/resize at
  that grid, and delivery of the first terminal redraw generated for that
  geometry. Reveal the AppKit view on the main thread only after those
  conditions are met, then report attach success to Studio.
* Keep the pooled browser transport until the native attach command reports
  this fully presented state. Studio's native-ready callback, focus request,
  ResizeObserver registration, and pooled-transport release happen only after
  that result. This same component lifecycle covers first open, tab switch,
  and reopen.
* Initialize libghostty's surface scale and its backing layer scale from the
  actual parent window's backing scale after the view belongs to that window
  and before the first frame is measured. Retain backing-property change
  handling for later movement between displays; do not use the main screen as
  a proxy for the target window during first attach.
* Extend the narrow native host boundary with scroll intent rather than
  forwarding renderer mouse-scroll input. The AppKit view consumes vertical
  wheel events, converts the vertical delta into an up/down direction and a
  bounded line count using the browser viewer's established normalization
  policy, and reports that intent to the Rust native-terminal owner.
* Ignore horizontal-only wheel gestures. Never pass either vertical or
  horizontal wheel deltas to libghostty's mouse-scroll entry point, because
  renderer fallback behavior is allowed to synthesize hosted-command input.
* Add scroll as a first-class native worker command. The Rust adapter forwards
  each accepted gesture to the existing terminal attachment scroll control,
  which enters tmux copy-mode with exit-at-bottom and hidden-position-marker
  semantics and performs the requested line movement. Do not create a second
  tmux command path.
* Bound each native scroll request consistently with the browser viewer before
  it reaches the terminal runtime. Preserve gesture ordering while allowing
  the existing worker queue to serialize scroll, resize, input, and detach
  controls for one viewer.
* Make native callback lifetime explicit: stop accepting scroll callbacks when
  detachment begins, remove and free the AppKit view on the main thread, and
  release any callback context only after the view can no longer emit events.
  Late gestures from a replaced viewer must not affect its replacement.
* On preparation timeout, invalid grid, attachment failure, redraw failure, or
  disposal, remove the hidden native view, detach any created terminal
  attachment, remove its bridge socket, release viewer ownership, and retain or
  restore the existing fallback behavior. Do not reveal a partially prepared
  surface.
* Preserve the existing browser websocket scroll frames and backend scroll
  handling byte-for-byte. The two viewers share Scroll bridge behavior at the
  terminal-control boundary, not by rerouting native gestures through the
  browser transport.
* Preserve the pinned libghostty revision, native terminal fallback, durable
  session identity, detach semantics, focus behavior, and live
  ResizeObserver/window frame updates.
* Keep the native host, attachment coordination, and gesture normalization as
  focused concerns. If the attachment module would exceed the repository's
  size and single-purpose constraints, extract the preparation state and
  scroll-normalization logic instead of enlarging one mixed module.
* Use the glossary terms **Durable terminal session**, **Terminal viewer**,
  **Viewer ownership**, **Scroll bridge**, and **Viewer detachment**. The
  existing Scroll bridge ADR is authoritative; no new ADR or schema change is
  required.

## Testing Decisions

A good test observes when a Terminal viewer becomes presentable and what a
wheel gesture does to the Durable terminal session. Tests should assert
visible readiness, exact grid propagation, copy-mode movement, absence of
hosted-command input, fallback preservation, and session survival. They should
not assert React hook state, private queue layout, Objective-C ivar names, tmux
session names, or incidental call counts unrelated to the contract.

* Add the next numbered Studio overhaul acceptance case to the native viewer
  attachment family. Hold native preparation pending and assert that the
  pooled transport is not released and the viewer is not reported ready;
  resolve preparation with the measured non-empty grid and first-redraw result,
  then assert presentation completes. Repeat through the component's detach and
  reattach path to cover tab switch/reopen, and update the overhaul gate count.
* At the same Studio seam, assert the initial attach request carries the
  clipped host frame, later ResizeObserver/window changes use the live frame
  operation, and an invalid-grid or preparation failure keeps the fallback and
  reports the established unavailable state.
* Add native attachment state tests with a controllable host/terminal adapter.
  Prove that a view stays hidden until frame, exact-grid attachment or resize,
  and first redraw have all succeeded; prove those events completing out of
  order cannot reveal it; and prove every failure/disposal path cleans up once.
* Add native host adapter coverage on macOS for first-window backing scale.
  Verify both the libghostty content scale and layer scale use the target
  window before grid measurement, and that a later backing-scale change still
  resizes the surface.
* Add wheel adapter tests for mouse-wheel and precise-trackpad deltas. Verify
  sign-to-direction mapping, browser-equivalent line normalization and bounds,
  horizontal-only suppression, event consumption, and that the libghostty
  mouse-scroll API is never called.
* Add native worker tests proving scroll commands invoke the existing terminal
  attachment scroll control in order and never invoke the input/write control.
  Include a detach/replacement case proving a late callback cannot scroll the
  next viewer.
* Extend the existing isolated tmux integration coverage to exercise scroll
  through the native worker boundary: upward intent enters history, downward
  intent past the bottom exits copy-mode, the position marker stays hidden,
  mouse mode stays off, and the Durable terminal session survives.
* Retain the existing browser viewer acceptance and backend consumer/tmux
  tests unchanged as regression coverage for websocket scroll frames,
  exit-at-bottom behavior, mouse-off selection, and browser fallback.
* Run the native-feature Rust tests on macOS, the affected Studio acceptance
  suite, Studio typecheck, and `npm run test:overhaul --workspace
  @worktracker/studio` before implementation handoff.

## Out of Scope

* Creating implementation tickets, child work items, dependency edges, or an
  execution graph during the Spec stage.
* Enabling tmux mouse mode permanently, temporarily, or under viewer-lease
  control.
* Changing the browser viewer's wheel handler, websocket scroll-frame schema,
  backend consumer, or backend tmux scroll implementation.
* Moving scrollback ownership into libghostty or xterm.js, adding a custom
  scrollbar, or changing durable terminal session persistence.
* Adding horizontal terminal scrolling or mapping horizontal gestures to keys.
* Changing libghostty fonts, colors, padding, cursor behavior, or the pinned
  native dependency revision.
* Removing the browser fallback or changing viewer ownership policy.
* Redesigning tab navigation, terminal focus, agent-run lifecycle, resume, or
  terminal reconciliation.
* Changing general scroll speed beyond matching the browser viewer's existing
  line normalization and bounds.

## Further Notes

* The key presentation invariant is: no native pixels are visible until they
  represent the current pane's real grid and backing scale.
* The key input invariant is: wheel and trackpad gestures express Scroll bridge
  intent and are never bytes written to the hosted command.
* The current 80-by-24 attach result is the defect trigger, not a supported
  fallback size. Empty or unknown geometry must remain in preparation rather
  than becoming visible.
* The Grill handoff is the audit trail for the reporter-confirmed symptoms and
  rejected alternatives. This document is the authoritative implementation
  specification.