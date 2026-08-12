# CODING-505 — Keep native Ghostty terminals mounted across navigation

Status: Spec complete
Story: WorkTracker #505 (`41991583-e9ed-49ea-be69-4983a639a641`)
Date: 2026-08-11

## Problem Statement

Ticketry keeps durable agent sessions and terminal-tab state when a user moves
between Work items, but the desktop's native Ghostty viewer exists only while
its terminal is the visible Task workspace surface. Selecting another Work
item, another terminal, or Details removes the native viewer. That removal
detaches the local tmux client, releases viewer ownership, and makes a later
return repeat native preparation and attachment.

The agent has continued running throughout that navigation, so the detach and
reattach cycle provides no durability benefit. It adds avoidable delay and
visual churn precisely when the user is moving among active agents. Native
Ghostty viewers are sufficiently lightweight to retain for every open terminal
tab, and keeping those local viewers attached does not add agent workload.

## Solution

Treat a successfully attached native Ghostty viewer as the durable desktop
presentation for its open terminal tab. Navigation changes its visibility and
frame ownership; it does not end the native attachment.

Once a terminal has acquired a native viewer, Ticketry keeps that viewer, its
direct tmux attachment, and its viewer lease alive while the terminal tab
remains open. Only the active terminal is visible, positioned over its current
Task workspace host, and eligible for focus or input. Other retained viewers
are hidden native views: they remain attached but cannot cover the WebView,
receive focus, or intercept pointer and scroll input.

Returning to a retained terminal first applies the active host's current,
clipped frame and confirms a valid grid, then reveals and focuses the existing
viewer. It does not create another native surface, tmux attachment, or viewer
lease. Explicit terminal dismissal, terminal completion or loss, native
failure, window reload/closure, and application shutdown remain real teardown
boundaries. The browser compatibility renderer keeps its existing pooling and
fallback behavior.

## User Stories

1. As a Ticketry user, I want a native terminal to remain attached when I
   select another Work item, so that returning to its agent is immediate.
2. As a Ticketry user, I want the same native terminal to return with its
   existing screen contents and scroll position, so that navigation does not
   feel like reopening a viewer.
3. As a Ticketry user, I want selecting Details or a design document to hide
   the terminal without detaching it, so that reading ticket context does not
   interrupt the native viewer.
4. As a Ticketry user, I want switching among terminal tabs to retain every
   open native viewer, so that moving between multiple agents on one Work item
   does not repeatedly prepare them.
5. As a Ticketry user, I want terminals on different Work items to remain
   independently retained, so that ticket-to-ticket navigation does not make
   the viewers replace one another.
6. As a Ticketry user, I want exactly one retained terminal to be visible in a
   Task workspace at a time, so that inactive native views never cover Details,
   documents, or another terminal.
7. As a Ticketry user, I want hidden native terminals unable to take keyboard,
   pointer, or scroll input, so that input always reaches the surface I can
   see.
8. As a Ticketry user, I want a retained terminal resized to the current pane
   before it is revealed, so that returning after a pane, window, or fullscreen
   change never shows a stale or clipped grid.
9. As a Ticketry user, I want the returned native terminal focused only when
   the Task workspace's navigation rules request terminal focus, so that viewer
   persistence does not bypass Navigation mode or Terminal typing mode.
10. As a Ticketry user, I want a terminal reclaimed by another foreground
    surface to remain a single viewer, so that Studio and the issue drawer
    cannot attach competing native clients to one run.
11. As a Ticketry user, I want closing a terminal tab to release its retained
    native viewer, so that explicit dismissal remains an actual cleanup action.
12. As a Ticketry user, I want a completed or lost terminal to release native
    resources and retain the existing terminal-history behavior, so that dead
    viewers do not accumulate.
13. As a Ticketry user, I want native attachment or visibility failures to use
    the compatibility renderer with a useful reason, so that persistence never
    leaves an unusable blank terminal.
14. As a Ticketry user, I want application reload, window closure, and shutdown
    to detach every retained native viewer, so that no local attachment process
    or native view leaks beyond the owning desktop window.
