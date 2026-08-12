# Viewers scroll the session through the scroll bridge, never tmux mouse mode

Every terminal viewer — browser xterm.js and the native libghostty renderer
alike — moves a durable terminal session's scrollback by driving tmux
copy-mode (`copy-mode -e -H` plus line scrolls, #578). tmux `mouse` mode stays
off for all run sessions, and viewers must not let their renderer synthesize
input keys (arrow keys, PageUp/PageDown) from wheel gestures.

## Considered options

- **tmux `mouse on`** — rejected: mouse mode is per-session and both viewer
  kinds attach the same session, so enabling it for the native viewer would
  also make tmux capture click-drag in the browser viewer, undoing #578's
  protected text selection.
- **Mouse mode toggled while a native viewer holds the viewer lease** —
  rejected: lease-coupled session config that can leak to the other viewer on
  crash or race.
- **Renderer-synthesized keys (ghostty's alternate-screen arrow fallback, or
  PageUp/PageDown)** — rejected: the hosted command receives input the user
  never typed, which corrupts interaction with TUIs.

## Consequences

The native renderer must intercept wheel events before its terminal emulator
consumes them and route them to the same scroll control the websocket path
uses (T396). One scrolling behavior, one tmux configuration, for every viewer.
