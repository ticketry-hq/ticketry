# CODING-705 — Recover native terminal rendering with backoff reloads

Status: Spec complete
Story: WorkTracker #705 (`fae737de-1855-4529-aeb4-777ab1912efa`)
Date: 2026-08-16

## Problem Statement

Ticketry's desktop terminal prefers a native libghostty viewer and retains the
compatibility renderer as its fallback. When native attachment, preparation,
presentation, live frame synchronization, viewer-lease renewal, or the native
attachment process fails, the current WebView records that failure for the
durable terminal session and keeps the compatibility renderer in place. The
failure is intentionally sticky for the lifetime of that WebView, so remounting
the terminal or navigating away and back cannot try the native viewer again.

That fallback keeps the terminal usable, but it also leaves a transient native
renderer failure in place indefinitely. The user must discover that a full
refresh is the recovery action and perform it manually. An immediate automatic
reload would be equally unsafe: a persistent native failure could put Studio in
a tight reload loop, repeatedly disrupting the user, recreating viewers, and
consuming local resources without giving the failing condition time to clear.

## Solution

When a live terminal in the desktop application reports through the existing
native-viewer failure contract, Ticketry continues to show the compatibility
renderer and schedules one full Studio refresh. Refresh attempts form one
window-scoped recovery campaign. The first refresh waits 500 milliseconds;
subsequent failures after reload wait 1, 2, 4, and 8 seconds, then remain capped
at 10 seconds. The campaign has no attempt limit: Ticketry keeps trying at the
capped interval until a native viewer is successfully presented with a
non-empty grid.

The attempt count survives WebView reloads in session-scoped browser storage so
the delay actually grows across refreshes, but it does not survive closing and
reopening the desktop window. Only one refresh timer may exist for the window,
even if several retained viewers or React hosts report the same failure. A
successful visible native presentation cancels a pending refresh and clears the
campaign before reporting recovery, so a later unrelated failure starts again
at the initial delay.

This is a WebView recovery policy, not a terminal-runtime restart. Reload uses
the existing page lifecycle to detach temporary viewers and release their
leases; durable terminal sessions and their hosted commands remain alive under
tmux and are restored through the existing terminal-tab/session flow. Native
capability absence, browser mode, ordinary viewer hiding, terminal completion,
and sidecar service recovery do not start this campaign.

## User Stories

1. As a Ticketry desktop user, I want a transient native terminal rendering
   failure to recover automatically, so that I do not have to know that a full
   refresh can recreate the viewer.
2. As a Ticketry desktop user, I want the compatibility renderer to remain
   usable while a refresh is pending, so that a native failure does not leave a
   blank terminal.
3. As a Ticketry desktop user, I want the first recovery attempt to happen
   promptly, so that short-lived native failures clear with little disruption.
4. As a Ticketry desktop user, I want repeated refreshes to slow down
   exponentially, so that a persistent failure does not trap the application in
   a rapid reload loop.
5. As a Ticketry desktop user, I want the retry delay capped, so that a long
   failure does not make eventual recovery arbitrarily slow.
6. As a Ticketry desktop user, I want recovery attempts to continue until a
   native terminal renders, so that the application does not silently give up
   and leave a transient fallback permanent.
7. As a Ticketry desktop user, I want one native success to stop the recovery
   campaign immediately, so that a scheduled reload cannot destroy a terminal
   that has already recovered.
8. As a Ticketry desktop user, I want a later unrelated native failure to begin
   with the short initial delay, so that old recovery history does not penalize
   a new incident.
9. As a Ticketry desktop user, I want my durable terminal session and hosted
   command to survive each refresh, so that rendering recovery does not restart
   or terminate my work.
10. As a Ticketry desktop user, I want restored terminal tabs to reconnect to
    their existing durable sessions after refresh, so that the recovered Studio
    returns me to the same work.
11. As a Ticketry desktop user, I want multiple native failure notifications to
    cause only one refresh, so that retained viewers and multiple workspace
    hosts cannot create competing timers.
12. As a Ticketry desktop user, I want failures reported during attachment,
    presentation, resize, lease renewal, or native process loss to receive the
    same recovery behavior, so that recovery does not depend on which internal
    native operation failed.
13. As a Ticketry desktop user, I want normal terminal completion or loss to
    retain its existing terminal outcome behavior, so that an ended command is
    not mistaken for a renderer that should be recovered forever.
14. As a Ticketry desktop user, I want normal navigation that hides a retained
    viewer to remain reload-free, so that moving among Work items, documents,
    and terminal tabs is not treated as a failure.
15. As a Ticketry desktop user, I want a machine where native Ghostty is not
    available to use the established compatibility renderer without a reload
    loop, so that capability detection remains authoritative.
16. As a browser-development user, I want xterm behavior to remain unchanged,
    so that a desktop-native recovery policy does not affect the browser
    runtime.
