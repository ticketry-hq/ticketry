# CODING-13 — Proposed Implementation subtasks

Draft breakdown pending user approval and publication to WorkTracker as
Implementation subtasks of Story #13 (`b8692610-e547-47ae-bc78-3fccd2403883`).

## Discovery findings that shape these tickets

- The tmux capability is `copy-mode -H` ("hides the position indicator in the
  top right", `man tmux`). Verified accepted on the development machine's
  tmux 3.6b: `copy-mode -e -H -t <session>` succeeds and scrollback,
  `pane_in_mode`, and `scroll_position` all behave exactly as with `-e` alone.
- There are exactly two copy-mode entry points in the codebase, both issuing
  `copy-mode -e`:
  - `backend/apps/terminals/tmux/client.py` (`scroll`)
  - `studio/src-tauri/src/tmux_viewer.rs` (`scroll_tmux`)
- **tmux exposes no queryable format for the hidden-indicator state.** A probe
  of `display-message -a` in a session entered with `-H` shows only
  `pane_in_mode`, `pane_mode`, and `scroll_position`; there is no
  `copy_mode_position_hidden`-style variable, and the indicator is overlay
  chrome so it does not appear in `capture-pane` output either. The HLD's
  "demonstrate the marker is suppressed" therefore has to be asserted at the
  issued-argv level, not by querying tmux state. Behavioural assertions
  (history scrolls, exit-at-bottom, mouse off, session survives) stay as-is.
- `-H` is a version-gated flag. The repository documents no minimum tmux
  version — `docs/desktop-executable-policy.md` only tells users to
  `brew install tmux`. On a tmux too old for `-H`, `copy-mode` would fail
  outright and scrolling would break, which is worse than the indicator being
  visible. This is the one part of the change carrying real design content.

---

## 1 — Hide the position indicator on the browser terminal path

**Blocked by:** None — can start immediately.

**What it delivers:** Scrolling a terminal in the browser/xterm renderer enters
tmux history with no scroll-position marker drawn in the top-right corner.
Upward scrolling still enters history, downward scrolling past the bottom still
returns to the live prompt, click-drag selection still works because tmux mouse
mode stays off, and the durable session is untouched.

**Acceptance criteria**

- [ ] `scroll` in `backend/apps/terminals/tmux/client.py` enters copy mode with
      the position indicator hidden, keeping exit-on-bottom semantics.
- [ ] The existing scrollback test in
      `backend/apps/terminals/tests/test_tmux.py` is extended to assert the
      copy-mode entry hides the indicator, and continues to assert that
      history scrolls, a bottom-ward scroll leaves copy mode, tmux `mouse`
      remains `off`, and the session row survives.
- [ ] No new mock-only seam is introduced; the assertion runs against the
      existing isolated tmux server.
- [ ] The scroll direction validation and line clamping are unchanged.

## 2 — Hide the position indicator on the native desktop terminal path

**Blocked by:** None — can start immediately.

**What it delivers:** The same clean scrollback in the desktop application's
native libghostty viewer, so switching renderer does not change what the user
sees.

**Acceptance criteria**

- [ ] `scroll_tmux` in `studio/src-tauri/src/tmux_viewer.rs` enters copy mode
      with the position indicator hidden, keeping exit-on-bottom semantics.
- [ ] The existing scrollback test in `studio/src-tauri/tests/tmux_viewer.rs`
      is extended to assert the copy-mode entry hides the indicator, and
      continues to assert that `pane_in_mode` and `scroll_position` advance,
      a large downward scroll returns to the live prompt, the `mouse` option
      remains `off`, and the session survives viewer detachment.
- [ ] The bounded tmux control surface is preserved — no command, executable,
      socket, or session target leaks to callers.
- [ ] The invalid-scroll-line guard is unchanged.

## 3 — Keep scrolling working on tmux builds without the hide flag

**Blocked by:** 1 and 2.

**What it delivers:** A user on an older tmux still gets working terminal
scrollback. Hiding the indicator degrades gracefully instead of breaking the
feature, and the supported tmux floor is stated somewhere a user can find it.

**Acceptance criteria**

- [ ] The minimum tmux version that accepts the hide flag is confirmed and
      recorded.
- [ ] On a tmux that rejects the flag, scrolling still enters history and still
      returns to the live prompt — the indicator is simply visible.
- [ ] Both terminal paths share the same degradation behaviour.
- [ ] The tmux version expectation is documented alongside the existing
      executable policy guidance.
- [ ] No change is made to any user's global tmux configuration or to the
      session status-line setup.

## Deliberately not sliced further

The two renderer changes are each a single copy-mode entry plus a test
extension. They are separate tickets only because they live in different
languages with different test harnesses and are independently verifiable; there
is no prefactor worth doing first, and no wide refactor here.
