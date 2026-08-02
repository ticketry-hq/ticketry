# Paint the Task Workspace From the Record Studio Already Holds

## Problem Statement

The right-hand task workspace takes a visible moment to appear. Select a Story
in the Stories pane and the panel blanks — "Loading issue…", and for any ticket
with a remembered document or terminal, "Restoring workspace…" — before the
details resolve. Cycling quickly through a module's tickets therefore reads as
janky: the content the user is scanning for is the one thing that is missing at
the moment they look for it.

The delay is not the network being slow. It is Studio discarding data it already
holds and asking for it again. Loading a module already returns every descendant
work item as a complete record. On selection Studio nulls the detail it holds,
issues the same detail request twice from two stores that do not know about each
other, re-requests children that are also already in memory, and blocks the first
paint on all of it behind a debounce. A settled selection costs five requests to
show information that required none.

Beneath the symptom is a correctness defect. Work-item records live in four
stores across two feature lineages, in two incompatible shapes: a lossy summary
shape used by the planning panes, and the faithful backend record used by the
detail, backlog, and drawer surfaces. One selected ticket exists three or four
times. The lossy shape drops `created_at`, `is_archived`, `lifecycle_state`,
`lifecycle_transitions`, `blocked_by_ids`, `blocks_ids`, and label colours, and
fabricates a `"No state"` placeholder where the server honestly sent `null` —
which is precisely why the panel cannot render from what it has. State and parent
are mutable through two independent code paths, each updating a different subset
of the copies; the status feed reconciles two of the four stores, and the drawer
workspace store has no reconciliation path at all. Copies of one record can and
do disagree.

## Solution

Studio holds exactly one client-side copy of each work item, keyed by id, in a
single **work-item store**. Every pane, tree, and picker keeps ids and resolves
records through that store. Selecting a ticket is then a **selection paint**: the
task workspace renders in the same frame as the selection, from the record
already in hand, with no request in the way.

A background refresh follows the paint to pick up attachments and edits made
elsewhere. Because the panel is already on screen, that refresh may be debounced
and aborted freely — delaying or cancelling it is invisible.

`"Restoring workspace…"` disappears. The Details tab paints immediately and a
remembered document or terminal tab activates behind it when its own fetch
resolves.

A loading state remains correct in exactly one situation: the record is genuinely
absent — a deep link into an unloaded module, a standalone drawer, a cross-module
reference. There, a loading state is honest.

The result for the reported behaviour: cycling within a loaded module costs zero
requests to render and has no blank frame, against today's five requests and a
≥150 ms floor before anything is visible.

## User Stories

1. As a Studio user cycling through Stories, I want each task workspace to appear
   the instant I select it, so that scanning a module does not feel janky.
2. As a Studio user, I want the Details tab to render without a "Loading issue…"
   placeholder for a ticket in the module I already loaded, so that I never wait
   for data Studio already has.
3. As a Studio user, I want a ticket with a remembered terminal to show its
   Details immediately rather than "Restoring workspace…", so that a saved
   workspace never costs me the view of the ticket.
4. As a Studio user, I want a remembered document or terminal tab to become
   available as soon as it is discovered, so that dropping the restore gate does
   not cost me my tabs.
5. As a Studio user holding an arrow key down through the Stories pane, I want
   intermediate selections not to queue up requests, so that fast traversal stays
   responsive.
6. As a Studio user, I want a late response for a ticket I have already moved on
   from never to paint over the ticket I am now looking at, so that what I read is
   always the ticket I selected.
7. As a Studio user, I want the panel to show fresh data shortly after it paints,
   so that an edit made in another surface or by an agent is not stale on screen.
8. As a Studio user deep-linking to a ticket outside the loaded module, I want an
   honest loading state, so that an empty panel is never mistaken for an empty
   ticket.
9. As a Studio user, I want a ticket's blockers, dependents, labels with their
   colours, lifecycle state, and archived flag available wherever the ticket is
   shown, so that no surface silently renders a reduced version of the record.
