# T354 — Persistent canonical module ordering

Status: Spec complete
Story: WorkTracker #354 (`17fda93d-a36a-4070-bfee-370c26a11ba8`)
Date: 2026-08-09

Related decisions: [Grill decisions](DECISIONS.md) · [ADR 0011](../../../studio/docs/adr/0011-manual-module-order-replaces-recency.md)

## Problem Statement

Ticketry currently orders modules by their most recent agent activity. Modules
without activity retain the backend's order, and that one recency projection is
shared by the sidebar, Module tab strip, backlog grouping, module pickers, and
keyboard position shortcuts. The consistency is useful, but the order moves as
agents work and cannot express the team's intended project structure.

Users need to arrange a project's modules deliberately and trust that the
arrangement will remain stable for every user, device, and module surface.
Introducing manual ordering must not make the surfaces disagree, cause a jump
on the first drag, or change the existing recency behavior for projects whose
modules have never been manually arranged.

## Solution

A project begins in automatic mode, where its canonical module order remains
newest-agent-activity-first. Dragging a module in either the sidebar or the
horizontal Module tab strip gives the project a Manual module order. The first
drag starts from the exact Canonical module order visible to the user and
applies the requested move, so no unrelated module jumps.

From that point onward, the persisted Manual module order is the project's
Canonical module order everywhere. Agent activity may still be displayed, but
it never rearranges a manually ordered project. The order is shared rather than
personal, later drags persist through the existing server-owned fractional-rank
operation, and a newly created Module always enters at the front. There is no
reset to automatic ordering in this version.

## User Stories

1. As a Ticketry user, I want to drag a Module in the sidebar, so that I can arrange the project from its primary navigation surface.
2. As a Ticketry user, I want to drag a Module in the Module tab strip, so that I can arrange modules while working in the Edit view.
3. As a Ticketry user, I want a drop near the top half of a sidebar row to place the dragged Module before that row, so that vertical placement follows the visible drop position.
4. As a Ticketry user, I want a drop near the bottom half of a sidebar row to place the dragged Module after that row, so that vertical placement is predictable.
5. As a Ticketry user, I want a drop near the left half of a Module tab to place the dragged Module before that tab, so that horizontal placement follows the visible drop position.
6. As a Ticketry user, I want a drop near the right half of a Module tab to place the dragged Module after that tab, so that horizontal placement is predictable.
7. As a Ticketry user, I want the active drop position to be visibly indicated, so that I can see where the Module will land before releasing it.
8. As a Ticketry user, I want cancelling or making a no-op drag to leave the order unchanged, so that an accidental gesture does not write a meaningless reorder.
9. As a Ticketry user, I want the sidebar and Module tab strip to update together after either one is used to reorder, so that both surfaces immediately agree.
10. As a Ticketry user, I want backlog grouping to reflect the same Canonical module order, so that planning views do not reinterpret my arrangement.
11. As a Ticketry user, I want module pickers to reflect the same Canonical module order, so that choosing a Module is consistent with navigation.
12. As a keyboard user, I want module position shortcuts to use the Canonical module order, so that a numbered position identifies the same Module shown at that position.
13. As a Ticketry user, I want the first drag to begin from the recency order currently on screen, so that enabling Manual module order does not shuffle unrelated modules.
14. As a Ticketry user, I want agent activity to stop reshuffling a manually ordered project, so that the arrangement stays stable while work runs.
15. As a Ticketry user, I want projects I have never reordered to retain newest-activity-first behavior, so that this change does not remove the useful automatic default.
16. As a Ticketry user, I want an activity lookup failure in an automatic project to retain the backend fallback order, so that the module list remains usable and deterministic.
17. As a Ticketry user, I want a newly created Module to appear at the front in an automatic project, so that new project structure is immediately visible even before it has agent activity.
18. As a Ticketry user, I want a newly created Module to appear at the front in a manually ordered project, so that creation has one consistent placement rule.
19. As a Ticketry user, I want the newly created Module's existing selection and setup behavior to remain unchanged, so that front placement does not disrupt the creation flow.
20. As a Ticketry user, I want my Manual module order to survive reloads and desktop restarts, so that it is durable project data rather than local UI state.
21. As a teammate, I want another user's reorder to become the same project order for me, so that the team shares one arrangement.
22. As a user on another device, I want to read the same Manual module order, so that ordering is not tied to a browser or profile.
23. As a Ticketry user, I want later module drags to change only the moved Module's relative rank, so that unrelated concurrent arrangements are not rewritten.
24. As a Ticketry user, I want concurrent reorders to resolve through the server's established last-write-wins rank behavior, so that the result is deterministic without a separate merge workflow.
25. As a Ticketry user, I want a failed reorder to restore the last authoritative order and report the failure, so that the UI does not pretend an unpersisted arrangement succeeded.
26. As a Ticketry user, I want another reorder gesture disabled while the current reorder is being committed, so that rapid local drags cannot race one another.
27. As a Ticketry user, I want Module selection, horizontal scrolling to the selected tab, lifecycle badges, and sidebar focus styling to survive reordering, so that ordering does not regress existing navigation cues.
28. As a Ticketry user, I want the add-Module button at the left edge of the Module tab strip, so that creation has the agreed fixed position rather than moving with the module list.
29. As a Ticketry user, I want the sidebar's existing add-Module affordance to remain after its list, so that the tab-strip layout decision does not unnecessarily redesign the sidebar.
30. As a Ticketry user, I do not want drag handles added to pickers, backlog groups, or keyboard shortcuts, so that only the two agreed surfaces mutate module order.
31. As a Ticketry user, I do not want a reset-to-automatic control in this version, so that Manual module order remains a clear one-way project decision.
32. As a maintainer, I want every module consumer to continue reading one shared cached Canonical module order, so that surfaces cannot drift independently.
33. As a maintainer, I want first-drag initialization and the requested move committed atomically, so that a project cannot persist a partly seeded Manual module order.
34. As a maintainer, I want the existing Work-item reorder domain operation to remain the sole fractional-rank write path, so that module ordering does not add an undeclared sixth domain operation.
35. As an API consumer, I want the generated contract to expose the project's ordering mode and the first-drag baseline input, so that clients do not infer durable state from local history.
36. As a maintainer, I want user-visible module ordering covered at the Studio acceptance seam and persistence covered at the backend service/API seams, so that tests protect behavior rather than component wiring.

