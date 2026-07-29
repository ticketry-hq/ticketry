# CODIN-1487 — Reusable drag-and-drop for workflow ticket moves and reordering

Status: refined
Story: CODIN-1487
Module: Ticketry

## Problem Statement

Moving a ticket in Studio means opening it and changing its workflow state from
a menu, and there is no way at all to change a ticket's position within its
state. The Tasks pane shows tickets grouped under workflow-state headers in a
definite order, but that order is read-only — the user can see the sequence they
want to change and cannot touch it.

There is also no shared way to build this. The only drag-and-drop in the
application lives in the workflow State Catalog settings surface: it tracks a
single dragged id, drops onto whole rows without distinguishing above from
below, and draws no indication of where the item will land. Anyone adding a
second draggable surface — tickets now, module tabs later — starts from nothing
and invents their own drag bookkeeping, so every surface behaves slightly
differently.

Two concrete gaps follow from that:

- A user who wants a ticket higher in its column has no gesture for it.
- A user who wants a ticket in a different column must open the ticket, find
  the state control, and pick a state — losing their place in the tree, and
  with no control over where the ticket lands in the destination.

## Solution

The user picks up a ticket row in the Tasks pane and drags it. As the pointer
moves, a thin accent-coloured line shows the exact position the ticket will
occupy if released — between two tickets in its own state, or between two
tickets in a different state, or at the top of a state that is empty or
collapsed. Nothing else moves while dragging: no gap opens, no row slides, no
animation plays. The line simply marks the seam.

Releasing places the ticket there immediately. If it stayed in its own workflow
state, only its position changes. If it crossed into another state, its state
changes too, and then its position within that state is applied. If the workflow
forbids that transition, the tree returns to exactly how it looked before the
drag and the user is shown the reason the workflow gave.

A ticket with subtasks collapses while it is being dragged, so the user moves a
single row rather than a block, and re-expands when the drag ends. A ticket that
was already collapsed stays collapsed. The subtasks themselves never move
between states or change parent — they belong to their ticket and follow it.

Underneath, the drag behaviour is a small shared primitive that knows only about
an axis, a set of targets, and whether the pointer is on the near or far side of
the target it is over. It has no knowledge of tickets, workflow states, or rank.
The Tasks pane supplies the vertical meaning; a future module tab strip can
supply horizontal meaning without changing the primitive.

## User Stories

1. As a Studio user, I want to drag a ticket to a different position within its
   workflow state, so that I can express priority without opening the ticket.
2. As a Studio user, I want to drag a ticket into a different workflow state, so
   that I can advance work with one gesture instead of a menu round trip.
3. As a Studio user, I want to choose *where* in the destination state a ticket
   lands, so that a cross-column move and a prioritisation are a single action.
4. As a Studio user, I want a line showing exactly where the ticket will land
   before I release, so that I never have to drop-and-check.
5. As a Studio user, I want that line to be unambiguous about which side of a
   ticket I am on, so that "just above this one" and "just below this one" are
   distinct outcomes I can aim for.
6. As a Studio user, I want the rows around the pointer to stay still while I
   drag, so that the target I am aiming at does not move away from me.
7. As a Studio user, I want no animation on the transition, so that the result
   is immediate and I can chain several moves quickly.
8. As a Studio user, I want the ticket I dragged to be selected after the drop,
   so that the detail pane follows the thing I just acted on.
9. As a Studio user, I want a dragged ticket's subtasks to fold away for the
   duration of the drag, so that I am moving one row rather than an unwieldy
   block.
10. As a Studio user, I want an expanded ticket to be expanded again when the
    drag ends, so that dragging does not silently reorganise my tree.
11. As a Studio user, I want a ticket that was collapsed before the drag to
    remain collapsed after it, so that the gesture has no memory of its own.
12. As a Studio user, I want a moved ticket's subtasks to stay attached to it in
    the same order, so that moving a parent never scatters its children.
13. As a Studio user, I want to drop a ticket onto a workflow state that
    currently holds nothing, so that empty columns are reachable destinations.
