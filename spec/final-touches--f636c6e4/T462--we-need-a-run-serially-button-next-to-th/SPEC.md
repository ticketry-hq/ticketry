# CODING-462 — Run a subtree serially

## Problem Statement

Ticketry can run an eligible work item's dependency subtree, but the current
subtree campaign launches every eligible direct child at the same time. That is
useful for maximum parallelism, but it is unsuitable when several coding agents
would contend for one checkout, shared development state, or the user's
attention.

Users currently need an external script or repeated manual launches to keep a
subtree to one live agent. That workaround is not a durable graph-run mode, is
not available beside the existing Studio action, and does not give Ticketry one
authoritative rule for choosing among several ready tickets.

## Solution

Add a **Run serially** action beside **Run subtree** in the selected work
item's Details surface. It starts the same dependency-subtree campaign over the
same direct children and dependency gates, but permits at most one live agent
launch from that campaign at a time.

When several unlaunched children are eligible, the campaign selects the child
with the lowest WorkTracker ticket sequence number. Ticket UUID is the stable
tie-breaker. The campaign advances only after the previously launched child is
satisfied and its agent run and terminal are no longer live. Work-item state and
agent termination may arrive in either order; whichever arrives second causes
the campaign to re-evaluate.

Serial execution is automatically available anywhere the existing
subtree-run capability is enabled. It has no independent workflow setting and
cannot be disabled separately in this release. The existing parallel **Run
subtree** behavior remains available.

## User Stories

1. As a Ticketry user, I want a Run serially action beside Run subtree, so that
   I can choose bounded execution without leaving the work-item Details
   surface.
2. As a Ticketry user, I want Run serially to use the same subtree as Run
   subtree, so that choosing a scheduling mode does not change which work is in
   the campaign.
3. As a Ticketry user, I want a serial campaign to launch no more than one live
   agent at a time, so that subtree work does not contend concurrently.
4. As a Ticketry user, I want the lowest-numbered eligible ticket launched
   first, so that the order is deterministic and easy to predict.
5. As a Ticketry user, I want the next lowest-numbered ticket selected whenever
   several tickets become eligible together, so that ordering remains stable
   throughout the campaign.
6. As a Ticketry user, I want blockers to gate serial launches exactly as they
   gate parallel subtree launches, so that serial mode cannot bypass dependency
   truth.
7. As a Ticketry user, I want blockers outside the selected subtree to remain
   authoritative, so that a narrower graph view cannot launch work too early.
8. As a Ticketry user, I want completed, Review, cancelled, and archived work
   to satisfy dependencies exactly as it does for Run subtree, so that the two
   modes share one definition of readiness.
9. As a Ticketry user, I want serial execution to wait when the current ticket
   reaches Review before its agent exits, so that two agents are never live at
   once.
10. As a Ticketry user, I want serial execution to wait when an agent exits
    before its ticket becomes satisfied, so that a failed or unfinished ticket
    is not silently skipped.
11. As a Ticketry user, I want the campaign to continue when state satisfaction
    and agent termination have both occurred in either order, so that event
    timing does not stall valid work.
12. As a Ticketry user, I want an inactive unfinished launch to stall the
    campaign until I explicitly revive it, so that Ticketry does not guess
    whether failed work should be skipped or retried.
13. As a Ticketry user, I want repeating Run serially to retain the existing
    subtree-revival behavior, so that an inactive unfinished child can be
    retried without resetting dependencies or completed work.
14. As a Ticketry user, I want a repeated request refused while the campaign
    still has live agent work, so that double-clicks and concurrent requests do
    not create duplicate agents.
15. As a Ticketry user, I want a launch failure on the lowest-numbered eligible
    ticket to leave the campaign retryable without launching a higher-numbered
    ticket, so that deterministic ordering is preserved.
16. As a Ticketry user, I want Run serially to appear whenever Run subtree is
    enabled for the work item's issue type and state, so that no second settings
    step is required.
17. As a workflow administrator, I want enabling subtree-run capability to
    enable both actions, so that serial mode is on by default wherever subtree
    execution is allowed.
18. As a workflow administrator, I want no independent serial-mode switch in
    this release, so that users cannot create unsupported capability
    combinations.
19. As a workflow administrator, I want disabling subtree-run capability to
    remove both actions, so that the existing policy remains the single launch
    gate.
20. As a Ticketry user, I want the existing Run subtree action to keep launching
    all eligible direct children, so that adding serial execution does not
    remove parallel execution.