10. As a Studio user, I want a ticket with no state to be shown as having no
    state, so that Studio never invents a `"No state"` value the backend did not
    send.
11. As a Studio user changing a ticket's state, I want every surface showing that
    ticket to agree immediately, so that the tree, the panel, the backlog, and
    the drawer never contradict each other.
12. As a Studio user reparenting a ticket, I want the same single update to be
    reflected everywhere that ticket appears, so that a move cannot leave a stale
    parent behind in one pane.
13. As a Studio user creating a child ticket, I want it to appear consistently in
    every surface that should list it, so that a new child is never visible in one
    pane and missing from another.
14. As a Studio user, I want status-feed updates to be applied against the one
    copy of the record, so that an out-of-order or superseded update cannot land
    in one store while being rejected by another.
15. As a Studio user reordering Stories, I want ranking and reordering to keep
    working exactly as they do today, so that consolidating records does not cost
    me the planning behaviour I rely on.
16. As a Studio user working in the drawer workspace, I want the ticket shown
    there to be the same record as everywhere else, so that the drawer stops being
    the one surface nothing reconciles.
17. As a developer, I want one place where a work-item record is written, so that
    a new surface cannot introduce a fifth divergent copy.
18. As a developer, I want the status-feed revision guards to live with the
    records they protect, so that a guard is not half-installed in a store that no
    longer owns the data.
19. As a developer, I want the lossy summary type and its normalisation removed
    outright, so that no code path can reintroduce field loss by picking the
    convenient shape.
20. As a developer, I want the invariants of this design covered by tests at an
    existing seam, so that a later change reintroducing a second copy or a
    blocking fetch fails loudly.

## Implementation Decisions

### One owner for work-item records

- The existing issue-detail store becomes the single owner of work-item records
  and the **work-item store** of the domain glossary. It holds records keyed by
  id, the open id, the child ids, attachments by id, and a key→id index so
  `TIC-82`-style lookups resolve without a second copy.
- The module load writes its returned descendants directly into that store.
- The Stories/tasks store, the backlog store, and the drawer workspace store hold
  **ids only** and resolve records through the owner.
- The store keeps its current name and location. Accepted cost, recorded
  deliberately: it lives under the issue-detail feature's internal directory while
  being imported by three stores outside it. Relocation and renaming are not
  attempted in this story.

### Removal of the lossy shape

- The `TaskSummary` type and its normalisation function are deleted, not
  deprecated.
- The fabricated `{ name: "No state" }` placeholder is deleted. Callers handle a
  null state as the backend sends it.
- Fields the summary discarded — `created_at`, `is_archived`, `lifecycle_state`,
  `lifecycle_transitions`, `blocked_by_ids`, `blocks_ids`, `labels[].color` — are
  available to every consumer by virtue of there being one faithful shape.

### Mutations

- State change, reparent, and create-child consolidate onto the work-item store,
  reusing its existing optimistic patch path and per-field saving flags.
- The status-feed revision guards (seen state revisions, pending state deltas)
  move to the work-item store alongside the records they protect.
- The tasks store keeps rank and reorder. The dividing line: a change to the
  **record** goes to the work-item store; a change to the **ordering** stays in
  the tasks store.

### Runtime behaviour

- Paint is never gated on a request. A selection whose record is present renders
  the full panel in the same frame.
- The two 150 ms debounces currently on the render path (Stories pane selection,
  Details tab) come off it.
- One background detail request follows the paint, carrying a 150 ms debounce and
  abort-on-change. The debounce and abort apply to the refresh only. This request
  is retained rather than dropped: the status feed publishes state moves only, so
  removing it would regress freshness for other edits.
- The `"Restoring workspace…"` gate is removed. Details paints immediately and a
  remembered document or terminal tab activates when its fetch resolves.