17. As a Ticketry desktop user, I want closing and reopening the window to
    begin with a fresh recovery campaign, so that stale incident history is not
    carried into a later application session.
18. As a maintainer, I want native-render recovery keyed to the existing
    failure and successful-presentation contracts, so that every failure source
    does not implement its own reload policy.
19. As a maintainer, I want backoff state to be explicit and versioned, so that
    malformed or obsolete session data safely resets to the first delay.
20. As a maintainer, I want recovery verified through mounted terminal behavior,
    so that tests protect fallback, refresh, and native success rather than
    private React state.

## Implementation Decisions

* Treat this as a Studio terminal-presentation capability. Keep the native
  bridge, durable terminal runtime, backend terminal APIs, run records, and tmux
  ownership unchanged.
* Use the terminal feature's existing native-viewer unavailability signal as
  the single failure input. It already normalizes initial attachment and
  preparation errors, empty-grid results, native process failure/completion,
  presentation and frame-update failures, and viewer-lease renewal failures.
  Do not add independent reload calls at each failure source.
* Start recovery only for a live durable terminal session in the desktop
  runtime after native capability detection succeeded. Native capability
  detection returning false is a supported fallback posture, not a render
  failure. Browser mode never participates.
* Keep the compatibility renderer and the existing native-failure notice
  mounted during the delay. Scheduling recovery must not blank the terminal or
  suppress the actionable failure reason before reload begins.
* Introduce one window-scoped native-render recovery coordinator owned by the
  terminal feature. All mounted terminal surfaces report failure and success to
  that coordinator. It owns the sole timer and prevents duplicate scheduling
  across retained viewers, foreground owners, StrictMode effects, and repeated
  callbacks.
* Define the backoff sequence as `min(10_000 ms, 500 ms × 2^attempt)`, where the
  first failure uses attempt zero. This produces 500 ms, 1 s, 2 s, 4 s, 8 s,
  and then 10 s for every later failure. Do not add jitter: there is only one
  campaign per local desktop window, and deterministic delays keep the recovery
  behavior understandable and testable.
* Do not impose a maximum attempt count. Once the cap is reached, a concrete
  native render failure after each reload schedules the next reload after 10
  seconds until recovery succeeds or the user closes the window.
* Persist only the recovery campaign's schema version and next attempt number
  in session-scoped browser storage. Write the incremented attempt before
  issuing reload so the next WebView observes the grown delay. Treat missing,
  malformed, negative, non-integral, or unknown-version data as a new campaign.
* Keep recovery state window-local. Do not use durable application settings or
  backend persistence, and do not carry the counter across a new desktop-window
  session or application restart.
* A repeated failure while a refresh is already scheduled may update diagnostic
  logging, but it must neither increment the attempt again nor replace the
  existing timer. One actual reload consumes one attempt.
* Define recovery success narrowly as a visible native viewer whose
  presentation has committed and whose resolved grid has positive columns and
  rows. Acquiring a handle for a hidden retained viewer, detecting native
  capability, beginning attachment, or mounting a host is not success.
* On recovery success, cancel any pending refresh, remove the persisted
  campaign, and make the operation idempotent. If success wins a race with an
  expiring timer, the reload callback must re-check that its campaign is still
  current before reloading.
* Use the existing full-page reload operation already established by Studio's
  service-health recovery. Do not invent a native command that restarts
  libghostty in place and do not restart the desktop sidecars.
* Preserve current pagehide/beforeunload cleanup. Each reload must detach
  temporary native viewers, stop their listeners and renewal timers, and
  release viewer leases once, while leaving the durable terminal session and
  hosted command untouched.
* Preserve current terminal restoration and foreground-ownership rules after
  reload. Recovery must not create a second viewer for a run, focus a hidden
  terminal, change the selected Work item, or alter which terminal surface owns
  presentation.
* Do not schedule native recovery for normal terminal outcomes, explicit tab
  dismissal, ordinary hide/show transitions, a modal covering a viewer, a host
  with no currently visible frame before attachment, compatibility-renderer
  transport errors, or service-health transitions unless those conditions also
  produce the established native-viewer failure for a live session.
* Log the failure reason, attempt number, chosen delay, cancellation on native
  success, and reload execution through the existing frontend logging path.
  Never log terminal output, prompts, credentials, or persisted storage
  contents beyond the numeric recovery metadata.
* Keep files single-purpose. The recovery coordinator owns cross-reload policy;
  the terminal presenter translates native failure and successful presentation
  into coordinator events; the native lifecycle continues to own attachment
  and teardown only.
* No database migration, API or SDK contract, backend service, native C/Rust
  command, or architectural decision record is required. This policy fits the
  existing division between durable terminal sessions, temporary terminal
  viewers, and Studio presentation.

## Testing Decisions

