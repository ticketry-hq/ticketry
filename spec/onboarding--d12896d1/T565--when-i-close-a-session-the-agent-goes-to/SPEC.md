# CODING-565 — Show Resume immediately after closing a session

## Problem Statement

When a Ticketry user closes an agent terminal from a Task workspace, Studio
ends the durable terminal session and moves the completed run into the dormant
row, but it does not offer that run's existing Resume action while the same work
item remains selected. The user must navigate to another work item and return
before Resume appears.

The navigation itself is not making the run resumable. It causes the mounted
workspace to read resumable sessions again. Until that remount, Studio continues
to present the earlier resumable-session result even though explicit
termination has successfully changed the backend fact on which that result
depends. The Task workspace therefore looks internally inconsistent: it knows
the session is inactive but does not yet expose the action for continuing its
provider conversation.

## Solution

After explicit termination succeeds, Studio will refresh the selected Task
workspace's resumable-session data while keeping the workspace mounted. When
the backend reports the ended run as resumable, the existing Resume control
will appear in the dormant row without requiring ticket navigation, a page
reload, or a workspace remount.

The behavior will continue to use Agent resume rather than reconnecting to the
terminated durable terminal session. Choosing Resume creates a new agent run
and terminal runtime that continue the previous provider conversation through
its recorded provider session identity. Runs that the backend does not consider
resumable will not receive a Resume control.

## User Stories

1. As a Ticketry user, I want Resume to appear after I close an agent terminal,
   so that I can continue the conversation without leaving the selected work
   item.
2. As a Ticketry user, I want the Task workspace to update in place after a
   successful close, so that navigation is not required to reveal current
   actions.
3. As a Ticketry user, I want the closed terminal tab to disappear as it does
   today, so that ended sessions do not remain presented as live terminals.
4. As a Ticketry user, I want the resumable run to appear in the existing
   dormant row, so that session continuation remains in its familiar location.
5. As a Ticketry user, I want the Resume control to identify the agent provider,
   so that I know which conversation I am continuing.
6. As a Ticketry user, I want clicking Resume to create and foreground the new
   terminal tab using the existing flow, so that continuation behaves the same
   whether the dormant run appeared on initial entry or immediately after a
   close.
7. As a Ticketry user, I want the continued run to retain the previous
   provider conversation, so that closing its terminal does not discard the
   context I intended to resume.
8. As a Ticketry user, I want non-resumable runs to remain history-only, so that
   Studio does not offer an action the backend cannot perform.
9. As a Ticketry user, I want a failed close to keep the current terminal and
   avoid showing a false Resume action, so that the UI reflects whether
   termination actually succeeded.
10. As a Ticketry user, I want repeated or delayed requests to avoid creating
    duplicate Resume controls, so that one ended provider conversation has one
    continuation action.
11. As a Ticketry user, I want the Task workspace's Details and document state
    to remain mounted while resumable sessions refresh, so that closing a
    terminal does not reset unrelated workspace context.
12. As a Ticketry user, I want closing an inactive or already-ended run to
    remain safe, so that retrying an idempotent termination cannot corrupt the
    dormant-session presentation.
13. As a maintainer, I want explicit termination to refresh every query result
    made stale by that successful write, so that presentation does not depend
    on remount side effects.
14. As a maintainer, I want the existing resumable-session query to remain the
    single frontend holding for resumable runs, so that terminal state is not
    copied into another store.
15. As a maintainer, I want backend resumability policy to remain authoritative,
    so that the frontend does not infer support from agent names, lifecycle
    labels, or terminal-viewer state.
16. As a maintainer, I want one Task-workspace acceptance case to cover close,
    refresh, and Resume visibility, so that this regression is protected at
    the user-observable seam where it occurred.

## Implementation Decisions

* Treat the successful explicit-termination response as the synchronization
  boundary. Do not refresh resumable-session data before the backend confirms
  termination, because the run is not yet eligible and a failed close must not
  produce a false continuation action.
* After that boundary, invalidate or refetch the resumable-session query for
  the currently mounted Task workspace. The refresh must occur without changing
  the selected work item, recreating the workspace, or requiring any terminal
  status-feed event to trigger it.
* Keep the resumable-session query as the sole client holding for the backend's
  resumable-run collection. Do not mirror the collection in the terminal store,
  the Task-workspace store, or component-local state, and do not synthesize a
  resumable row optimistically from terminal metadata.
* Continue deriving the dormant row from the refreshed resumable-session query.
  The existing ordering, ten-item presentation cap, provider label, loading
  state, duplicate-collapse policy, and history exclusion behavior remain
  unchanged.
