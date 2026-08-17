# CODING-718 — Keep Settings visible over attached agent terminals

Status: Spec complete
Story: WorkTracker #718 (`e012cce5-3e2f-4546-8e9b-32f9e5a1783f`)
Date: 2026-08-16

## Problem Statement

Ticketry's desktop Studio renders an attached agent-run terminal in a native
libghostty view hosted beside the WebView. That native surface sits above HTML
content regardless of CSS stacking order. When the visible terminal remains
presented while Studio opens Settings, the terminal covers the Settings modal,
making the application appear to ignore the Settings action and preventing the
user from inspecting or changing configuration.

The terminal tab and its durable tmux session are still valid. Opening a Studio
modal should temporarily change only native-viewer presentation; it should not
detach the viewer, release its lease, interrupt the agent run, or discard the
terminal's screen and scroll position.

## Solution

Treat the presence of any Studio modal, including Settings, as a window-level
native-viewer occlusion condition. When Settings opens, every currently
presented native terminal viewer is hidden while remaining attached. The
Settings scrim and dialog then occupy the visible and interactive foreground of
the Studio window.

When Settings closes, Ticketry remeasures the current terminal host and reveals
the same retained native viewer if that terminal is still the active surface.
The reveal follows the existing foreground-ownership and focus rules, so a
viewer is not recreated, shown in the wrong Task workspace, or focused merely
because the modal closed. A viewer whose attachment or preparation finishes
while Settings is open remains hidden until the modal stack is empty.

This behavior applies to every route into Settings, including the footer action
and its global key binding, and to every native terminal surface that can be
presented in the window. Browser mode and the compatibility renderer require no
special stacking behavior because they remain inside the WebView.

## User Stories

1. As a Ticketry desktop user, I want Settings to appear when I select the
   footer Settings action while an agent terminal is attached, so that I can
   configure Studio without navigating away from the run.
2. As a Ticketry desktop user, I want the Settings scrim and dialog to be fully
   visible above the terminal, so that no native surface obscures the controls.
3. As a Ticketry desktop user, I want Settings controls to accept pointer and
   keyboard input while a terminal is attached, so that the hidden native view
   cannot intercept interaction.
4. As a keyboard user, I want the global Settings binding to work from a live
   terminal, so that terminal focus does not make Settings unreachable.
5. As a Ticketry desktop user, I want opening Settings to preserve the attached
   terminal, so that configuration work does not reconnect or recreate it.
6. As a Ticketry desktop user, I want my agent run to continue while Settings is
   open, so that viewing configuration does not interrupt active work.
7. As a Ticketry desktop user, I want the terminal's screen contents and
   scrollback position preserved across the modal, so that I return to the same
   conversation context.
8. As a Ticketry desktop user, I want closing Settings to reveal the same
   retained viewer, so that returning to the terminal is immediate.
9. As a Ticketry desktop user, I want the restored viewer measured against its
   current host, so that window or pane changes made around the modal cannot
   restore it with stale geometry.
10. As a Ticketry desktop user, I want a terminal that is no longer the active
    Task workspace surface to remain hidden after Settings closes, so that it
    cannot cover Details, a document, or another terminal.
11. As a Ticketry desktop user, I want terminal foreground ownership to remain
    authoritative after Settings closes, so that Studio, a drawer, and the
    terminal panel do not compete to present the same viewer.
12. As a Ticketry desktop user, I want all visible native terminal viewers
    hidden when Settings opens, so that a task terminal and a terminal-panel
    shell cannot leave uncovered native islands over the modal.
13. As a Ticketry desktop user, I want a viewer still attaching when Settings
    opens to stay hidden when preparation completes, so that a late native
    reveal cannot suddenly cover the dialog.
14. As a Ticketry desktop user, I want quickly opening and closing Settings to
    settle on the final requested presentation, so that asynchronous native
    hide/show calls do not leave a terminal stuck or exposed over a modal.
15. As a Ticketry desktop user, I want Escape and the close control to retain
    their existing Settings behavior, so that the terminal fix does not change
    modal navigation.
16. As a pointer user, I want focus to return to the Settings opener after I
    close a pointer-opened dialog, so that I do not lose my place in Studio.
17. As a terminal keyboard user, I want the existing native focus-restoration
    policy preserved after a keyboard-opened modal, so that closing Settings
    returns me to the correct navigation or typing context.
18. As a browser-development user, I want Settings and xterm behavior unchanged,
    so that a native desktop layering fix does not alter the browser fallback.
19. As a Ticketry desktop user, I want a native hide or reveal failure to use
    the established compatibility fallback without hiding Settings, so that a
    renderer problem cannot make configuration inaccessible again.
20. As a maintainer, I want one presentation rule shared by all Studio modals
    and native terminal hosts, so that each modal does not implement its own
    terminal workaround.
21. As a maintainer, I want this behavior verified from the real Settings
    action through the attached-viewer boundary, so that separate modal and
    terminal tests cannot both pass while their integration remains broken.

## Implementation Decisions

* Treat this as a Studio presentation defect at the WebView/native-view
  boundary. CSS `z-index` cannot order WebView content above a sibling AppKit
  terminal view and is not an acceptable fix.
* Use the shared Studio modal stack as the single source of occlusion intent.
  A non-empty stack means no native terminal viewer may be presented. Settings
  must not maintain a terminal-specific flag or call native commands directly.
* Apply the rule to every presented native viewer in the desktop window, not
  only the viewer that most recently held keyboard focus. This includes agent
  terminal tabs in Task workspaces and any native viewer presented by the
  terminal panel or another foreground owner.
* Hide viewers through the existing serialized native presentation boundary.
  Modal occlusion changes visibility only: it does not detach the native view,
  stop the local tmux client, release the viewer lease, close a terminal tab,
  update run lifecycle, or terminate the hosted agent.