14. As a Studio user, I want to see every configured workflow state in the pane
    even when it is empty, so that the set of destinations is always visible.
15. As a Studio user, I want to drop a ticket onto a collapsed workflow state,
    so that I can file work into a section I keep folded away.
16. As a Studio user, I want dropping onto a collapsed state to leave it
    collapsed, so that a move does not force me to re-tidy the pane.
17. As a Studio user, I want to drop a ticket at the very top or the very bottom
    of a state, so that the extremes of the order are reachable.
18. As a Studio user, I want the drop indicator to appear only at positions the
    ticket can actually occupy, so that the preview never promises a placement
    the system will not honour.
19. As a Studio user, I want hovering over a subtask row to resolve to a
    position relative to that subtask's ticket, so that there are no dead zones
    inside an expanded ticket.
20. As a Studio user, I want the reordering I perform to survive a reload, so
    that the order I set is the order I return to.
21. As a Studio user, I want the tree to update the moment I release rather than
    after a server round trip, so that the interface keeps pace with me.
22. As a Studio user, I want a rejected workflow transition to restore the tree
    exactly as it was, so that a refused move leaves no trace.
23. As a Studio user, I want to be told why a transition was refused in the
    workflow's own words, so that I can tell a misconfigured workflow from a
    mistake of mine.
24. As a Studio user, I want a ticket whose state change succeeded but whose
    placement failed to keep its new state, so that a partially applied move
    never silently reverts work the system already accepted.
25. As a Studio user, I want to be told when placement specifically failed, so
    that I know the ticket arrived but its position did not.
26. As a Studio user, I want the drop indicator to disappear whenever the drag
    ends for any reason, so that no stray line is left on screen.
27. As a Studio user, I want to cancel an in-progress drag and have nothing
    change, so that starting a drag is not a commitment.
28. As a Studio user, I want the synthetic Scratch row to be undraggable and
    unreachable as a destination, so that a workspace affordance is not mistaken
    for a ticket.
29. As a Studio user, I want subtask rows not to start a drag, so that I cannot
    accidentally pull a child out of its parent.
30. As a Studio user, I want drag disabled while I am filtering the story list,
    so that I am never shown a position computed from rows I cannot see.
31. As a Studio user, I want clearing the search filter to restore dragging
    without disturbing what is expanded or collapsed, so that filtering is
    non-destructive.
32. As a Studio user, I want a second drag of a ticket suppressed while its
    previous move is still being written, so that I cannot race two moves of the
    same ticket against each other.
33. As a Studio user, I want dropping a ticket back where it started to do
    nothing at all, so that an aborted-in-spirit drag costs nothing.
34. As a Studio user, I want a move performed elsewhere while my move is in
    flight to win if it is newer, so that concurrent edits do not resurrect
    stale positions.
35. As a Studio user, I want to navigate away mid-move without the response
    corrupting the tree I have navigated to, so that moves are scoped to where I
    made them.
36. As a Studio developer, I want a single shared drag primitive, so that a new
    draggable surface does not mean a new drag implementation.
37. As a Studio developer, I want that primitive to take an axis, so that a
    horizontal tab strip and a vertical ticket list can share it unchanged.
38. As a Studio developer, I want the primitive to be free of any ticket,
    workflow-state or rank concept, so that a consumer with no such concepts can
    still use it.
39. As a Studio developer, I want the conversion from "hovering here" to
    "between these two tickets" to be a pure function, so that its boundary
    cases can be tested without rendering anything.
40. As a Studio developer, I want the ticket's visible order to be derived from
    an explicit rank rather than the order the server happened to serialise, so
    that optimistic placement has something real to compute against.
41. As a Studio developer, I want the drag-time collapse to bypass the persisted
    expansion setting, so that dragging never issues a settings write.
42. As a Studio developer, I want the existing State Catalog interaction left
    untouched by this story, so that a working settings surface is not put at
    risk by an abstraction it does not yet need.

## Implementation Decisions

### The shared primitive