* Keep backend eligibility authoritative. A run appears only when the existing
  resumable-session endpoint returns it after termination; provider session
  identity, already-resumed chains, live successors, unsupported providers,
  and other eligibility rules are not reimplemented in Studio.
* Preserve the existing Agent resume contract. Resume creates a new agent run
  and durable terminal session linked to the prior run's provider conversation;
  it does not restart, reattach, or revive the terminated terminal runtime.
* Preserve explicit-close behavior: remove the ended run from the live
  auto-reattach set, dismiss the terminal tab, retain run history, and fall back
  to the appropriate remaining workspace tab.
* Preserve close failure behavior: report the failure, leave the terminal
  available, and do not refresh the resumable collection as though the write
  succeeded.
* Use the same close completion path for pointer and keyboard close actions so
  both entry points receive the refresh. Avoid placing synchronization solely
  in a visual component or navigation-specific handler.
* Do not require a new backend endpoint, payload field, database migration,
  generated SDK change, status-feed event, Tauri command, terminal-viewer
  behavior, or tmux behavior.
* No new ADR is required. This change restores synchronization between an
  existing successful mutation and the existing single query holding; it does
  not introduce a new ownership boundary or persistence contract.

## Testing Decisions

A good test observes the mounted Task workspace exactly as a user does. It
clicks the terminal close affordance, controls the successful backend replies,
and observes the existing Resume action appearing without rerendering the
workspace with another work-item identity. It does not inspect query-cache
internals, assert that an invalidation helper was called, or couple the contract
to a particular component or hook.

* Extend the existing numbered Studio acceptance coverage for dormant-session
  resume. Begin with one selected work item, one live terminal tab, and an empty
  resumable-session response; close the terminal; resolve termination; return
  that ended run from the next resumable-session read; and assert that its
  Resume control appears while the same work item remains selected.
* In that acceptance case, assert that the closed live tab is gone before the
  Resume control is used, then activate Resume and verify the existing behavior:
  a new terminal run opens, becomes the selected terminal tab, and the old
  dormant action disappears.
* Assert that the second resumable-session read occurs only after successful
  termination. A rejected termination must retain the terminal, show the
  existing user-facing error, and produce no Resume control.
* Keep the backend resumable-session API tests as prior art and regression
  coverage for eligibility, provider-session chain collapse, live-successor
  exclusion, ordering, scoping, and the ten-result cap. This Story does not need
  to duplicate those policies in frontend tests.
* Keep terminal-store and lifecycle acceptance coverage as prior art for
  explicit termination, dismissal, live-session restoration, and tab fallback.
  The new regression assertion belongs at the composed Task-workspace seam
  because the defect spans the close mutation and resumable query.
* Update the numbered overhaul acceptance matrix if the existing dormant-resume
  case is expanded or split, then run the Studio overhaul gate before
  implementation handoff. Run the affected Studio tests and typecheck as
  proportional regression checks.

## Out of Scope

* Creating implementation tickets, child work items, or a dependency graph in
  the Spec stage.
* Automatically resuming an agent when its terminal is closed.
* Adding a second Resume button, redesigning the dormant row, or renaming the
  existing Resume affordance to Restart.
* Reconnecting to, reviving, or reusing the terminated durable terminal
  session or its tmux process.
* Changing which providers or ended runs are eligible for Agent resume.
* Changing provider-conversation persistence, resume-chain semantics, or the
  backend resume endpoint.
* Changing termination lifecycle policy, run-history retention, terminal tab
  ordering, auto-reattach rules, or viewer ownership.
* Broad polling of resumable sessions or using navigation/remount as a refresh
  mechanism.
* Changing module scratch-workspace behavior; this Story's reported and tested
  contract is the selected work item's Task workspace.
* Backend schema, public API shape, generated client, Tauri/webview boundary,
  libghostty, or tmux changes.

## Further Notes

* The current delayed behavior localizes the defect: leaving and returning to
  the work item performs the missing resumable-session read and reveals the
  already-existing control. The backend resume capability and dormant-row
  presentation are therefore present; the missing contract is mutation-to-query
  synchronization after explicit close.
* In domain terms, the user says “restart,” while the existing operation is
  **Agent resume**. The implementation must preserve that distinction: a new
  run and terminal runtime continue the provider conversation; an ended durable
  terminal session is never restarted.
* The chosen acceptance seam matches the expected user behavior: the work item
  identity stays constant throughout the scenario. Any test that changes the
  selected ticket would accidentally preserve the workaround instead of proving
  the fix.