* Preserve the one-viewer-per-run invariant. Closing Settings reveals the
  existing handle when eligible and must not attach another viewer or acquire a
  second lease.
* Gate both initial presentation and later reveal on the current modal state.
  If attachment, redraw preparation, lease acquisition, ownership transfer, or
  a frame update completes after Settings has opened, the viewer remains
  hidden.
* Serialize modal-driven hide/show with navigation-driven presentation changes.
  After rapid open, close, selection, or ownership changes, the committed
  native state must match the latest modal, active-surface, and ownership
  intent rather than the order in which asynchronous calls finish.
* On modal close, remeasure and clip the eligible host before showing the
  retained viewer, require the established non-empty grid result, and continue
  to observe geometry only while it is presented.
* Preserve the existing controlled focus contracts. A modal-open viewer cannot
  register for focus or consume a focus signal. A reveal after close follows
  foreground ownership, Navigation mode, Terminal typing mode, and the native
  focus-restoration policy; it does not focus merely because it became visible.
* Keep Settings a singleton overlay reached through its existing footer and
  keymap actions. Do not relocate Settings, turn it into a route, or duplicate
  modal state to solve native layering.
* Apply the same occlusion rule to the whole Studio modal stack. Although this
  Story is observed through Settings, another modal must not regress to being
  covered by an attached native viewer.
* Preserve browser mode and the compatibility renderer. WebView-rendered
  terminals already participate in normal HTML stacking and do not invoke the
  native hide/show boundary.
* If native hide, show, frame, or attachment health fails, use the established
  native-viewer failure handling and compatibility fallback. The modal remains
  visible and interactive throughout error handling.
* Keep the terminal presentation policy, React modal composition, and native
  visibility implementation as separate focused concerns. No backend, database,
  API, generated SDK, tmux configuration, or run-record change is required.
* No architectural decision record is required. The change enforces the
  existing narrow WebView boundary and retained-viewer ownership model rather
  than introducing a new architectural choice.

## Testing Decisions

A good test observes the user-visible integration: the Settings action opens a
visible, operable dialog while an attached native terminal is present, the
native viewer is hidden without teardown, and the same viewer is restored only
when it remains eligible. Tests should not assert hook ordering, component-local
flags, private registry shapes, or CSS stacking utilities.

* Make one mounted Studio acceptance case the primary seam. Compose the existing
  Settings footer/ModalHost surface with an attached native terminal, activate
  the real Settings action, and assert that the Settings dialog appears and the
  native hide operation commits.
* In that acceptance case, assert that opening Settings sends no native detach,
  lease release, terminal close, or run-termination request. Close Settings and
  assert the same handle is shown with the current measured frame and no second
  attach or lease acquisition.
* Cover the global Settings key binding while the native terminal owns focus,
  asserting that Settings becomes interactive and terminal input is suspended
  until the modal closes.
* Cover an attachment or presentation that is still pending when Settings
  opens. Resolve the pending work and assert that no show commits until the
  modal stack becomes empty.
* Cover two concurrently presentable native viewers owned by different Studio
  surfaces. Assert that both are hidden for Settings and that only viewers still
  active and owned are restored afterward.
* Cover rapid open/close and close/reopen races at the existing serialized
  terminal-presentation seam. Resolve native promises out of order and assert
  that the final native visibility matches the latest modal state.
* Cover pointer-open focus restoration to the Settings footer action and
  keyboard-open restoration through the existing native focus contract. Assert
  that no hidden viewer accepts focus.
* Cover native hide/show failure through the existing fallback seam and assert
  that the Settings dialog remains visible and usable while the failed viewer
  is removed.
* Preserve the existing Settings acceptance coverage for singleton opening,
  Escape, close, focus containment, save/discard, and provider configuration.
  It is prior art for the WebView half of this integration.
* Preserve the existing native-viewer presentation, retention, ownership,
  preparation, geometry, bridge, lease, and focus-restoration acceptance cases.
  They are prior art for the native half of this integration.
* Add or update a numbered case in the Studio overhaul matrix, keep its gate
  current, and run `npm run test:overhaul --workspace @worktracker/studio`
  before implementation handoff. Run affected Studio unit tests, typecheck, and
  native Rust/bridge tests if implementation changes the native visibility
  command rather than only its presentation coordination.

## Out of Scope

* Creating Implementation tickets, child work items, blocker edges, or a
  dependency graph during the Spec stage.
* Redesigning the Settings information architecture, provider/model forms,
  footer, global keymap, modal appearance, or Settings save/discard behavior.
* Moving Settings into a native window, route, popover, drawer, or terminal tab.
* Detaching or restarting a native viewer, terminal session, tmux client,
  sidecar, hosted command, or agent run merely because a modal opens.
* Changing terminal-tab retention, foreground ownership, viewer leases,
  terminal restoration, run lifecycle, or terminal-panel semantics.
* Replacing libghostty, removing the compatibility renderer, or changing
  browser xterm stacking.
* Adding backend persistence, API fields, database migrations, SDK changes, or
  a user preference for modal/native-viewer layering.
* Solving unrelated native-view geometry, output, scroll, palette, liveness,
  recovery, or attachment defects unless they directly prevent modal occlusion.

## Further Notes

* A native terminal view is not part of the WebView's DOM stacking context.
  Making the HTML modal's `z-index` larger cannot make it cover that view.
* Hidden is a presentation state, not a terminal or run lifecycle state. The
  durable tmux session and attached agent continue running while Settings is
  open.
* The essential invariant is: while the Studio modal stack is non-empty, no
  native terminal viewer is presented; when it becomes empty, only the viewer
  currently entitled to presentation may be remeasured and shown.