- A headless drag/drop controller is added to the shared layer, built on native
  HTML5 drag events. No third-party drag library is introduced. Native events
  are already the codebase's only precedent, give escape-to-cancel and the drag
  image for free, and match a brief that explicitly excludes animation.
- The controller is configured with an **axis** — vertical or horizontal — and
  is otherwise generic. It owns: the typed payload of the current drag,
  serialisation and validation of that payload across the drag boundary, the id
  of the target currently under the pointer, the **near/far intent** derived
  from the pointer's position within that target's bounding box along the
  configured axis, an optional disabled state, and cleanup on every drag
  termination path.
- The axis is an explicit parameter, not inferred from element geometry.
  Inference is unreliable for square or wrapping targets and makes the resolved
  intent hard to assert in tests.
- The controller exposes prop-getters for drag sources and drop targets, stable
  enough to be handed to memoised rows, plus the resolved target and intent. It
  does **not** render an indicator: positioning a line correctly depends on the
  consumer's layout and stacking context, which the shared layer cannot see.
- The controller contains no reference to tickets, workflow states, rank, or any
  WorkTracker entity. This is the constraint that makes the future horizontal
  module-tab consumer possible without a rewrite.
- The existing workflow State Catalog drag interaction is **not** migrated in
  this story. It works, it is a settings-only surface, and migrating it would
  put an existing behaviour at risk to prove an abstraction that the ticket
  consumer already proves.

### What is draggable, and what a drag can change

- Only module-root tickets are drag sources. Subtask rows are neither sources
  nor drop targets. The synthetic Scratch row is neither.
- A drop changes the dragged ticket's workflow state and/or its rank. Nothing
  else. Parentage is never changed by a drag.
- Descendants of a moved ticket keep their own parent, workflow state and rank,
  and continue to render beneath the ticket. They move visually with it and are
  not rewritten.
- Subtask reordering among siblings is not part of this story. A subtask's
  visible order is parent-scoped, so a drop into a workflow-state section would
  imply either reparenting or detaching the row from the section that owns its
  root.

### Drop resolution

- The unit of placement is a **root block**: a root ticket together with its
  currently visible descendants. Insertion positions are the seams between
  consecutive root blocks, never between two subtask rows.
- Hovering anywhere inside a root block — the ticket row itself or any visible
  descendant of it — resolves to *before that block* or *after that block*,
  chosen by whether the pointer is in the near or far half of the block along
  the drag axis. This guarantees the indicator only ever marks a position the
  reorder contract can express, and leaves no dead zone inside an expanded
  ticket.
- Every configured workflow state renders a state header at all times, including
  states holding no tickets. Empty state sections are currently omitted
  entirely, which makes them unreachable as destinations; that omission is
  removed. Scratch keeps its existing synthetic section.
- A state header is a drop target whether its section is expanded, collapsed or
  empty. Dropping on a header places the ticket at the head of that section's
  visible order and does **not** expand a collapsed section.
- Neighbour resolution considers module-root tickets in the destination state
  only, and always excludes the dragged ticket itself.
- The conversion from a visible hover — target block plus near/far intent — into
  the persistence layer's neighbour pair is a **pure function**, separate from
  both the primitive and the store. It is the single place that accounts for the
  presentation order being the inverse of canonical rank order.
- Self drops, no-op drops, malformed payloads, and drops with no selected
  project or module are ignored and issue no request.

### Ordering and optimistic placement

- Ticket summaries gain an explicit **rank**, carried through normalisation
  rather than discarded as it is today. Each state section sorts by rank
  descending instead of reversing a list whose order is an artefact of
  serialisation. This makes the existing unexplained reversal legible and gives
  optimistic placement a real value to compute against.
- Optimistic rank is computed with the existing fractional-rank helper already
  used by the backlog surface. The persistence call still sends neighbour ids,
  not the computed rank — the server remains authoritative for the stored value.
- The move is expressed as a single command on the module task store, applying
  the complete intended placement — state and rank — optimistically before any
  request is issued, and updating every loaded copy of the ticket.

### Persistence and failure

- There is no combined state-and-rank write. A cross-state move is two requests
  and the ordering of those two requests is a decision, not an accident.