21. As an API client, I want the graph-run request to express its execution mode
    explicitly, so that serial and parallel campaigns share one resource
    without ambiguous behavior.
22. As an existing API or MCP client, I want omitted execution mode to retain
    parallel behavior, so that current callers remain compatible.
23. As a Ticketry user, I want a campaign's selected mode to survive backend
    restarts, so that later state or agent-lifecycle observations advance it
    consistently.
24. As a Ticketry user, I want reset behavior to clear either kind of campaign
    without changing workflow states or dependency edges, so that recovery
    remains predictable.
25. As a maintainer, I want serial and parallel scheduling to share readiness,
    satisfaction, launch, liveness, revival, and durable-ledger rules, so that
    the modes cannot drift apart.
26. As a keyboard or assistive-technology user, I want Run serially to have a
    distinct accessible name and pending state, so that I can invoke it and
    understand when its request is in progress.
27. As a Ticketry user, I want a successful serial request to receive clear
    feedback and a refused request to explain the failure, so that the new
    action behaves consistently with Run subtree.

## Implementation Decisions

* Keep one **subtree-run capability**. The existing per-issue-type,
  per-state flag authorizes both Run subtree and Run serially. Do not add a
  serial capability field, checkbox, or separate workflow mutation.
* Render Run serially immediately beside Run subtree and apply the existing
  action's eligibility rules: a persisted task, a resolved Module, a top-level
  work item with children, a current state, and an enabled subtree-run
  capability.
* Keep **Run subtree** as the parallel action and add **Run serially** as the
  serial action. Each action owns its own in-flight guard and pending label so a
  submitted request cannot be duplicated from that control.
* Extend the existing graph-run create request with an execution mode whose
  values are `parallel` and `serial`. Omission means `parallel` for backward
  compatibility. The serial Studio action sends `serial`; the existing Studio
  action and existing MCP caller retain parallel behavior.
* Persist execution mode on the durable graph-run header. A migration gives
  existing rows the parallel value. Re-arming an inactive campaign may replace
  its stored mode, just as it may refresh the existing launch context.
* Keep one graph-run resource, launch ledger, reset operation, and dependency
  projection. Do not add a second orchestration aggregate or overlapping HTTP
  route for serial campaigns.
* Preserve the current direct-child scope. Grandchildren do not participate
  merely because the campaign is serial; nested roots can still own their own
  graph runs under the existing rules.
* Preserve the existing satisfaction predicate, dependency-edge ownership,
  out-of-subtree blocker handling, archived-work exclusion, launch-binding
  resolution, provider override behavior, and durable launch facts.
* Parallel advancement remains unchanged: one pass may launch every eligible
  unlaunched direct child.
* Serial advancement first enforces the campaign-wide liveness invariant. If
  any launch recorded for that root still has a live agent run or terminal, it
  launches nothing.
* An ended serial launch whose child is not satisfied is a stalled frontier,
  not permission to skip ahead. It launches nothing until explicit subtree
  revival clears inactive launch facts and retries unfinished work under the
  existing recovery contract.
* When no recorded serial launch is live or stalled, select exactly one
  eligible unlaunched direct child ordered by ascending WorkTracker sequence
  number and then opaque task ID. The sequence number is the ticket-number
  authority; do not parse the display key.
* If spawning that selected child fails, record no launch fact and do not fall
  through to a higher-numbered child in the same advancement. A later
  observation or explicit request can retry the same lowest candidate.
* Re-evaluate an armed serial campaign on both relevant work-item state changes
  and durable agent-run/terminal termination reconciliation. This makes
  progression independent of whether satisfaction or agent termination is
  observed first. The execution app remains the owner of scheduling decisions;
  run and terminal lifecycle code only publishes or invokes the high-level
  completion seam.
* Serialize advancement per graph-run root across manual requests and lifecycle
  observations so concurrent triggers cannot both pass the liveness check and
  launch separate children. Keep database uniqueness constraints as the final
  duplicate-launch guard.
* Preserve subtree revival and reset semantics for both modes. A live campaign
  rejects a repeat create request; an inactive campaign can be explicitly
  revived; reset removes the durable header and launch ledger without moving
  work items or launching agents.
* Keep user feedback aligned with the existing action: success identifies a
  serial subtree start, stale capability refresh removes both actions, and
  backend errors are surfaced without optimistic claims that work launched.
