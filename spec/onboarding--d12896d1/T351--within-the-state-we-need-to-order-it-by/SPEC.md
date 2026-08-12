# T351 — Non-positional transitions append work items to the destination bottom

## Problem Statement

When a work item changes workflow state today, it keeps the same fractional
rank it had in the source state. The destination grouping still orders by that
rank, so the moved item can appear at an arbitrary-looking position among the
items already there. A person who changes a state, or watches an agent change
one, can lose track of the item because its transition landing position does
not communicate that it just arrived.

The desired behavior is about where an item lands when it enters a state, not
about imposing a permanent chronological sort. Existing work-item order and
manual drag-to-reorder remain meaningful and must not be replaced by a
state-entry timestamp or a second ordering system.

## Solution

After a successful non-positional workflow transition, place the work item
immediately after the destination state's current last active item by assigning
it a new fractional rank. The transition and rank change commit atomically.
The most recently transitioned item therefore lands at the bottom, while people
may still manually reorder it afterward.

An explicit cross-state drag remains positional: the existing state change is
followed by the reorder at the chosen drop seam, and that final drop position
wins. Existing items are not rearranged merely because another item arrives,
an empty destination causes no rank change, and no historical data is backfilled.

## User Stories

1. As a person moving a work item with a state picker, I want it to appear at the bottom of the destination state, so that I can immediately find the item I just moved.
2. As a person moving a work item from its detail panel, I want the same transition landing position as every other non-positional state control, so that behavior does not depend on which Studio control I used.
3. As a person watching an agent advance a work item, I want the item to land at the bottom of its destination state, so that newly arrived work is easy to distinguish.
4. As an API client changing a workflow state, I want the canonical transition service to assign the landing rank, so that I cannot accidentally bypass the ordering rule.
5. As an MCP client changing a workflow state, I want the same rank assignment as a human-origin write, so that origin affects transition authorization but not landing position.
6. As a person dragging a work item across states, I want the item to remain exactly where I dropped it, so that an automatic append does not override an explicit placement.
7. As a person manually reordering items within a state, I want that order to remain stable when a different item arrives, so that my scheduling decisions are preserved.
8. As a person manually reordering a newly arrived item, I want my later drag to take precedence, so that append-to-bottom is only an insertion default.
9. As a person moving an item out of a state and later moving it back, I want it to return at that state's current bottom, so that its new arrival is represented consistently.
10. As a person viewing different rank-driven state groupings, I want one work-item order to produce the same transition landing behavior, so that Board columns, status sections, and Story Map cells do not disagree.
11. As a person using a non-state planning view, I want the transition to disturb the project-global order as little as possible, so that unrelated backlog positions remain stable.
12. As a person moving an item into an empty state, I want the item to keep its existing rank, so that the system avoids a write that cannot change its visible position.
13. As a person with existing planning data, I want all current ranks to remain untouched when this feature ships, so that deployment itself does not reorder anything.
14. As a person moving an item through an invalid or human-only transition, I want both its state and rank to remain unchanged, so that rejected operations have no partial side effects.
15. As a person observing live updates, I want the authoritative state and rank to arrive together, so that the item does not settle in one position and jump after a refetch.
16. As a person moving two items into the same state at nearly the same time, I want both transitions to receive a deterministic, distinct landing order, so that concurrency does not create duplicate arrival positions.
17. As a person working with archived or cancelled items, I want invisible items excluded from the destination's active bottom, so that hidden work does not determine where visible work lands.

## Implementation Decisions

* Keep fractional `rank` as the only work-item ordering authority. Do not add a
  current-state-entry timestamp, chronological sort mode, or other persisted
  ordering field.
* Implement transition landing in the backend workflow transition capability,
  after the graph and origin gates have accepted the move. Every non-positional
  state write already crosses this seam, including Studio state controls,
  unlabelled REST writes, and agent-origin MCP writes.
* Perform destination lookup, rank calculation, state assignment, archive or
  unarchive side effects, and persistence inside one database transaction. A
  rejected transition must not calculate or persist a new rank.
* Serialize transition landing calculations on the project ordering boundary
  before reading neighbor ranks. Two concurrent successful transitions into
  one state must observe one another in commit order and must not calculate the
  same fractional key.
* Define the destination tail from active task work items in the same project
  and target workflow state, excluding the moving item and archived items. Do
  not restrict the query by module, parent, or issue type: placing after the
  complete active state grouping also places the item after every visible
  subset of that grouping.
* When the destination has an active last item, generate the moved item's rank
  immediately after that item and before the next active task rank in the
  project-global task ordering. Use the existing fractional-key operation with
  the destination tail as the lower bound and its project-global successor as
  the upper bound. If there is no successor, use the open upper bound. This is
  the smallest rank movement that achieves the transition landing position;
  do not append at the global end merely for convenience.
* Keep module ordering outside this calculation. Module work items reuse the
  rank field for a separate project-owned ordering mode and are not valid task
  reorder neighbors.