- A same-state move is a single reorder request.
- A cross-state move performs the workflow transition **first**, and reorders
  only once the transition has been accepted. Ranking first would leave a stray
  rank change behind when a transition is refused, and would briefly rank a
  ticket among neighbours of a column it does not belong to.
- **Transition refused:** restore the pre-drag snapshot — unless a newer
  authoritative revision has already reconciled that ticket — and surface the
  workflow gate's own structured reason. The gate's message is used verbatim
  rather than a client-composed one.
- **Transition accepted, reorder failed:** the new state is authoritative and is
  kept. No compensating reverse transition is attempted: the reverse move may
  itself be forbidden by the workflow, which would strand the ticket and produce
  a misleading error. The module tree is refreshed to obtain the server's real
  rank, and the failure is reported as a placement failure specifically.
- **Same-state reorder failed:** restore the pre-drag ordering unless a newer
  authoritative copy exists, and surface the server error.
- The Tasks pane holds no copy of the workflow transition graph — it is fetched
  only by the settings surface. Cross-state drops are therefore **not**
  pre-validated on the client: every real state header and row accepts a drop
  and shows a normal indicator, and legality is decided by the gate. Preloading
  the graph would introduce a second source of truth that can drift from the
  configured workflow and would need invalidating whenever settings change.
- Existing load-generation, selected-project/module and state-revision guards
  remain authoritative when navigation or a status feed update races a move.
- While a ticket's move is in flight, another drag of that ticket is suppressed.

### Interaction detail

- The drop indicator is a two-pixel, absolutely positioned overlay pinned to the
  insertion seam. It takes no space in flow, so no row shifts as the pointer
  moves and no empty slot is opened at the prospective landing site. There is no
  transition or animation on it, or on the resulting move.
- The indicator uses the theme accent colour. This is a deliberate departure
  from the "red line" in the original request: accent keeps the indicator inside
  Studio's existing visual language, and it is distinguishable from selection
  and focus treatments by form — a two-pixel seam between rows rather than a
  row-filling background.
- Exactly one indicator exists at any moment. It is cleared on drop,
  cancellation, escape, navigation away, and error.
- If the dragged ticket is expanded, its descendant rows are hidden for the
  duration of the drag and reappear when the drag ends, on every termination
  path. A ticket that was collapsed stays collapsed throughout.
- That drag-time collapse is a **transient view-model override**, not a toggle
  of the persisted expansion state. Expanded subtask ids are persisted per
  module to the settings store on every real toggle; routing the drag-time
  collapse through that path would issue two settings writes per drag and would
  leave a ticket collapsed if a drag were interrupted mid-flight.
- Drag is disabled entirely while the story search query is non-empty. Under a
  filter, non-matching roots are removed and branches auto-expand, so the row
  above a ticket is not necessarily its predecessor: the indicator would promise
  a placement the reorder call cannot honour, and the rank written would be
  relative to neighbours the user cannot see. Clearing the query restores
  dragging without altering expansion or collapsed sections.
- The dropped ticket becomes the selected ticket, and remains selected through a
  rollback — a refused move returns the ticket to its previous position, where
  it is still a real ticket worth having selected.
- Keyboard-initiated reordering and touch gestures are not part of this story.
  Existing keyboard navigation of the task tree is unchanged and must not
  regress.

### Backend

- No backend change. The existing reorder endpoint and its neighbour contract,
  the existing state transition endpoint and its workflow gate, and the existing
  fractional-rank implementation are all sufficient. No schema change, no new
  endpoint, no rank rebalance work.

## Testing Decisions

A good test here asserts what a user or a caller can observe — the resulting
order, the resulting state, the request that was issued, what is on screen — and
never how the drag bookkeeping is stored internally. Three seams, preferring the
highest point at which each behaviour is fully expressible.

### Seam 1 — the visible-hover to neighbour-pair resolver (pure function)

The single highest-value seam: every ordering edge case is expressible without
rendering. Covered cases:

