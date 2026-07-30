# CODING-13 — High-level design

## Change

Both terminal presentation paths ultimately translate wheel input into a tmux
`copy-mode` command:

- The browser/xterm path delegates to the Python terminal service.
- The desktop native path delegates to the Rust tmux viewer.

At both boundaries, enter copy mode using tmux's supported option for hiding
the top-right position indicator while retaining exit-on-bottom behavior. Do
not alter the shared scroll frame, the React wheel bridge, libghostty input
forwarding, or terminal-session ownership.

## Relevant files

- `backend/apps/terminals/tmux/client.py` — browser fallback copy-mode entry.
- `backend/apps/terminals/tests/test_tmux.py` — existing browser-side tmux
  scroll integration coverage.
- `studio/src-tauri/src/tmux_viewer.rs` — native viewer copy-mode entry and
  bounded tmux control surface.
- `studio/src-tauri/tests/tmux_viewer.rs` — existing native viewer scrollback
  and session-durability integration coverage.

Reference-only context:

- `studio/src/features/agents/terminal/internal/useTerminalPresentation.ts`
  translates browser wheel events into scroll intents.
- `studio/src-tauri/native/libghostty_host.m` forwards native wheel events to
  libghostty.

## Verification seam

Extend the two existing isolated tmux scrollback integration tests. Each path
should demonstrate that history still scrolls, the copy-mode position marker
is suppressed, scrolling to the bottom exits copy mode, mouse mode remains
off, and the durable session survives viewer detachment.

## Compatibility

Use the tmux command capability already responsible for the position
indicator. If the chosen flag is version-dependent, make its compatibility
with Ticketry's accepted tmux versions explicit in the implementation rather
than mutating users' global tmux configuration.
