# Move the ticket key to the right side of Story rows

## Problem Statement

The Studio Stories pane currently starts every real work-item row with its
canonical ticket key, followed by a middle-dot separator and the work-item
title. For example, the row reads `CODING-324 · Move the ticket key`. This puts
the stable, secondary identifier before the content users primarily scan and
makes neighboring titles start at different horizontal positions when project
keys vary in length.

The ticket key should remain visible and retain its workflow-state color, but
the title should become the first textual content in the row and the key should
sit at the row's trailing/right edge. The change should begin with an
acceptance test so the intended ordering, visibility, and compact-layout
contract are fixed before the component markup changes.

## Solution

Recompose each real work-item row into a flexible title region followed by its
existing agent-status indicators and a right-aligned canonical key. The title
is the part that yields space and truncates. The key is a non-shrinking token at
the far right, remains colored by the work item's workflow state, and no longer
uses the middle-dot separator.

Apply the same composition to every real row rendered by the shared task-row
component, including Story and Implementation/subtask rows. The synthetic
Local scratch workspace row has no canonical ticket key and remains keyless.
No work-item data, search, workflow, drag-and-drop, selection, or backend
behavior changes.

## User Stories

1. As a Ticketry user, I want a Story row to start with its title, so that I can
   scan the work itself before its identifier.
2. As a Ticketry user, I want the canonical ticket key at the far right of its
   row, so that the identifier remains visible in a predictable place.
3. As a Ticketry user, I want the key rendered as one token such as
   `CODING-324`, so that it remains easy to read and copy.
4. As a Ticketry user, I want the key to retain the work item's workflow-state
   color, so that the existing state cue is preserved.
5. As a Ticketry user, I want long titles to truncate before the ticket key is
   squeezed away, so that narrow panes keep the stable identifier readable.
6. As a Ticketry user, I want lifecycle and automation indicators to remain
   visible between the title and ticket key, so that moving the key does not
   hide agent status.
7. As a Ticketry user, I want Story and Implementation/subtask rows to follow
   the same layout, so that hierarchy does not change how identifiers are read.
8. As a Ticketry user, I want child-row indentation and expand/collapse carets
   to remain unchanged, so that the tree structure remains legible.
9. As a Ticketry user, I want the Local scratch workspace row to remain
   keyless, so that it does not gain a misleading blank or synthetic key.
10. As a Ticketry user, I want selecting, expanding, and dragging a row to work
    exactly as before, so that this visual rearrangement does not change row
    interaction.

## Implementation Decisions

* Keep using the canonical `task.key` already supplied to
  `WorkItemPlanningRow`. Preserve the existing bare-sequence fallback through
  `formatSequenceId(task.sequence_id)` for cached or legacy work items without
  a key; this task changes placement, not identifier resolution.
* Make the work-item title the first textual element after the existing tree
  caret. Its wrapper owns the remaining horizontal space and keeps
  `min-width: 0` plus single-line truncation behavior.
* Render the automation-failure chicklet and lifecycle-state chicklets after
  the title, with their existing behavior and non-shrinking presentation.
* Render the identifier after all status indicators as the final visible token
  in a real work-item row. Give it trailing-edge alignment and prevent it from
  shrinking. The intended left-to-right order is:
  `caret/indentation → title → status indicators → ticket key`.
* Keep a consistent small gap between the title, status indicators, and key.
  Do not preserve the `·` separator; it belongs to the old inline
  `key · title` label and would be visual noise at the opposite edge.
* Keep `data-task-id-token` on the identifier so existing styling and test
  seams continue to identify the canonical token.
* Preserve the identifier's existing state-color behavior: use the catalog
  state's color when present and the muted text color when no color is
  available.
* Do not duplicate the key, add a tooltip, make it a separate click target, or
  change the row's accessible role. Clicking the key continues to select or
  drag the enclosing row just like clicking its title.
* Keep the shared `PlanningRowView` path. Do not introduce separate Story and
  Implementation row components for a layout difference they do not have.
* For the scratch row, continue passing an empty identifier and omit the
  trailing identifier element entirely. Its title and scratch lifecycle badge
  continue to use the shared row shell without reserving blank key space.
* Preserve depth-based padding, caret hit area, selection styling, hover
  styling, description-editor preloading, descendant aggregation, and all
  drag-source props.
* This is a Studio-only presentation change. No backend model, API, generated
  SDK, query shape, persistence, migration, or MCP change is required.

