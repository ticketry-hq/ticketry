# Grill handoff — T396 Native libghostty viewer: wrong first-attach dimensions, wheel scroll sends arrow keys

**Status:** COMPLETE (2026-08-10). All Ideas-triage decisions below are
resolved. This file is the audit trail of the interview; the Spec stage
produces the authoritative spec.

***

## 1. Symptoms, pinned down (were "wrong dimensions" / "scroll is wrong")

### S1 — First attach renders at the wrong size; a window resize snaps it right

Confirmed by the reporter: the wrong-size rendering is **transient** — resizing
the Ticketry window (or anything that forces a redraw) corrects it. This rules
out a permanent Retina content-scale defect and pins the cause to the
first-attach sequence.

**Mechanism (grounded in code):**

* `native_terminal_attach` attaches the tmux client PTY at a hard-coded
  80×24 (`studio/src-tauri/src/native_terminal.rs:44-45,200`). tmux redraws
  the whole session for that grid immediately.
* The correct grid only lands after the frontend's first
  `native_terminal_set_frame` round-trip
  (`studio/src/features/agents/terminal/NativeGhosttyTerminal.tsx:226`,
  `native_terminal.rs:352` → `WorkerCommand::Resize`). Until then the user
  sees the 80×24 layout stretched into the pane.
* Secondary suspect to verify during implementation: the ghostty surface's
  content scale is taken from `NSScreen.mainScreen` at creation
  (`studio/src-tauri/native/libghostty_host.m:120`) and the layer's
  `contentsScale` is only corrected in `viewDidChangeBackingProperties`
  (`libghostty_host.m:158`), which may not fire on first attach.

### S2 — Wheel/trackpad scroll sends up/down arrow keys to the hosted command

Confirmed by the reporter: scrolling in the native viewer emits arrow keys
(disruptive inside TUIs such as codex), instead of moving the durable
session's scrollback.

**Mechanism (grounded in code):**

* The native viewer's ghostty surface is a full terminal emulator with its own
  PTY; its command is a bridge process (`ticketry --muxed-ghostty-bridge`,
  `studio/src-tauri/src/main.rs:90`) piping bytes to the tmux-attach PTY.
* `scrollWheel:` forwards raw deltas to `ghostty_surface_mouse_scroll`
  (`libghostty_host.m:242`). With tmux's alternate screen active and no mouse
  reporting, ghostty's standard fallback translates the wheel into arrow keys.
* The browser viewer never has this problem: xterm.js wheel events are sent as
  websocket `scroll` frames which the backend turns into tmux
  `copy-mode -e -H` scrolling (#578,
  `backend/apps/terminals/tmux/client.py:35`).
* The identical control **already exists unused on the native side**:
  `TerminalAttachmentControl::scroll`
  (`studio/src-tauri/src/terminal_runtime.rs:133`). Nothing calls it.

## 2. Decisions confirmed this session

### D1 — Wheel scroll routes through the scroll bridge; tmux mouse mode stays off, same config for both viewers

The native view intercepts `scrollWheel:` and drives the existing tmux
copy-mode scroll control instead of handing the event to ghostty. Semantics
are identical to the browser viewer: per-line scrolling, copy-mode entered
with exit-at-bottom (`-e`), no position marker (`-H`), mouse reporting off.

**Why.** `set -g mouse on` was considered and rejected: mouse mode is
per-session and both viewers attach the same session, so it would also capture
the mouse in the browser viewer and undo #578's protected click-drag text
selection. "Mouse mode only while a native viewer holds the lease" was
rejected as lease-coupled config state that can leak. The reporter's explicit
requirement: **one mechanism, one config, both viewers.**

Recorded as ADR
`backend/apps/terminals/docs/adr/0001-viewers-scroll-the-session-through-the-scroll-bridge.md`.

### D2 — First attach must never show a wrong-size redraw

Acceptance: the user never sees the 80×24 (or any pre-layout) rendering. The
native surface is revealed only after the tmux client has been resized to the
real grid and tmux has redrawn — the pooled xterm view (or blank host) stays
up until then. The same rule applies to tab switching and reopen, which
re-run the attach sequence.

The alternatives — "brief flash that self-corrects" and "attach at a measured
size estimate" — were declined; measuring is impossible before the surface
exists because the grid depends on ghostty font metrics.

### D3 — Retina content scale verified as part of the fix

Implementation must verify (and fix if wrong) that the surface's content
scale and layer `contentsScale` are correct at first attach, not only after
`viewDidChangeBackingProperties`. Not user-visible acceptance on its own —
covered by D2's "never show wrong size".

## 3. Acceptance criteria for the Spec stage

1. First attach of a native viewer shows the terminal at the correct grid for
   its pane; no transient 80×24 layout at any point. Same on tab switch and
   reopen.
2. Window resize continues to live-resize the surface and the tmux client
   (existing ResizeObserver path unchanged).
3. Wheel/trackpad scroll in the native viewer moves the durable session's
   scrollback via tmux copy-mode: scroll up enters copy-mode, scroll down past
   the bottom exits it, and the hosted command receives **no** synthesized
   arrow keys.
4. The browser viewer's behavior is byte-for-byte unchanged: same tmux
   config, mouse mode off, #578 selection behavior intact.

## 4. Out of scope

* tmux mouse mode in any form.
* Changes to the websocket viewer's scroll frames or backend scroll handling.
* Scrollback ownership changes — tmux remains the durable scrollback owner.