A good test observes whether the desktop user sees a usable fallback, whether
exactly one refresh is requested after the correct delay, and whether a real
native presentation ends the campaign. Tests should control time and the
reload boundary without inspecting component-local state, hook ordering, or
the coordinator's internal collection shape.

* Make the mounted desktop `Terminal` acceptance surface the primary seam. It
  is the highest existing seam that includes native capability selection,
  viewer failure, compatibility fallback, presentation success, and the
  user-visible terminal result.
* Add one numbered overhaul acceptance case for this behavior and advance the
  overhaul gate. Drive a native attachment failure, assert that the
  compatibility renderer and native-failure notice remain visible, advance the
  initial delay, and assert one full refresh request.
* In the same mounted seam, deliver repeated failure notifications and mount
  competing/retained hosts before the timer expires. Assert they still produce
  one timer, one attempt increment, and one reload.
* Cover a successful visible native presentation before the timer expires.
  Assert the timer is cancelled, campaign state is cleared, and advancing time
  does not reload.
* Cover success after at least one simulated reload and assert that the next
  independent failure uses the 500-millisecond delay rather than the prior
  campaign's grown delay.
* Test the recovery coordinator at its public policy seam for the cross-document
  sequence that a single mounted React tree cannot represent faithfully. Reuse
  session storage across fresh coordinator instances and assert delays of 500
  milliseconds, 1, 2, 4, and 8 seconds, followed by a stable 10-second cap with
  no terminal attempt limit.
* At that policy seam, cover malformed and unknown-version stored state,
  duplicate failure reports, success-versus-timer races, idempotent
  cancellation, and a failed/stubbed reload callback. Assert corrupt state
  safely returns to the initial attempt and no callback can reload after its
  campaign was cleared.
* Prove that native capability absence, browser rendering, inactive/hidden
  retained viewers, normal session completion, tab dismissal, and ordinary
  visibility transitions do not schedule a refresh.
* Preserve the existing focused acceptance coverage for native attachment
  serialization, failure teardown, lease failure, process completion, frame
  failure, presentation, retention, ownership, focus restoration, preparation,
  and safe-area geometry. Their established callbacks are prior art for the
  failure/success contract used here.
* Preserve the service-health reload tests. Native-render recovery may reuse
  the reload operation, but it must not change supervised-sidecar recovery,
  retry, or failure-screen semantics.
* Verify page lifecycle cleanup still detaches and releases exactly once when
  the scheduled reload runs, while terminal restoration continues to target
  the same durable run afterward.
* Run `npm run test:overhaul --workspace @worktracker/studio` before
  implementation handoff, plus the affected Studio unit tests and Studio
  typecheck. No backend or native Rust suite is required unless implementation
  expands beyond this specification's frontend-only boundary.

## Out of Scope

* Creating Implementation tickets, child work items, blocker edges, or a
  dependency graph during the Spec stage.
* Restarting the backend, MCP sidecar, Tauri application, desktop process,
  durable terminal session, tmux server, hosted command, or agent run.
* Replacing the full WebView refresh with an in-place native-renderer reset or
  adding a new native command.
* Removing the compatibility renderer or changing browser xterm reconnect and
  backoff behavior.
* Retrying when native Ghostty is unsupported or unavailable according to
  capability detection.
* Treating normal hosted-command exit, missing terminal session, explicit tab
  closure, navigation-driven hiding, or service recovery as native render
  failure.
* Adding a user preference, retry button, countdown control, notification
  center entry, or manual give-up action for native rendering recovery.
* Adding a maximum retry count, a persistent give-up state, or a durable retry
  counter that survives closing the desktop window.
* Changing terminal viewer leases, foreground ownership, focus rules, retained
  viewer lifetime, terminal-tab restoration, or output-activity semantics.
* Changing terminal APIs, run lifecycle, WorkTracker data, SDKs, database
  schema, or the native libghostty revision.
* Recovering from failures before Studio can execute JavaScript, WebView
  crashes, desktop-process crashes, operating-system termination, or power
  loss.

## Further Notes

* **Native render recovery campaign** means the window-local sequence beginning
  with a concrete native-viewer failure and ending only when a visible native
  viewer presents a non-empty grid or the window session ends.
* **Refresh** means reloading the Studio WebView. It does not mean restarting a
  durable terminal session, hosted command, sidecar, or desktop process.
* **Native render success** is presentation evidence, not capability or
  attachment evidence. This distinction prevents a hidden retained viewer from
  cancelling recovery before the user has a working native terminal.
* The central invariant is: one window has at most one pending recovery reload,
  every executed reload advances one bounded exponential attempt, and a real
  native presentation clears the campaign before any later reload can fire.
* The agreed testing boundary is the mounted desktop terminal acceptance seam,
  supplemented only by the recovery coordinator's public policy seam for state
  that must survive destruction of the WebView document.
