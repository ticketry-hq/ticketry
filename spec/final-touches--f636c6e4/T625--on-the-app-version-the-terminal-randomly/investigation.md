# T625 — terminal randomly loses focus (desktop app)

## Symptom

While working in the desktop app the terminal stops taking the keyboard with no
user action. Nothing is shown as selected for that story and nothing responds;
clicking the terminal restores focus. Reported as random — not tied to a tab
switch, a launch, or an app switch.

## Why the shipped change does not explain it

The current working-tree change (`native_terminal_visibility.rs`,
`presentation_commands.rs`, `libghostty_view_bridge.m`) makes a hide record
whether the view held first responder and lets the next reveal give the keyboard
back. That only covers **hide → show cycles the app itself performed**. It
cannot cover:

- first responder being taken by something else while the viewer stays presented
  (the webview is a sibling responder; a DOM `focus()` steals the keyboard and
  leaves no trace on either side),
- a viewer that is detached and re-attached (a fresh `MuxedGhosttyView` is
  created hidden and shown without focus; tmux repaints the same content, so the
  swap is nearly invisible),
- a focus request that was *issued* but rejected — see below.

## Defects found while reading the focus path

These are real regardless of which one produces the reported symptom.

1. **A rejected focus request is spent, never retried.**
   `useNativeViewerHostEffects.ts` marks `handledFocusSignalRef` *before* the
   IPC resolves and drops the result (`void invoke(...)`, no `catch`).
   `native_terminal_focus` returns `Err("hidden native terminal cannot receive
   focus")` whenever the viewer is not presented yet
   (`presentation_commands.rs`). Shows and hides are serialized through a
   promise queue (`nativeViewerPresentation.ts`) while focus requests bypass it,
   so a focus that races a queued reveal is rejected and silently lost — the
   viewer ends up presented but unfocused, and only a click fixes it.

2. **`tabFocused` focuses a session that has not registered a focuser yet.**
   `clientStore.ts` calls `focusTerminal(sessionId)` synchronously after setting
   the active tab, but `useNativeViewerFocusRegistration` only registers while
   the viewer is `visible`. At the instant of selection the newly selected
   session is not yet visible, so the registry lookup finds nothing and the
   request is dropped.

3. **`hideCurrentViewer` hides behind the mount registry's back.**
   `nativeViewerPresentation.ts` invokes `native_terminal_hide` directly without
   `markNativeViewerHidden`, so the React host still believes it is presented
   (`presentedHere === true`) and its layout effect early-returns instead of
   re-showing.

4. **`mountedTaskRunIds` re-renders the workspace on every status frame.**
   `useWorkspaceTerminalSessions.ts` builds a fresh array in the selector
   without `useShallow` (its scratch sibling has it), so every pushed run update
   changes the identity, re-running the effect that calls `restoreLiveSessions`
   and `restoreTerminalTarget`. That is background churn in exactly the
   machinery whose state decides whether the viewer stays presented.

None of these has been confirmed as *the* cause. Confirming one by reasoning
alone is what failed the first time.

## Instrumentation (this change)

Both halves of the story now write to the desktop process stderr, so one log
shows AppKit's first-responder moves next to the app intent that preceded them.

- `native/libghostty_focus_trace.m` — logs every first-responder transition of
  the hosted view, plus who holds the keyboard one runloop later (the thief),
  window key state, app active state, hidden/acceptsInput, and view
  creation/free (so a silent re-attach is visible).
- `src/native_terminal_focus_trace.rs` — same log for the presentation commands
  with run/handle identity, including **rejected** focus requests.
- `internal/focusTrace.ts` — the webview reports why it wants a viewer hidden or
  presented (`active`, `visible`, `modalOpen`, owner, `document.activeElement`)
  and reports focus-request failures instead of swallowing them.

Tracing is inert unless the desktop process is started with
`MUXED_TERMINAL_FOCUS_TRACE=1`; the webview half is development-build only.

### Running it

```bash
MUXED_TERMINAL_FOCUS_TRACE=1 npm run desktop:dev
```

Reproduce the loss, then read the `[focus-trace]` lines around it:

| What the log shows | What it means |
| --- | --- |
| `hide requested` / `command hide` with no user action | the app asked for it — the webview line right before names the state that flipped |
| `resignFirstResponder … (settled) firstResponder=WKWebView…` with no hide | a DOM `focus()` stole the keyboard; the webview line names the element |
| `(settled) firstResponder=<none>` | AppKit dropped the responder (a `makeFirstResponder:` the view refused) |
| `windowKey=0` / `appActive=0` | another window or app took key status |
| `view freed` then `view created` | the viewer was detached and re-attached; focus was never carried over |
| `command focus REJECTED (viewer not presented)` | defect 1 above — the request raced a queued reveal |

Remove the tracing once the cause is fixed.
