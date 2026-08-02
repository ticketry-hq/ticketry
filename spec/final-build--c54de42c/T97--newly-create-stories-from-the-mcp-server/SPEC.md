# T97 — Show newly created Stories without a refresh

Status: Ready for agent
Story: WorkTracker #97 (`556867b0-e982-413b-b512-3cd98f1b1f02`)
Date: 2026-08-01
Related ADR: [`studio/docs/adr/0006-one-keyed-work-item-store.md`](../../../studio/docs/adr/0006-one-keyed-work-item-store.md)

## Problem Statement

Studio's project status feed already reports a Story created in its workflow
start state and retrieves the authoritative work-item detail. The active module
projection nevertheless rejects that Story because its parent is the selected
module rather than another work item already present in the module task tree.
The Story therefore remains absent from the Stories pane until the user reloads
or revisits the module.

This is most visible when an MCP client creates a Story, but the inconsistency
is not specific to MCP. Any committed create outside the current Studio view can
reach the same reconciliation path. The active Stories pane should converge on
committed project state regardless of which client performed the create.

## Solution

Treat the selected module as the valid parent of an unseen top-level Story.
When the project status feed delivers such a Story, reconcile its authoritative
targeted-detail record into the selected module's Stories projection
immediately.

The arrival is passive. The Story participates in the pane's existing ordering,
search, and filtering rules without changing the selected Story, focused
control, active workspace tab, selected module, or selected project. Creation
source is irrelevant. A Story for another module is not inserted into the
current pane and appears through the ordinary module load when that module is
opened.

## User Stories

1. As a Studio user, I want a newly committed Story in my selected module to appear without a refresh, so that the Stories pane reflects current project work.
2. As an MCP user, I want a Story created through the MCP server to appear in an already-open Studio client, so that I do not have to revisit the module to find it.
3. As a user working across multiple Studio clients, I want a Story created in another client to appear in my current client, so that both views converge on committed state.
4. As an integration author, I want Story arrival to be source-agnostic, so that future create paths receive the same behavior without custom Studio callbacks.
5. As a Studio user, I want the arrived Story to use the authoritative committed record, so that its name, state, rank, type, and other displayed fields match the backend.
6. As a Studio user, I want a live-arriving Story to follow the Stories pane's existing order, so that externally created and locally created Stories are presented consistently.
7. As a Studio user, I want the current search query to continue applying when a Story arrives, so that an intentional search is not bypassed.
8. As a Studio user, I want the current workflow-state filtering and collapsed-state presentation to continue applying when a Story arrives, so that live updates do not override my view choices.
9. As a Studio user, I want my selected Story to remain selected when another Story arrives, so that my work is not interrupted.
10. As a Studio user, I want the focused control and focused pane to remain unchanged when another Story arrives, so that keyboard input continues going where I intended.
11. As a Studio user, I want my active workspace tab and mounted workspace to remain unchanged when another Story arrives, so that details, documents, and terminals are not displaced.
12. As a Studio user, I want my selected project and module to remain unchanged when another Story arrives, so that a passive update cannot navigate me elsewhere.
13. As a Studio user, I want a Story created in another module to stay out of my current Stories pane, so that module membership remains accurate.
14. As a Studio user, I want a Story created in another module to appear through that module's ordinary load, so that no cross-module preload or automatic switch is required.
15. As a Studio user, I want duplicate status-feed delivery to leave one Story row, so that reconnects and replay cannot duplicate work.
16. As a Studio user, I want an older feed frame or targeted-detail response to be ignored when newer data is already known, so that live reconciliation cannot roll a Story backward.
17. As a Studio user, I want a Story created while its module is loading to remain visible after that load resolves, so that a slower list response cannot erase a newer live arrival.
18. As a Studio user, I want a targeted-detail response from a previously selected module to be ignored after I switch modules, so that late network work cannot contaminate the new module.
19. As a Studio user, I want an archived item to remain absent from active Stories, so that live reconciliation respects archive scope.
20. As a Studio user, I want newly committed descendants of a loaded Story to continue appearing beneath their parent, so that fixing top-level Story arrival does not regress the existing descendant path.
21. As a Studio user, I want an arrived top-level Story to remain a root row rather than appear as a child bucket, so that the module task tree keeps its correct hierarchy.
22. As a Studio user, I want arrival of a root Story not to change child counts on unrelated Stories, so that descendant indicators remain accurate.
23. As a maintainer, I want the existing project status feed and targeted-detail request to carry this behavior, so that the application does not gain polling or a create-source-specific event.
24. As a maintainer, I want the canonical keyed work-item owner and revision guards to remain authoritative, so that the Stories projection cannot overwrite a newer local record.
25. As a maintainer, I want projection membership insertion to be idempotent, so that replay, retry, and reconnect are safe.
26. As a maintainer, I want this behavior covered through the existing status-feed integration seam, so that tests exercise the real dispatcher and task projection instead of private helpers.

## Implementation Decisions

### Reconciliation trigger and authority

- Keep the existing backend creation, project revision, status-feed replay, and
  targeted-detail fetch paths. A committed work-item state frame remains the
  trigger; no MCP-specific event, Studio callback, or polling path is added.
- The targeted-detail response is the authoritative record used for membership
  insertion. The keyed work-item owner reconciles that record before the Studio
  planning projection derives a row from it, preserving the ownership and
  revision rules established by ADR 0006.
