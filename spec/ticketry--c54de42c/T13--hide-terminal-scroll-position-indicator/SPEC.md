# CODING-13 — Hide the terminal scroll-position indicator

Status: Refined
Story: WorkTracker #13 (`b8692610-e547-47ae-bc78-3fccd2403883`)
Date: 2026-07-29

## Problem Statement

When a user scrolls through a terminal session's history, tmux copy mode draws
a scroll-position indicator in the top-right corner of the terminal. Ticketry
uses copy mode as an implementation detail of terminal scrollback, so this
tmux-specific chrome is distracting and should not be visible in the Ticketry
terminal.

## Solution

Ticketry will continue to use tmux copy mode for durable terminal scrollback,
but it will enter copy mode with the position indicator hidden. This behavior
will be consistent in the browser renderer fallback and the native libghostty
renderer. All existing scrolling, selection, session durability, and
return-to-live-prompt behavior will remain unchanged.

## User Stories

1. As a Ticketry user, I want to scroll through terminal history without a
   position marker appearing, so that the terminal remains visually clean.
2. As a Ticketry user, I want the marker hidden in both supported terminal
   renderers, so that switching renderer does not change the experience.
3. As a Ticketry user, I want upward scrolling to continue entering terminal
   history, so that hiding the marker does not remove scrollback.
4. As a Ticketry user, I want downward scrolling past the bottom to return to
   the live prompt, so that the terminal remains easy to resume using.
5. As a Ticketry user, I want click-drag text selection to continue working, so
   that the visual cleanup does not enable tmux mouse capture.
6. As a Ticketry user, I want scrolling to preserve the underlying agent
   session, so that reviewing history cannot terminate ongoing work.
7. As a trackpad user, I want the marker hidden for precise scrolling, so that
   input-device choice does not affect terminal chrome.
8. As a mouse-wheel user, I want the marker hidden for line scrolling, so that
   the behavior is consistent across input devices.

## Implementation Decisions

- Keep tmux as the owner of durable terminal scrollback and preserve the
  existing viewer fallback.
- Hide only tmux's copy-mode position indicator; do not replace copy mode or
  add application-owned scroll UI.
- Apply the same copy-mode entry behavior at both terminal viewer adapters.
- Preserve exit-on-bottom semantics, bounded scroll counts, mouse mode being
  off, viewer detach behavior, and session durability.
- Do not change the webview/native boundary, wire protocol, generated SDKs, or
  terminal-session persistence.

## Testing Decisions

- Use the existing isolated tmux integration seams for the browser-side tmux
  client and the Rust native viewer.
- Verify observable behavior: scrolling enters history while the position
  indicator is hidden, downward scrolling returns to the live prompt, mouse
  mode remains off, and the durable session survives.
- Prefer extending the current scrollback tests rather than introducing a new
  mock-only seam.
- Keep existing transport and renderer tests unchanged unless the public
  behavior they assert needs additional coverage.

## Out of Scope

- Replacing tmux copy mode with renderer-owned scrollback.
- Adding a custom scrollbar or scroll-position display.
- Changing scroll speed, direction, line clamping, or trackpad normalization.
- Changing terminal colors, copy-mode styles, selection behavior, or tmux
  status-line configuration.
- Migrating or terminating existing durable terminal sessions.

## Further Notes

The unwanted top-right element is tmux's copy-mode position indicator, not a
React overlay or a libghostty scrollbar. The change is intentionally limited
to how Ticketry enters copy mode.