15. As a browser user, I want terminal switching and pooling to behave as it
    does today, so that a desktop-only optimization does not change the browser
    product.
16. As a maintainer, I want retained viewers keyed by durable run identity, so
    that temporary-to-ready session rekeying cannot create duplicate Ghostty
    attachments.
17. As a maintainer, I want user-visible navigation persistence covered at the
    mounted Studio acceptance seam, so that tests protect the experience rather
    than a particular React component arrangement.

## Implementation Decisions

* Keep native viewer lifetime separate from active Task workspace
  presentation. A native viewer that has attached successfully belongs to its
  open terminal tab and durable agent-run identity, not to the currently
  selected Work item or active tab body.
* Retain only viewers that have actually been opened and attached in the
  current desktop window. Do not eagerly create native viewers for every run
  returned by terminal discovery, resumable history, another project, or an
  unopened terminal tab.
* Keep one app-level native-viewer pool in the terminal feature, keyed by the
  durable agent-run identity. The pool owns the native handle, viewer lease,
  attachment listeners, last valid frame, and presentation state. React hosts
  request presentation from that pool instead of owning attachment lifetime.
* Preserve the one-viewer-per-run invariant. A change of selected Work item,
  active terminal tab, Details/document surface, focused pane, or foreground
  owner must never create a second native attachment for a retained run.
* Add an explicit native visibility operation across the existing narrow
  Tauri/libghostty boundary. Hiding sets the hosted Ghostty view non-visible
  without freeing it, stopping its tmux client, releasing its lease, or
  discarding its terminal state. Showing reverses that visibility only after
  the current frame has been accepted.
* A hidden native viewer must be non-interactive. It may continue its local
  rendering/session work, but it cannot become first responder or accept mouse,
  trackpad, or scroll gestures while hidden.
* On deactivation, hide the viewer before exposing the newly selected WebView
  content or another native viewer. Do not send native detach and do not release
  the viewer lease merely because the terminal is inactive.
* On activation, measure the current visible host, apply its clipped frame,
  require a non-empty Ghostty grid, then show the retained view. This ordering
  prevents a stale native frame from flashing over a different ticket or pane.
* Continue observing resize, scroll, and fullscreen geometry only for the
  actively presented host. A hidden viewer may keep its last valid grid until
  it is activated and remeasured; inactivity must not resize tmux to a zero or
  off-screen frame.
* Route focus through the existing controlled focus and foreground-ownership
  contracts. Showing a retained view is not, by itself, permission to focus it.
  Navigation mode, Terminal typing mode, pointer engagement, live-terminal
  cycling, and issue-drawer reclamation retain their current authority.
* Keep the current native preparation and compatibility handoff for a run's
  first attachment. Persistence begins only after native preparation, exact
  grid validation, first redraw, and viewer-lease acquisition succeed.
* Preserve the compatibility renderer while native preparation is pending and
  whenever native attachment, resize, hide, show, lease renewal, or attachment
  process health fails. A failed retained native viewer is torn down once and
  that session uses the established fallback rather than retrying on every
  navigation.
* Tear down a retained viewer when its terminal tab is explicitly closed, its
  run or attachment becomes terminal/lost, foreground ownership is deliberately
  released without another host, the native renderer fails, the owning WebView
  reloads, the window closes, or the application shuts down. Teardown remains
  idempotent and releases the native view, local attachment process, listeners,
  timers, pool entry, and viewer lease.
* Do not add an idle timeout, least-recently-used eviction policy, or retained-
  viewer count limit in this release. The agreed policy is that every open,
  previously attached native terminal may remain mounted until a real teardown
  boundary occurs.
* Keep browser xterm pooling, durable tmux ownership, backend terminal
  discovery, run lifecycle, terminal-tab restoration, and agent execution
  unchanged. This feature changes only desktop viewer retention and
  presentation.
* Keep files single-purpose. Separate pool/lifetime management from React host
  selection and from native hide/show commands rather than enlarging the
  existing terminal presenter or native attachment modules with another
  concern.
* No database, WorkTracker model, terminal API schema, or ADR is required. The
  ownership decision stays within the existing terminal presentation
  architecture and preserves tmux as the durable session owner.

