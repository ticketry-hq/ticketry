# CODIN-1468 — Reusable ticket drag-and-drop across workflow states

Status: refined
Story: CODIN-1468
Module: Ticketry

## Outcome

Users can drag a top-level ticket within its workflow-state section or into
another workflow-state section in the Studio task tree. The interaction reuses
a shared native HTML drag/drop primitive, preserves the existing state-catalog
behavior, persists ticket rank through the existing reorder API, and gives
clear failure feedback without leaving the local tree in a false state.

## Evidence and existing seams

* `studio/src/features/workflows/StateCatalog.tsx` owns a working native HTML5
  drag/drop implementation, but its drag bookkeeping and drop handling are
  local to the settings surface.
* `studio/src/features/workflows/workflowEditorStore.ts` already demonstrates
  optimistic reorder followed by authoritative reconciliation and rollback.
* `studio/src/features/studio/pages/tasks/TasksPane.tsx`, `TaskRow.tsx`, and
  `StateHeaderRow.tsx` are the task-tree rendering and interaction boundary.
* `studio/src/features/studio/pages/tasks/hooks/useTaskTree.ts` hides collapsed
  section contents and expands matching branches during search.
* `studio/src/features/studio/lib/taskTree.ts` reverses each canonical
  state/rank bucket for presentation; visible neighbors therefore must be
  translated back to canonical `before_id` / `after_id` API neighbors.
* `studio/src/features/studio/stores/tasksStore.ts` is the reconciliation seam
  for all loaded copies of a task and already protects newer state revisions.
* `studio/src/shared/api/client.ts` exposes `reorderWorkItem`.
* `studio/src/features/work-items/internal/backlogIssueActions.ts` contains the
  reusable optimistic fractional-rank and rollback precedent.
* `backend/worktracker/services/work_items.py` already computes the persisted
  rank between same-project neighbors. This story needs no backend contract
  change.

## Finalized behavior

### Eligible drags

* A real module-root ticket is draggable.
* The synthetic Scratch workspace is never draggable or a drop target.
* Nested subtasks are not draggable in this story. Their visible order is
  parent-scoped, so a workflow-state drop would otherwise imply reparenting or
  detach the row from the section that owns its root.
* Moving a parent changes only that parent ticket's state and/or rank.
  Descendants keep their parent, workflow state, and rank and continue to
  render beneath the moved parent.
* Drag/drop is disabled whenever the Stories search query is active. Filtered
  results cannot provide trustworthy hidden neighbors. Clearing search
  restores drag/drop without changing expansion or collapsed-section state.

### Drop targets and placement

* Every real configured workflow state renders a state header, including states
  with zero top-level tickets. Scratch retains its current synthetic section.
* A state header is a valid drop target whether expanded, collapsed, or empty.
  Dropping on a header places the ticket first in the visible section.
* A ticket row is divided into before/after drop zones by pointer position.
  The preview indicator shows the exact visible insertion edge. Dropping on
  the lower half of the last row permits placement at the bottom.
* Reordering is among module-root tickets only. Neighbor ids sent to the API
  are from the destination state and exclude the dragged ticket.
* Because the task tree presents canonical rank order in reverse, the drop
  resolver converts visible predecessor/successor ids to the API's canonical
  `before_id` / `after_id` orientation before calling `reorderWorkItem`.
* No-op drops, self drops, invalid payloads, and drops without a selected
  project/module are ignored.

### Persistence and failure handling

* The tree applies the complete intended state/rank placement optimistically.
* A same-state move performs one reorder request.
* A cross-state move first performs the existing human-origin workflow
  transition, then reorders the returned ticket between destination
  neighbors. This preserves workflow validation and avoids ranking a ticket
  into a destination that rejected it.
* If the workflow transition fails, restore the pre-drag tree snapshot unless
  a newer revision has already reconciled that ticket, retain the current
  selection, and show the server error toast.