- Tab-discovery fetches for documents and terminals stay eager — each document
  and terminal *is* a tab, so deferring them would mean the tabs never appear —
  but they are debounced and aborted alongside the detail refresh.
- A genuine cache miss falls back to today's loading state.

### Architecture record

The decision, including the rejection of adopting a server-state query library
for this story, is recorded in the Studio ADR *"One keyed work-item store
replaces per-feature record copies"*. A query cache keyed by id would have
supplied dedupe, staleness, and prefetch, but would not have normalised the
shapes — a list query and a detail query still hold separate copies — so the
disagreement bug class this work exists to kill would have survived it. Adopting
such a library later on top of the normalised shape remains open.

### Domain vocabulary

The Studio glossary entries **Work item**, **Work-item store**, and **Selection
paint** are the vocabulary for this work and are used throughout. Older spellings
(`Task`, `Issue`) survive only where they already name a *surface* rather than a
record.

## Testing Decisions

A good test here asserts externally observable behaviour: what the user sees in
the panel, and what requests leave the client. It does not assert store internals,
call counts of private functions, or the presence of a particular field on an
intermediate object. No instrumentation is added for this story — the tests are
the proof that the design holds.

**Seam.** The existing Vitest + testing-library component seam used by the
issue-detail and Studio task tests, driving the real stores against a stubbed
HTTP boundary. This is the highest seam that can observe both the rendered panel
and the request traffic, and it already exists — no new seam is introduced.

**Prior art.** The existing tests for the issue-detail component, the issue
store, the Studio task-tree hydration path, the status-feed reconciliation, the
drawer workspace store, and the task-workspace tab navigation. New tests follow
their setup and stubbing conventions.

**Invariants under test.**

1. Selecting a task whose record is loaded renders the panel synchronously, with
   no loading state observed at any point.
2. A settled selection issues exactly one detail request, not two.
3. A late response for task A cannot paint while task B is selected.
4. A task with a remembered terminal shows Details rather than
   `"Restoring workspace…"`, and its remembered tab becomes available once
   discovery resolves.
5. A genuine cache miss — a record not in the store — falls back to the loading
   state.
6. A state change, a reparent, and a child creation are each observable from
   every surface that shows the affected ticket, with no surface left stale.
7. A superseded or out-of-order status-feed update is rejected consistently, with
   the guards applied where the record lives.
8. Rank and reorder behaviour is unchanged — covered by the existing reorder tests
   continuing to pass.

## Out of Scope

Each of the following is deferred to its own ticket and must not be attempted
here:

- **Adopting a server-state library.** TanStack Query, retention across
  navigation, staleness policy, prefetch, and eviction. Considered and rejected
  for this story; see the ADR.
- **Backend list payload size.** The list endpoint ships `description`,
  `description_html`, and `description_stripped` on every item — measured at
  787 KB for a 316-item module. Lists need one of the three.
- **Backend N+1 queries.** The list serializer resolves assignees and labels per
  item without prefetching — measured at 632 wasted queries for that same module,
  against a database holding 0 assignee links and 14 label links in total.
- **Vocabulary rename.** `Task`, `Issue`, and `WorkItem` still name one aggregate
  across the codebase. The glossary records the intended term; the codebase-wide
  rename is not attempted here.
- **Relocating or renaming the work-item store's module.** Its current name and
  path are kept deliberately.
- **Performance instrumentation.** No timing metrics, marks, or telemetry are
  added.

## Further Notes

- The reported symptom and the structural defect share one fix; this is not a fix
  plus an opportunistic refactor. The panel blanks *because* the client holds the
  record in a shape it cannot render from, so normalising the shape is what makes
  the paint possible.
- The measured numbers above (787 KB, 632 queries, 316 items, five requests per
  selection, the ≥150 ms floor) come from the investigation recorded in this
  ticket's design document and describe the pre-change state.
- The retained background refresh is a deliberate freshness/simplicity trade. If
  the status feed later publishes all record edits rather than state moves alone,
  dropping the refresh becomes available.