## Testing Decisions

A good test observes attachment lifetime and visible behavior through the
highest practical seam: mounted Task workspaces for user navigation, the
terminal presentation contract for pool behavior, and the Tauri command seam
for native visibility and cleanup. Tests must not assert component-local state,
private hook ordering, or implementation-specific collection shapes.

* Update the numbered Studio terminal acceptance coverage that currently
  expects Details to detach the native surface. Assert instead that selecting
  Details or a document hides the viewer and returning to its terminal shows
  the same retained viewer without another attach or lease acquisition.
* Add a mounted Studio acceptance case with live terminals on two Work items.
  Navigate from the first terminal to the second and back. Assert one attach
  per durable run, only the selected terminal is visible, no navigation-driven
  detach/release occurs, and each terminal preserves its active tab identity.
* Extend the acceptance case to multiple terminal tabs on one Work item and to
  pane/zone navigation. Assert inactive terminals do not receive focus or
  input, while the reactivated terminal follows Navigation mode and Terminal
  typing mode exactly as before.
* Exercise foreground reclamation between the Studio Task workspace and issue
  drawer. Assert ownership moves the one retained viewer instead of attaching
  a second native surface for the same run.
* At the terminal presentation seam, cover temporary-to-durable rekeying,
  repeated activate/deactivate requests, activate races between two terminals,
  and React StrictMode remounts. Assert operations are serialized and attach,
  hide, show, and detach remain idempotent.
* At the Tauri command seam, prove hide keeps the native entry and attachment
  process registered, show restores it, hidden views cannot focus or emit
  gestures, and only detach removes the entry and stops the local attachment.
* Cover geometry changes while a viewer is hidden. Assert reactivation applies
  the newest clipped frame and confirms a non-empty grid before the view becomes
  visible, without sending an intermediate zero-sized resize.
* Cover cleanup for explicit tab dismissal, run completion/loss, native
  process completion, lease-renewal replacement, WebView reload, window close,
  and application shutdown. Assert each path detaches and releases exactly once.
* Cover hide, show, and frame failures. Assert the failed native viewer is
  removed, the compatibility renderer remains usable with the established
  failure notice, and later ticket navigation does not start a repeated native
  attach loop.
* Preserve existing first-attach preparation, redraw, frame clipping,
  fullscreen, scroll normalization, palette, and browser-renderer regression
  coverage.
* Keep the numbered overhaul matrix current and run
  `npm run test:overhaul --workspace @worktracker/studio` before implementation
  handoff, along with affected Studio tests, typecheck, and native Rust/bridge
  tests.

## Out of Scope

* Creating Implementation tickets, child work items, dependency edges, or an
  implementation campaign during the Spec stage.
* Keeping native viewers across application restart, WebView reload, window
  destruction, logout/profile teardown, or a later desktop process.
* Eagerly attaching every discovered, resumable, historical, or unopened agent
  run.
* Retaining a viewer after the user closes its terminal tab or after its run is
  known to be complete or lost.
* Adding an idle eviction policy, memory budget, retained-viewer preference, or
  user-configurable terminal cache limit.
* Running more than one native viewer for the same durable agent run.
* Changing tmux durability, the native terminal command, terminal discovery,
  run lifecycle, viewer-lease authority, or backend reconciliation.
* Replacing Ghostty, removing the compatibility renderer, or changing browser
  xterm behavior.
* Redesigning terminal tabs, Task workspace navigation, live-terminal cycling,
  Navigation mode, Terminal typing mode, or issue-drawer ownership semantics.
* Preloading native code or preparing a Ghostty viewer before the user opens a
  terminal.

## Further Notes

* **Retained native viewer** means one successfully attached libghostty view,
  direct local tmux client, and viewer lease that remain alive while their open
  terminal tab is temporarily inactive.
* **Hidden** is a presentation state, not a lifecycle state. It must not imply
  detach, run interruption, tab dismissal, lease release, or a zero-sized tmux
  resize.
* The central invariant is: navigation may change which retained viewer is
  visible, but only a real teardown boundary may destroy one.