* If the transition succeeds but rank persistence fails, do not attempt a
  compensating state transition. Keep the authoritative new state, refresh
  the module tree to obtain server rank, and show that placement failed. This
  avoids silently violating workflow rules or overwriting a concurrent update.
* If same-state reorder fails, restore the pre-drag ordering unless a newer
  authoritative copy exists and show the server error.
* During an in-flight move, suppress another drag for that ticket. Existing
  project/module generation and state-revision guards remain authoritative
  when navigation or feed updates race the request.

### Shared drag/drop primitive

Extract a small generic native HTML drag/drop controller under
`studio/src/shared/` that owns:

* typed payload serialization/validation;
* current dragged id/payload;
* current target and before/after intent;
* `dragstart`, `dragover`, `dragleave`, `drop`, and `dragend` cleanup;
* optional disabled state; and
* stable props/callbacks suitable for memoized rows.

Migrate `StateCatalog` to the primitive without changing its existing reorder,
arrow-button fallback, disabled-during-action behavior, or rollback semantics.
Ticket-specific eligibility, neighbor resolution, state transitions, and store
updates remain outside the generic primitive.

## Required code changes

1. Add the shared native drag/drop controller and focused tests; adapt
   `StateCatalog` to use it.
2. Carry `rank` through `TaskSummary` normalization and add a
   `tasksStore` ticket-move command that updates every loaded copy, uses the
   existing state and reorder clients, and follows the rollback rules above.
3. Extend task-section construction so real empty states emit headers and so a
   pure helper can resolve visible drops to canonical destination neighbors.
4. Wire draggable root rows, header targets, row-edge targets, drop indicators,
   busy state, and disabled-during-search behavior through `TasksPane`,
   `TaskRow`, and `StateHeaderRow`.
5. Extend task-tree, search, store, and interaction tests.

## Acceptance criteria

1. Dragging a root ticket above or below another root ticket in the same state
   immediately changes its visible order and persists the expected canonical
   neighbors.
2. Dragging a root ticket to another state's header or row changes only that
   ticket's state, then persists its destination rank.
3. Empty and collapsed real state headers accept a drop without expanding the
   state; the count updates after the optimistic move.
4. Parent descendants remain attached, keep their states/ranks, and move
   visually with the parent. Subtask rows and Scratch do not start drags.
5. No row or state header accepts a ticket drop while search is active.
6. A rejected workflow transition restores the prior state/order and displays
   the server error. A post-transition reorder failure retains the authoritative
   new state, refreshes order, and displays a placement error.
7. Drag state and insertion indicators always clear after drop, cancellation,
   navigation, or error.
8. `StateCatalog` retains drag reorder and arrow-button behavior after adopting
   the shared primitive.
9. Existing hydration, selection, expansion, collapsed-state, search, state
   feed, and settings reorder tests continue to pass.

## Test plan

* Unit-test payload rejection, before/after intent, disabled state, and cleanup
  in the shared controller.
* Unit-test task-section output for empty states and visible-to-canonical
  neighbor conversion at top, middle, bottom, self/no-op, and reversed-order
  boundaries.
* Store-test same-state success/failure, cross-state success, transition
  rollback, reorder-after-transition failure, newer-revision protection, and
  module-navigation races.
* Component-test row and header drops, collapsed and empty states, descendant
  preservation, Scratch/subtask ineligibility, indicators, and search
  disabling.
* Extend `studioTaskTreeHydration.test.tsx`,
  `studioStoriesSearch.test.tsx`, and the existing workflow catalog reorder
  coverage rather than replacing their assertions.

## Out of scope

* Reparenting tickets or moving subtasks independently.
* Bulk-moving descendants to the parent's destination state.
* Touch/mobile drag gestures, keyboard reordering, or a new drag library.
* Cross-project/module drag, workflow configuration changes, backend rank
  schema/API changes, or rank rebalance redesign.