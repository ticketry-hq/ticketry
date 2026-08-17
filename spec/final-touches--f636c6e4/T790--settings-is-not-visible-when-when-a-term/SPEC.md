# CODING-790 — Keep Settings visible over an attached Task workspace terminal

Status: Spec complete
Story: WorkTracker #790 (`86e1b08a-092c-4276-aeb7-9f1392664ecb`)
Date: 2026-08-17

## Problem Statement

In the Ticketry desktop application, opening Settings while a terminal tab in
a Task workspace has an attached and presented native terminal viewer can leave
the Settings dialog behind the terminal. The native libghostty surface is not
part of the WebView's DOM stacking context, so the terminal can remain visually
and interactively in front even though Studio has opened its Settings modal.
From the user's perspective, Settings is missing or unusable.

Ticketry already defines a window-level modal-occlusion contract for retained
native terminal viewers. This report is therefore a regression of that contract
for the Task workspace surface, not a request for a second Settings experience
or a new terminal lifecycle. The attached viewer and its durable terminal
session remain valid while Settings is open and must not be torn down merely to
make the dialog visible.

## Solution

Restore the existing shared occlusion behavior for a Task workspace terminal.
Whenever Settings owns the window foreground, the currently presented native
viewer is hidden while remaining attached, allowing the Settings scrim and
dialog to be fully visible and interactive. Every existing route into Settings
must produce the same result.

When Settings closes, Studio re-evaluates the latest Task workspace tab,
foreground ownership, host geometry, and focus intent. It reveals the same
retained viewer only if that terminal is still entitled to presentation. If the
user changed work item, selected Details or a document, chose another terminal,
or opened another window-level overlay in the meantime, the old viewer stays
hidden. Attachment or presentation work that finishes while Settings is open
must also remain occluded until the foreground is available.

The repair must reuse the shared modal-occlusion and serialized native-viewer
presentation boundary established by the existing implementation. Browser-mode
and compatibility-renderer terminals already participate in WebView stacking
and keep their current behavior.

## User Stories

1. As a Ticketry desktop user, I want Settings to appear above an attached Task
   workspace terminal, so that I can change configuration without leaving my
   work item.
2. As a Ticketry desktop user, I want the Settings scrim and dialog to be fully
   visible, so that the native terminal does not cover any part of the modal.
3. As a Ticketry desktop user, I want every Settings control to accept pointer
   and keyboard input, so that an occluded terminal cannot intercept my actions.
4. As a Ticketry desktop user, I want the footer Settings action to work while
   a Task workspace terminal is presented, so that the normal entry point is
   reliable in every workspace tab.
5. As a keyboard user, I want the existing Settings binding to open the same
   singleton dialog from an engaged native terminal, so that terminal focus
   does not make Settings unreachable.
6. As a Ticketry desktop user, I want opening Settings to retain the terminal
   viewer attachment, so that configuration does not reconnect the viewer.
7. As a Ticketry desktop user, I want the durable terminal session and hosted
   agent to continue while Settings is open, so that configuration does not
   interrupt ongoing work.
8. As a Ticketry desktop user, I want terminal screen contents and scrollback
   preserved while Settings is open, so that I return to the same context.
9. As a Ticketry desktop user, I want closing Settings to reveal the same
   retained viewer when its terminal tab is still selected, so that returning
   to the terminal is immediate.
10. As a Ticketry desktop user, I want the restored viewer measured against the
    current Task workspace host, so that it does not return at stale geometry.
11. As a Ticketry desktop user, I want a viewer to stay hidden if I leave its
    terminal tab while Settings is open, so that it cannot cover Details, a
    design document, or another terminal.
12. As a Ticketry desktop user, I want a viewer that finishes attaching while
    Settings is open to remain hidden, so that late asynchronous work cannot
    cover the dialog.
13. As a Ticketry desktop user, I want rapid Settings open and close actions to
    settle on the latest requested state, so that asynchronous native commands
    cannot leave the terminal exposed or stuck hidden.
14. As a Ticketry desktop user, I want Escape and the close control to retain
    their existing Settings behavior, so that the regression fix does not alter
    modal navigation.
15. As a Ticketry desktop user, I want existing focus-restoration behavior
    preserved after Settings closes, so that focus returns to the correct
    Studio or terminal surface without an unexpected typing handoff.
16. As a browser-development user, I want Settings and the WebView-rendered
    terminal to behave as before, so that a desktop native-layering fix does not
    change the fallback experience.
17. As a Ticketry maintainer, I want the regression fixed at the shared
    native-viewer presentation boundary, so that Task workspaces do not acquire
    a Settings-only visibility path.
18. As a Ticketry maintainer, I want a mounted Studio acceptance case to fail
    when Settings is covered by a Task workspace terminal, so that the exact
    user-visible recurrence cannot return unnoticed.

## Implementation Decisions

* Treat this as a desktop Studio presentation regression at the
  WebView/native-view boundary. Increasing the modal's CSS stacking value is
  not a valid fix because a sibling native view is outside the DOM stacking
  context.
* Preserve the existing definition of a Task workspace: its Details,
  design-document, and terminal tabs remain mounted according to current
  retention rules. Settings remains a singleton Studio modal and does not
  become a workspace tab, route, drawer, or native window.
* Keep the shared window-level overlay state authoritative for native viewer
  visibility. A presented Task workspace viewer must obey the same modal
  occlusion predicate as every other native viewer; do not introduce a
  Settings-only flag, a Task-workspace-only flag, or direct native calls from
  the Settings surface.
* Hide the native terminal viewer through the existing serialized presentation
  boundary. Hiding changes presentation only: it does not detach the terminal
  viewer, release viewer ownership, close the terminal tab, end the durable
  terminal session, stop tmux, or change the agent run.