## Testing Decisions

* Implement test-first. Add the failing acceptance case before changing
  `TaskRow.tsx`, observe it fail against the current `key · title` layout, then
  make the smallest production change that satisfies it.
* Add the behavior to
  `studio/src/test/overhaulWorkItemAcceptance.test.tsx` using the existing full
  Studio fixture and Stories-region seam. Do not test a disconnected copy of
  the row markup.
* Assign the new case `[overhaul-33]` and update
  `studio/src/test/overhaulGateAcceptance.test.tsx` from 32 to 33 so the
  numbered acceptance gate remains exhaustive.
* The acceptance case should seed a real root Story with a canonical key, a
  long title, and a state color. It should assert that:
  * the title precedes the key in document order;
  * the key is the row's final textual/layout token after any seeded status
    indicators;
  * the old middle-dot separator is absent;
  * the title region is the flexible, truncating region;
  * the key is non-shrinking and carries the expected state color; and
  * the row remains selectable through the existing tree-item interaction.
* In the same acceptance seam, expand a parent containing an Implementation
  child and assert the child follows the same title-then-key order while
  retaining its tree depth.
* Include or preserve a scratch-row assertion showing that Local scratch
  workspace renders no `data-task-id-token` and no empty trailing key slot.
* Keep lower-level component tests limited to details that the full acceptance
  seam cannot express reliably in jsdom. Layout utility-class assertions are
  acceptable here because flex growth, truncation, and trailing alignment are
  the observable layout contract but jsdom does not perform browser layout.
* Run the mandatory gate before handoff:
  `npm run test:overhaul --workspace @worktracker/studio`.
* Also run the focused acceptance file and Studio typecheck. If the repository
  script supports file targeting, run the focused acceptance case first to
  preserve the red-green sequence.

## File Change Map

* Modify
  `studio/src/test/overhaulWorkItemAcceptance.test.tsx` to add the test-first
  `[overhaul-33]` coverage for real, child, and scratch rows.
* Modify
  `studio/src/test/overhaulGateAcceptance.test.tsx` to expect exactly one case
  for each numbered behavior from 01 through 33.
* Modify
  `studio/src/app/shell/ticket-workspace/tasks/components/TaskRow.tsx` to split
  the old inline task label into the flexible title, unchanged status
  indicators, and trailing identifier token.
* No backend or generated file changes.

## Step-by-Step Implementation Plan

1. Add `[overhaul-33]` to the work-item acceptance suite and advance the gate
   count to 33.
2. Run the focused test and confirm that the current inline `key · title`
   composition fails the new contract.
3. Recompose `PlanningRowView` so the title flexes and truncates, status
   indicators retain their behavior, and the identifier is the final
   non-shrinking token.
4. Preserve the conditional identifier render so the scratch row stays
   keyless, then make the acceptance case pass.
5. Run the focused test, Studio typecheck, and mandatory overhaul gate.

## Acceptance Checklist

* A real work-item row reads visually as title on the left and canonical key on
  the far right.
* No middle-dot separator remains between a real row's title and key.
* The canonical key remains a single state-colored token.
* Long titles truncate while the key remains visible and non-shrinking.
* Existing automation and lifecycle indicators remain visible between title
  and key.
* Story and Implementation/subtask rows share the same layout.
* Tree indentation, expansion, selection, and drag behavior are unchanged.
* Local scratch workspace remains keyless with no blank trailing identifier.
* `[overhaul-33]`, the 01–33 acceptance gate, Studio typecheck, and the
  mandatory overhaul test command pass.

## Out of Scope

* Creating implementation tickets or child work items during the Spec stage.
* Changing canonical ticket-key generation, key search, or sequence fallback.
* Changing workflow-state colors or lifecycle/automation chicklet semantics.
* Redesigning state headers, the Details pane, terminal labels, module rows, or
  any surface outside the Stories tree rows.
* Changing row height, typography, tree indentation, selection, expansion,
  drag-and-drop, or preload behavior except for spacing needed by the new row
  composition.
* Adding a responsive alternate layout, hiding the key at narrow widths, or
  allowing the key to wrap.

## Further Notes

* The earlier canonical-key work in CODING-15 established that the server key
  is preferred and that rows without one fall back to the sequence number. This
  Story preserves that contract and changes only where the identifier appears.
* The current row implementation is centralized in `PlanningRowView`, so this
  change should remain small and single-purpose rather than introduce another
  abstraction.