* Regenerate the typed client after the request contract and graph-run model
  change. Keep the Tauri/webview boundary unchanged; this remains a Studio-to-
  supervised-backend API interaction.
* Maintain the repository's single-purpose boundaries: scheduling policy stays
  in the execution capability, workflow authorization stays in WorkTracker,
  agent/session liveness stays with runs and terminals, and Studio presentation
  stays in the work-item feature rather than shared plumbing.
* No ADR is required. This adds a persisted scheduling mode to the existing
  graph-run aggregate without changing ownership of dependency truth, workflow
  state, terminal durability, or the native-renderer boundary.

## Testing Decisions

A good test observes the public scheduling contract: which ticket is launched,
when it is launched, which request mode was sent, and which action a user can
invoke. Tests must not assert private loop structure, component-local state, or
the names of internal helpers.

* Use the execution driver's existing graph tests as the highest practical
  backend seam for scheduling. Prove that parallel fan-out remains unchanged
  and serial fan-out launches exactly the lowest sequence number.
* At that seam, cover multiple ready tickets, dependencies released together,
  sequence-number ordering with an opaque-ID tie-breaker, already satisfied
  children, external blockers, archived/cancelled children, and the existing
  direct-child-only boundary.
* Cover both event orders: satisfaction before agent termination and agent
  termination before satisfaction. Assert that neither first event launches a
  second agent and the second event launches the next eligible ticket.
* Cover an ended but unsatisfied child as a stalled frontier, explicit revival
  of that child, refusal while work is live, and reset behavior in serial mode.
* Cover a spawn failure on the lowest candidate and assert that no launch fact
  is written and no higher candidate launches during that advancement.
* Exercise concurrent manual and lifecycle advancement against one root and
  assert that only one serial child receives a durable launch fact.
* Extend graph-run API tests to cover explicit serial mode, omitted-mode
  parallel compatibility, invalid mode validation, persisted mode, structured
  error mapping, and generated-client request serialization.
* Extend workflow launch-binding tests to prove that the existing subtree-run
  capability remains the only gate and that no independent serial setting is
  exposed or required.
* Update the existing numbered Studio subtree-execution acceptance case in the
  mounted application seam. Assert that both actions appear together for an
  eligible work item, Run serially sends serial mode, Run subtree retains
  parallel mode, both controls expose independent pending behavior, and both
  disappear after a stale capability refresh disables subtree execution.
* Keep the numbered overhaul gate current and run the mandated Studio overhaul
  suite before implementation handoff. Run affected backend execution tests,
  API/schema tests, generated-client checks, Studio unit tests, and Studio
  typecheck as proportional regression coverage.

## Out of Scope

* Creating implementation tickets, subtasks, dependency edges, or an
  implementation plan during the Spec stage.
* Recursively launching grandchildren or changing the existing direct-child
  graph-run boundary.
* Removing, renaming, or serializing the existing parallel Run subtree action.
* Adding a separate serial-run workflow capability, administrator toggle, or
  per-user preference.
* Allowing more than one concurrent agent per serial campaign or making the
  concurrency limit configurable.
* Reordering tickets manually, choosing newest-first, using title/key lexical
  order, or parsing a ticket number from its display key.
* Automatically skipping an unfinished ticket, marking work satisfied, moving
  work-item states, or cancelling an agent to make progress.
* Automatically retrying an inactive unfinished launch without explicit user
  revival.
* Changing launch-binding provider, model, reasoning, prompt, or required-skill
  resolution.
* Changing dependency storage, workflow transition policy, subtree reset
  semantics, or archive semantics.
* Replacing durable tmux sessions, altering the native terminal renderer, or
  widening the Tauri/webview boundary.
* Extending the existing standalone serial shell script or treating it as the
  product implementation.

## Further Notes

* **Serial campaign** is the execution mode of an armed graph-run root that
  permits only one live launched child. It is not a new workflow capability or
  a different dependency graph.
* The deterministic ordering rule is `(sequence number, task ID)`. The second
  element exists only as a stable tie-breaker for malformed or imported data;
  normal project sequence numbers are unique.
* Progress requires two independent facts about the current child: its work is
  satisfied and its agent/session is inactive. Treating those facts symmetrically
  avoids a race in which Review is observed moments before terminal shutdown.
* The existing external serial-run script is useful prior art for the
  lowest-numbered-ready rule, but its polling, commits, pushes, leaf traversal,
  and module mode are not part of this Studio feature.