- Immediate state-delta application remains separate from membership. An unseen
  item is added to the Stories pane only after authoritative detail establishes
  its project, parent, issue type, archive flag, revision, and full display data.

### Top-level Story eligibility

- Extend the Studio task projection's targeted reconciliation boundary with one
  root-Story branch. An unseen item is eligible only when all of the following
  are true: its project is the selected project, its parent is the selected
  module, its task-level issue type is Story, and it is not archived.
- Insert an eligible item into the root Story collection. Do not create a child
  bucket, update another Story's child count, select the new Story, or alter
  workspace and focus state.
- Normalize the authoritative record through the same presentation boundary as
  module loads and local Story creation. Preserve the existing ranked ordering;
  where the existing fallback uses collection order, place the arrival exactly
  as the local create path does so it is presented newest first.
- Membership insertion is idempotent by work-item identifier. If the item is
  already represented, targeted reconciliation updates the existing row rather
  than adding another copy.

### Scope, staleness, and races

- Keep the project and live-feed scope guards. Re-check selected project and
  selected module when targeted detail resolves, not only when its request
  begins, so a late response cannot enter a newly selected module.
- Continue rejecting a targeted detail whose revision is below the revision
  requested by the feed, and continue refusing to replace any locally known
  record with a lower revision.
- A module load must merge, rather than replace, an authoritative root Story
  accepted while that load was in flight. Use the already accepted canonical
  record and revision information as the merge authority; do not issue a broad
  list refetch or add a periodic refresh.
- Module-load reconciliation must not resurrect archived, foreign-project, or
  foreign-module records. Once the fetched module result contains an equal or
  newer authoritative version of the arrived Story, normal loaded membership is
  sufficient and any temporary race bookkeeping can be discarded.

### Existing descendant behavior

- Preserve the current unseen-descendant branch for an item whose parent is an
  already loaded work item. It continues to add the child under that parent and
  reconcile the parent's child count.
- A foreign parent that is neither the selected module nor a work item in the
  active module task tree remains ineligible. The top-level branch must not
  broaden descendant reconciliation across module boundaries.

### Presentation invariants

- Search, state grouping, collapsed sections, and any other active Stories-pane
  filtering remain derived presentation concerns. The authoritative Story may
  join the module projection while remaining visually hidden by those rules.
- Passive arrival does not call selection, focus, navigation, notification, or
  workspace-opening behavior. Existing store fields for those concerns retain
  their current values.

## Testing Decisions

A good test observes public store and rendered-tree behavior after realistic
status-feed events. It must not assert private helper calls or duplicate the
reconciliation algorithm in test code. Network work is mocked only at the HTTP
detail/list boundary so that the real feed dispatcher, revision guards,
canonical reconciliation, and Studio task projection all participate.

**Seam.** Use the existing Studio status-feed integration seam in
`studio/src/test/studioTasksStateFeed.test.ts`. This is the highest existing
single seam that can drive the real status feed and task store while controlling
authoritative targeted-detail and module-load timing. No new test seam is
required.

**Coverage.** Extend that seam to prove:

1. An unseen task-level Story whose parent is the selected module appears as a root Story after its authoritative targeted detail resolves.
2. Its arrival preserves the selected Story and does not create a subtask bucket or alter an unrelated parent's child count.
3. Search and existing presentation rules continue to determine whether the inserted Story is visible.
4. A Story whose parent is another module is ignored by the active module projection.
5. A non-Story task-level item parented directly to the selected module is not inserted as a Story.
6. Duplicate delivery and an older subsequent frame produce exactly one row containing the newest authoritative data.
7. An older targeted-detail response cannot replace a newer record already held by the canonical owner or projection.
8. A module-load response begun before the create cannot remove the accepted Story when it resolves afterward.
9. A late targeted-detail response after a module switch cannot enter the newly selected module.
10. An archived targeted detail is not inserted into active Stories.
11. The existing new-descendant case still inserts beneath a loaded Story and updates that parent's child count.

**Regression checks.** Run the focused status-feed test, the complete Studio
test suite, and Studio typecheck. Existing local Story creation, task-tree
ordering, module hydration, status-feed replay, and descendant reconciliation
tests remain part of the regression signal.

## Out of Scope

- Selecting, focusing, opening, scrolling to, highlighting, or notifying on the
  newly arrived Story.
- Switching modules to reveal a Story created elsewhere.
- Bypassing or clearing active search, workflow-state grouping, collapsed
  sections, or other intentional presentation filters.
- Adding polling, a dedicated MCP-create event, a source-specific callback, or
  an MCP-specific Studio API.
- Changing Story creation, workflow birth-state semantics, ranking contracts,
  project revision production, status-feed replay, or backend persistence.
- Broadening the project status feed into a general work-item change feed beyond
  the create-arrival behavior described here.
- Refactoring all planning projections onto the keyed work-item store; this
  change follows ADR 0006 but is limited to the reconciliation needed for live
  root-Story membership.
- Creating implementation tickets during the Spec stage.

## Further Notes

- The existing Studio glossary terms **Story**, **Stories pane**, **Focused
  pane**, **Task workspace**, and **Module task tree** are used as defined. No
  glossary change is required.
- ADR 0006 already establishes canonical keyed work-item ownership and places
  revision guards with the owned records. This specification applies that
  decision to projection membership and introduces no additional architectural
  decision requiring an ADR.
- The original report names MCP because that path made the issue easy to
  reproduce. Acceptance is intentionally based on committed feed data and
  module membership, never on the creator's identity.