## Implementation Decisions

* Persist whether a project has acquired a Manual module order as an explicit,
  project-owned boolean with an automatic-mode default. Do not infer this
  one-way fact from cache state, agent activity, or the presence of ranks.
* Continue storing each Module's manual position in the unified Work item's
  existing fractional `rank`. Update the field's model documentation to cover
  both task-within-planning-context order and Module-within-project order.
* The migration adds the project ordering-mode field with a false default.
  Existing project and Module ranks need no data rewrite because ranks are
  ignored for Module ordering until the project's manual-mode flag is true.
* Expose the ordering-mode field through the canonical Project contract and
  regenerate the OpenAPI document and both supported SDKs. The Module contract
  does not need a duplicate project-mode field.
* Keep the canonical Module collection read as the only Module list route. For
  a manually ordered project it returns active Modules by ascending fractional
  rank with a deterministic identifier fallback. For an automatic project its
  stable backend fallback is newly created first, allowing inactive new Modules
  to enter at the front before Studio applies recency.
* In Studio's one Module query, consult the selected Project's ordering mode.
  Automatic projects fetch activity and apply the existing stable recency sort;
  manual projects use the server order directly and do not let activity
  participate in sorting. Every sidebar, tab, backlog, picker, and shortcut
  consumer continues to read that same cached array.
* Extend the existing Work-item reorder request rather than introducing a new
  route. It continues to accept the moved Work item and its before/after
  neighbors, and gains an optional complete `initial_order_ids` baseline for a
  Module's first manual drag.
* On an automatic project's first Module reorder, require the baseline to be
  the complete, duplicate-free set of its visible active Modules. Validate that
  every id belongs to that project and has Module level. Seed fractional ranks
  in the supplied visible order, apply the requested before/after move, and set
  the project to manual mode in one database transaction.