* If the destination has no active task work items, preserve the moved item's
  existing rank. It is already the only item, so changing rank would have no
  user-visible effect.
* Cancellation continues to archive the transitioned subtree, and leaving a
  cancelled group continues to unarchive according to existing workflow rules.
  Archived rows do not act as destination-tail or successor candidates for
  visible transition placement.
* Preserve the existing cross-state drag protocol. Its state transition may
  initially receive the default bottom rank, but the successful follow-up
  reorder writes the explicit drop rank and is authoritative. Within-state
  drag reorder is unchanged.
* Preserve the existing work-item response contract. Rank is already part of
  the serialized work item, so the successful transition response must return
  the newly assigned rank together with the destination state and advanced
  change revision. No new request or response field is required.
* Reconcile Studio's optimistic state-only projection with the authoritative
  work item returned by the transition. Once the write succeeds, every cached
  rank-driven projection must consume that returned rank without waiting for a
  later collection refetch. Live consumers continue to use the existing change
  revision notification and authoritative item read.
* Keep rank as the common input to every supported state grouping. Do not add
  per-surface arrival arrays, client timestamps, or a special sort for one
  view. Manual ordering behavior and tie-breaking remain unchanged.
* Add no schema migration and perform no data migration or backfill. Existing
  work items retain their exact stored ranks; only successful transitions
  after deployment apply the rule.
* Keep the existing transition-landing glossary term and the accepted ADR as
  the architectural authority. No additional ADR is required for this change.

## Testing Decisions

A good test observes the committed transition contract or the rendered Studio
behavior. It should not assert that a private helper was called, duplicate the
fractional-key algorithm in test code, or depend on a particular component's
local state. Two seams are necessary and sufficient: the backend transition
boundary proves atomic ordering and concurrency, while the mounted Studio
acceptance harness proves that the authoritative rank produces the promised
visible landing and does not defeat explicit drag placement.

* Extend the backend workflow tests with several pre-ranked active items in the
  destination. Assert that a successful human-origin transition changes state
  and assigns a rank between the destination tail and the next active
  project-global task, leaving every other stored rank unchanged.
* Exercise the same transition with agent origin and assert identical landing
  behavior after authorization. Retain the existing origin-gate cases to prove
  that a human-only rejection leaves both state and rank unchanged.
* Cover an empty destination and assert that the state changes while the prior
  rank is preserved.
* Cover archived destination rows and a rank from a module work item, proving
  that neither determines the visible task landing bounds.
* Add a transactional concurrency case in which two work items enter the same
  non-empty destination at the same time. Both writes must commit with distinct
  ranks, and their final order must match serialized commit order.
* Extend the HTTP transition test to assert that the successful work-item
  response carries the new rank along with the destination state. This is the
  public seam shared by Studio and the MCP-backed status writer.
* Add or update a numbered Studio acceptance case in the existing mounted
  Stories/Tasks-pane harness. Move an item through the state picker, return a
  server-assigned landing rank, and assert that the row appears at the bottom
  of the destination section without changing the relative order of its
  existing rows.
* In that acceptance area, cover a cross-state drag and assert the ordered
  state-change then reorder requests, followed by the row remaining at the
  explicit drop seam after both authoritative responses. Retain the current
  within-state drag case as regression coverage.
* Where the active Board or Story Map projection has dedicated acceptance
  coverage, reuse the same ranked fixture to assert the same destination
  landing. Do not add separate client ordering logic merely to make those
  assertions pass.
* Update the numbered overhaul acceptance matrix and its gate count, then run
  the affected backend workflow/API suites and
  `npm run test:overhaul --workspace @worktracker/studio` before implementation
  handoff.

## Out of Scope

* Creating implementation tickets, child work items, or a dependency graph in
  the Spec stage.
* Strict chronological sorting within a workflow state.
* Persisting or exposing a state-entry timestamp or transition-history model.
* Reordering or backfilling work items that are already in a state when the
  feature ships.
* Removing, disabling, or redesigning manual within-state drag reorder.
* Changing the explicit placement semantics of cross-state drag-and-drop.
* Changing workflow graphs, transition authorization, state-entry auto-start,
  agent launch behavior, or cancellation/archive policy.
* Redesigning Board, Tasks pane, Story Map, backlog, or other planning surfaces.
* Changing the Tauri/webview boundary, generated SDK shape, or public work-item
  schema.
* Making unrelated rank writers globally transactional beyond what is needed
  to serialize transition landing calculations.

## Further Notes

* **Transition landing position** means the default insertion point after a
  non-positional state change. It is not a permanent sort policy. A later
  manual reorder remains authoritative until the item transitions again.
* The accepted design is recorded in the WorkTracker ADR “Transitions append
  to the bottom of the destination state via rank, not a timestamp.”
* The transition response already has enough information to reconcile Studio:
  the implementation risk is ensuring the authoritative returned rank replaces
  the optimistic state-only value promptly, not designing another transport.