* Preserve the one-viewer-per-run invariant. Closing Settings reuses the
  retained native handle and must not create a second attachment or viewer
  lease.
* Gate initial reveal, re-reveal, host-frame updates, attachment completion, and
  focus delivery on the current occlusion state. Native work that completes
  after Settings opens cannot make the viewer visible or focused behind the
  modal.
* When Settings closes, re-evaluate current foreground ownership and the active
  Task workspace destination before showing anything. Remeasure and clip the
  eligible host using the existing non-empty-grid rule before revealing the
  retained viewer.
* Serialize modal-driven visibility changes with tab navigation, work-item
  selection, foreground-owner changes, and other native presentation work. The
  committed native state must reflect the newest intent, not native promise
  completion order.
* Preserve the central keymap and native-chord routes into the existing
  Settings action. This Story does not define another shortcut or bypass the
  singleton modal store.
* Preserve the existing controlled focus contract. While Settings is open, the
  hidden terminal viewer cannot take focus or receive terminal input. Closing
  Settings follows the current pointer-opener and native-terminal focus
  restoration policy; visibility alone does not grant focus.
* Continue to use the established native-viewer failure handling and
  compatibility fallback if hide, frame, show, or attachment health fails. The
  Settings dialog remains visible and usable during recovery.
* Keep browser-rendered terminals unchanged because they remain within the
  WebView stacking context.
* Reuse the occlusion contract introduced for CODING-718. The implementation
  should identify and repair the Task workspace regression rather than copy the
  earlier solution into a second path.
* No backend, database, API, generated SDK, work-item model, durable terminal
  session, or run-lifecycle change is required by this specification.
* No new architectural decision record is required unless implementation
  discovers that the existing shared occlusion or presentation model must be
  replaced rather than repaired.

## Testing Decisions

A good test observes the behavior through the highest existing seam: a mounted
Studio surface containing the real Settings action, modal host, Task workspace
native terminal host, foreground ownership, and mocked native command boundary.
It should assert what the user can see and operate, plus the externally visible
native lifecycle commands. It should not couple to hook order, private registry
maps, CSS class names, or component-local flags.

* Extend the existing numbered Settings/native-terminal acceptance coverage as
  the primary regression seam. Begin with a Task workspace terminal viewer
  attached and presented, activate the real Settings action, and assert that
  the Settings dialog is visible and interactive and that a native hide commits.
* In the same acceptance flow, assert that opening Settings sends no viewer
  detach, ownership release, terminal close, durable-session termination, run
  termination, second attachment, or second lease acquisition.
* Close Settings and assert that the current Task workspace host is remeasured
  and the same retained handle is revealed when its terminal tab still owns the
  foreground.
* While Settings is open, switch the active Task workspace destination or
  foreground owner and assert that closing the dialog does not reveal the stale
  viewer over Details, a design document, another terminal, or another work
  item.
* Cover the existing native Settings chord while the native terminal owns
  focus. Assert that it routes to the same singleton Settings dialog, hides the
  viewer, and prevents terminal input until modal focus is released.
* Cover attachment or presentation completion while Settings is already open.
  Assert that late completion cannot commit a show and that the eligible viewer
  is revealed only after occlusion ends.
* Cover rapid open/close or close/reopen ordering at the serialized native
  presentation seam and assert that final visibility matches the latest modal,
  active-tab, and ownership state.
* Preserve prior acceptance coverage for the broader modal-occlusion contract,
  viewer retention, ownership, preparation, geometry, focus restoration,
  failure fallback, singleton Settings behavior, and browser compatibility.
* Add or update the numbered Studio overhaul matrix case for the observed Task
  workspace regression and keep its gate current.
* Before implementation handoff, run the Studio overhaul acceptance gate. Run
  focused Studio tests and type checking as appropriate, plus native bridge
  tests only if the repair changes the native visibility or chord boundary.

## Out of Scope

* Creating Implementation tickets, child work items, dependency edges, or an
  execution graph during this Spec stage.
* Redesigning Settings, its information architecture, provider or workflow
  forms, save/discard behavior, footer action, close behavior, or visual style.
* Moving Settings into a Task workspace tab, separate route, drawer, popover,
  or native window.
* Detaching, restarting, or replacing a terminal viewer, durable terminal
  session, tmux client, hosted agent, or run merely because Settings opens.
* Changing terminal-tab retention, terminal panel behavior, foreground
  ownership semantics, viewer leases, scrollback, output activity, run status,
  or terminal restoration except where necessary to enforce modal occlusion.
* Replacing libghostty, removing the compatibility renderer, or changing the
  browser terminal implementation.
* Adding backend persistence, API fields, database migrations, generated SDK
  changes, or a user preference for native-viewer/modal ordering.
* Addressing unrelated native renderer geometry, palette, scrolling, liveness,
  recovery, or attachment defects.

## Further Notes

* The repository's domain language distinguishes a terminal tab, which is one
  agent run shown in a Task workspace, from its durable terminal session and
  from the temporary terminal viewer attached to that session. This Story
  changes only viewer presentation while Settings owns the foreground.
* An attached viewer may legitimately remain attached while hidden. Viewer
  detachment is not required for modal visibility and would conflate a
  presentation concern with terminal lifecycle.
* The core invariant is: while a window-level overlay owns the foreground, no
  native terminal viewer may be presented or focused; after it releases the
  foreground, only the viewer currently entitled by Task workspace selection
  and ownership may be remeasured and shown.
* CODING-718 is prior art for the shared contract. CODING-790 requires a focused
  regression proof for the Task workspace recurrence and should not create a
  parallel occlusion mechanism.