* Serialize first-drag initialization with a project-row lock. If a competing
  request has already enabled manual mode by the time the lock is acquired,
  ignore its stale initialization baseline and apply only that request's moved
  Module between the current neighbor ranks. This preserves per-Module
  last-write-wins behavior instead of replacing the winner's complete order.
* Once a project is manual, later reorders retain the existing fractional-rank
  behavior: validate same-project, same-level neighbors and write only the
  moved Module's new rank. A Module may never be ranked relative to a task Work
  item.
* Treat missing, incomplete, duplicated, foreign-project, archived-only, or
  task-containing first-drag baselines as validation failures. Treat inverted
  neighbor ranks as the existing reorder validation failure. Neither failure
  may enable manual mode or partially rewrite ranks.
* In automatic mode, create a Module with ordinary rank storage and rely on the
  Module collection's newest-created-first fallback. In manual mode, allocate
  the new Module a fractional rank before the current first active Module in
  the same transaction as creation.
* The reorder response remains the authoritative moved Work item. Studio also
  refreshes the Project and Module queries after settlement so the mode flag
  and complete server order converge together.
* Add one project-scoped Module reorder mutation in the projects feature. It
  computes the post-drop array and before/after neighbor ids from the shared
  cached order, supplies the pre-drop array as the possible first-drag
  baseline, optimistically replaces that one Module query, and retains the
  previous array for rollback.
* Disable Module drag sources while a reorder is pending. On failure, restore
  the prior cached order, refetch the authoritative Project and Module data,
  and surface the established mutation error treatment. On success, keep the
  optimistic order until the authoritative refetch settles.
* Reuse the existing axis-aware drag-and-drop controller with a Module-specific
  payload codec: vertical in the sidebar and horizontal in the Module tab
  strip. Reuse its near/far midpoint resolution, cancellation cleanup, payload
  validation, and disabled behavior instead of creating surface-specific drag
  implementations.
* Render a clear insertion indicator on the resolved near/far edge. Preserve
  existing click-to-select, focused-row, selected-tab, lifecycle-badge,
  scrolling, and coach-anchor behavior. Suppress the click that browsers may
  emit after a completed drag so the gesture does not unexpectedly change the
  selected Module.
* Move only the Module tab strip's add button to the fixed leftmost position.
  It is not draggable and does not participate as a drop target. Leave the
  sidebar add control in its current location after the module rows.
* Keep drag mutation controls out of backlog grouping, pickers, and keyboard
  position actions. Those surfaces reflect the shared order only.
* Preserve the route registry's five-domain-operation invariant: this feature
  broadens Work-item reorder semantics for Module-level Work items but does not
  add a sixth operation. Keep the HTTP adapter thin; validation, locking,
  initialization, rank allocation, and creation placement belong to focused
  Worktracker services.
* Keep the Tauri/webview boundary unchanged. Manual module ordering is ordinary
  Worktracker persistence plus Studio interaction and needs no native command
  or desktop-only state.
* Use the glossary terms **Canonical module order**, **Manual module order**,
  **Module tab strip**, **Work item**, and **Domain operation** consistently.
  ADR 0011 is the decision of record; no additional ADR is required by this
  implementation specification.

## Testing Decisions

A good test observes one Canonical module order through product or API
boundaries. Frontend tests should drag the rendered Module controls and inspect
what every mounted consumer shows; backend tests should call the public service
or HTTP operation and reload durable records. Tests should not assert React
component-local state, private helper calls, raw SQL, or duplicate the shared
drag controller's already-covered midpoint algorithm.

* Add the next numbered Studio acceptance case using the mounted Studio seam.
  Seed an automatic Project, Modules, and agent activity, then drag in the
  sidebar. Assert the pre-drag recency order becomes the baseline, the requested
  move appears immediately in both sidebar and Module tab strip, and the API
  receives the moved id, neighbor ids, and exact pre-drag baseline.