- Insertion at the top, in the middle, and at the bottom of a state section.
- Both extremes of an inverted presentation order relative to canonical rank
  order.
- Self drop and no-op drop, which must resolve to no move.
- Hovering a subtask row, resolving to a position relative to its root block.
- A destination state that is empty, and a header drop, both resolving to a
  head-of-section placement.
- Exclusion of the dragged ticket from its own neighbour pair.

### Seam 2 — the module task store's move command

Covers persistence semantics and every failure branch:

- Same-state move: success, and failure with restoration of prior ordering.
- Cross-state move: success, asserting the transition is issued before the
  reorder.
- Transition refused: pre-drag snapshot restored, gate reason surfaced.
- Reorder failed after an accepted transition: new state retained, no reverse
  transition issued, refresh performed, placement failure reported.
- A newer authoritative revision arriving mid-flight wins over a rollback.
- A module or project change mid-flight does not let the response corrupt the
  newly loaded tree.

Prior art: the backlog surface's existing optimistic status-move and reorder
tests already establish the shape for optimistic apply, reconcile, and
rollback-unless-newer, and should be followed rather than reinvented.

### Seam 3 — the Tasks pane interaction

Component-level, asserting only observable interaction:

- Indicator placement for near/far halves of a root block, and for a hovered
  subtask row.
- Drops onto expanded, collapsed and empty state headers, including that a
  collapsed section is not expanded by a drop.
- Empty states rendering a header at all.
- Drag-time collapse and restoration of an expanded ticket, and that a collapsed
  ticket is unaffected.
- Descendants remaining attached to a moved ticket.
- Scratch and subtask rows refusing to start a drag.
- Indicator cleared on drop, cancel and error.
- Every drag affordance disabled while search is active, and restored when the
  query is cleared.

The shared primitive additionally gets focused unit tests for payload rejection,
near/far intent along each axis, disabled state, and cleanup on each drag
termination path — the axis-neutrality claim is only true if it is asserted on
both axes.

Existing task-tree hydration and story-search tests are **extended**, not
replaced: their current assertions about hydration, selection, expansion,
collapsed sections and search behaviour must continue to hold.

## Out of Scope

- Reparenting tickets by drag, and reordering subtasks among their siblings.
- Bulk-moving a ticket's descendants into the parent's destination state.
- Horizontal drag consumers: module reordering and module tab reordering. The
  primitive is built to serve them and unit-tested on the horizontal axis, but
  no horizontal production surface ships here, and no module-order persistence
  contract is designed.
- Migrating the workflow State Catalog onto the shared primitive.
- Keyboard-initiated reordering, screen-reader announcements for drag, and touch
  or pointer-based drag gestures.
- Client-side pre-validation of workflow transitions, and any drag-time loading
  of the transition graph.
- Cross-project and cross-module drag.
- Any backend change: no new or combined endpoint, no schema change, no rank
  rebalance redesign.
- Animation or transition on the indicator or the move.

## Further Notes

- CODIN-1468 covered overlapping ground and is archived. Its conclusions on
  eligibility, cross-state write ordering, and failure handling were re-derived
  here and hold. This story adds the axis-neutral primitive contract, the
  root-block drop model, the explicit rank carried on ticket summaries, the
  drag-time collapse, and the no-reflow indicator — and, unlike CODIN-1468,
  leaves the State Catalog alone.
- The original request specified a red line. The indicator ships in the theme
  accent instead, decided during refinement; the "no empty slots" and "no
  animation" constraints are honoured literally.
- The presentation order of each state section is the inverse of canonical rank
  order. Today that inversion is an unexplained list reversal. Carrying an
  explicit rank turns it into a stated sort, and confines the
  visible-to-canonical translation to the pure resolver — which is why that
  resolver's inverted-order boundary cases are the most important tests in the
  story.
- The two-request cross-state move is the main structural risk. It is contained
  by making the ordering of the two writes explicit and by refusing to
  compensate a completed transition. If partial-failure reports become common in
  practice, the follow-up is a combined atomic state-and-rank endpoint, which
  would remove the failure class rather than manage it.