* In the same acceptance family, drag horizontally in the Module tab strip and
  assert the sidebar and a representative read-only consumer receive the same
  updated order. Assert near/far placement, drop indication, and that selection
  and lifecycle badges remain attached to the correct Module.
* Cover reorder pending, server rejection, and retry at the acceptance seam:
  drag sources disable while pending, a rejection restores the prior order and
  presents the established error feedback, and a successful retry converges to
  the authoritative response.
* Assert that an automatic project still reorders from changing activity while
  a manual project ignores the same activity change. Preserve the activity
  provider's failure-to-backend-order regression case.
* Extend Module-creation acceptance coverage for front insertion in automatic
  and manual modes, while retaining selected-Module and Module-folder behavior.
  Assert the Module tab strip add button is first and the sidebar add control
  remains after its rows.
* Extend the numbered overhaul matrix and gate count for the new user-visible
  acceptance case, and run the required overhaul test command before
  implementation handoff.
* Add backend service tests proving first-drag initialization validates the
  full visible Module set, writes ordered ranks and manual mode atomically, and
  rolls everything back for incomplete, duplicate, foreign, archived-only, or
  task-containing baselines.
* Add backend service tests proving subsequent manual drags change only the
  moved Module's rank, reject cross-project and cross-level neighbors, and
  preserve the established fractional-key guarantee that midpoint insertion
  does not require a runtime rebalance.
* Add a concurrency-focused service test in which two first-drag requests
  serialize on the Project: one seeds manual mode, and the later request moves
  only its Module against the now-current ranks.
* Add API tests proving automatic Module reads use newest-created-first fallback,
  manual reads use persisted rank order, the reorder contract accepts the
  optional first-drag baseline, and a fresh read after reorder returns the same
  order.
* Extend Module service/API tests proving creation enters at the front in both
  ordering modes and keeps the Project in its existing mode.
* Update route-registry and OpenAPI contract tests, regenerate both SDKs, and
  retain the assertion that the domain-operation inventory contains exactly
  the same five routes.
* Add a migration test proving existing Projects default to automatic mode and
  their existing Module rank values do not change.
* Run the affected backend service/API/migration tests, Studio acceptance and
  drag-controller tests, Studio typecheck, generated-contract checks, and
  `npm run test:overhaul --workspace @worktracker/studio` as proportional
  implementation validation.

## Out of Scope

* Creating implementation tickets, child work items, dependency edges, or an
  execution graph during the Spec stage.
* A reset-to-automatic action, two-way ordering-mode toggle, or automatic
  expiry of Manual module order.
* Per-user, per-profile, per-device, or per-surface module orders.
* Pinning, favorites, folders, sections, nested Modules, or arbitrary grouping
  within the Module list.
* A hybrid order in which active Modules float above a manual base order.
* Reordering from backlog groups, module pickers, keyboard shortcuts, Settings,
  or any surface other than the sidebar and Module tab strip.
* Keyboard commands or buttons that mutate module order. Existing keyboard
  position shortcuts continue to consume the order but do not edit it.
* Touch-specific drag interaction beyond what the existing shared drag system
  supports.
* Changing task-within-column ordering behavior or creating a second rank field
  dedicated to Modules.
* Adding another Worktracker Domain operation, overlapping Module list route,
  native Tauri command, or client-local persistence mechanism.
* Changing how agent activity is calculated, which run states count as
  activity, or how Module activity badges are presented.
* Reordering archived Modules or adding an unarchive workflow.

## Further Notes

* The critical invariant is that every surface receives one Canonical module
  order. The reorder-capable surfaces are merely two controls over that shared
  project fact, not owners of separate arrays.
* The first-drag baseline is necessary because automatic ordering includes
  run activity that Worktracker does not own. Sending the visible order lets
  the backend freeze exactly what the user saw before applying the move.
* The explicit project mode makes the one-way decision durable even if Modules
  are later archived and prevents historical rank backfills from accidentally
  opting existing Projects into manual ordering.
* A future reset can clear the manual-mode flag without changing this v1 model;
  defining its permissions, concurrency behavior, and UI is deliberately
  deferred.
