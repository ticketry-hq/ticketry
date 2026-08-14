# Spec — Studio frontend: one holding per thing

**Story:** CODING-145 · **Blocked by:** CODING-144 · **Parent:** CODING-142
**Supersedes** the Redux Toolkit rebuild previously specified in this file.

| Where to look                                                                                                       | For                                          |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| this document                                                                                                       | what is being built and why                  |
| [`studio/docs/lld/0-overview.md`](../../../studio/docs/lld/0-overview.md)                                           | how, in implementable detail — six documents |
| [`docs/decisions/2026-08-06-one-holding-per-thing.md`](../../../docs/decisions/2026-08-06-one-holding-per-thing.md) | why, including the paths walked and left     |
| [`studio/docs/adr/0010-…`](../../../studio/docs/adr/0010-per-work-item-query-entries-with-a-batched-read.md)        | the decision of record (supersedes ADR-0009) |
| [`studio/CONTEXT.md`](../../../studio/CONTEXT.md)                                                                   | the language. Use its terms.                 |

***

## Problem

A Story renamed on the details page keeps its old name in the Stories pane until
the module is reloaded. So do its description, type and parent. State changes
appear to work only because the status feed reconciles committed workflow-state
moves into the tree.

A work item's field values are held in six places and an edit refreshes three.
The Stories pane reads a lossy re-shape the edit path never touches, and the
store that owns records holds no reference to the store that owns the tree.

The same class runs through the task workspace, undetected until now: a terminal
session is held in **four** places, and a run's task, module and scope arrive both
from a terminal read and from the status feed under two spellings.

This has been "fixed" twice. ADR-0006 states in the past tense that the lossy type
was deleted; it was not. The glossary asserts a record can never exist in two
places and disagree with itself; it can. Both attempts introduced a correct new
mechanism and left the old one alive behind a compatibility shim, because nothing
ever failed when a duplicate appeared.

For a person using Studio this is not trusting what is on screen. For a
maintainer it is every edit path needing to know about every list.

***

## Solution

**One holding per thing.**

* Each work item lives in a query entry keyed by its own id, and nowhere else.
* Membership — the module tree, a section's rows, a parent's children — is sent
  and held as ids.
* One holding per work item would cost one request per work item; a read batcher
  collapses the requests without collapsing the entries, so no reply is ever
  written outside its own key.
* Freshness is push: a work-item change frame invalidates exactly one entry.
* Everything the person did lives in **one** client store of 24 fields.
* Values that arrive only as pushed values — agent run liveness — live in one
  projection beside it. That is not a copy; it is their only holding.
* Live objects — xterm instances, sockets, the viewer lease — are outside both.
* Everything else is computed at read and thrown away.

**A terminal tab is a run.** The tab set is derived from the runs with a live
session, minus a dismissed set.

The invariants are enforced mechanically, because they have been asserted in
prose twice and been false twice.

***

## User stories

**Trusting the screen**

1. A Story renamed on the details page shows its new name in the Stories pane at once.
2. The same for description, type, parent and state.
3. A renamed Story is findable by its new name in search straight away.
4. The parent and blocker pickers show current names.
5. The set-parent dialog shows current names.
6. A state change moves the row into the right section immediately.
7. An edit that fails on the server visibly reverts.
8. A change made by an agent appears without a reload.
9. An in-flight edit is not clobbered by a slower response describing an older version.
10. Selecting a work item paints from data already held — no loading flash when cycling a loaded list.
11. Collapsed branches keep summarising the runs beneath them.
12. Live-terminal cycling still reaches terminals inside collapsed branches.
13. Expansion, collapse, focus, active tab and search text behave exactly as today.
14. Opening a module costs one request, not one per work item.
15. A terminal whose tmux session dies shows that at once.
16. A document tab shows the file as it is on disk when it opens.

**Maintaining it**

1. A record's values are held in exactly one place, so an edit path never needs to know which lists exist.
2. A test fails if any part of the client store holds a record field.
3. A test fails if one work item appears in two query entries.
4. No code writes a reply into a key other than its own, so no fan-out needs a standing exception.
5. One implementation of optimistic write and rollback.
6. Ordering and grouping are derivations, so they cannot go stale independently.
7. The lossy summary type is gone entirely.
8. The fabricated "No state" placeholder and the invented Scratch workflow state are gone.
9. Terminal byte streams stay out of every cache and store.
10. A run's liveness is held in one place.
11. One request layer, so a caller cannot reach the old client while another reaches the new one.
12. Frontend tests reference no store and no cache.
13. The synthetic scratch row has a stated representation.
14. One documented rule for what is server state, what is stream state and what is client state.

***

## Scope

**In:** Studio's read layer, write layer, client state, task workspace, and the
tests for all of it. See [LLD 4](../../../studio/docs/lld/4-deletion-inventory.md)
for the file-by-file inventory — 48 non-test modules and 45 test files.

**Out:**

* WorkTracker backend changes — CODING-144, which this blocks on for the revision
  broadening and the `?ids=` read.
* Collapsing the `AgentTerminalSession` mirror into `AgentRun` — CODING-167. This
  Story reads runs by work item, the shape it keeps either way.
* Terminal transport, tmux lifecycle, the WebSocket protocol and its cursor replay.
* Document watching, the revision digest, the stale-save conflict flow.
* Visual design. Nothing changes appearance except the bugs being fixed.
* Pagination; client-side normalization libraries; GraphQL. Rejected — see the ADRs.

**Removed as a feature, deliberately and only this one:** doc chat, rebuilt under
CODING-170. Runs already recorded with scope `docchat` are hidden and left alone;
the accepted consequence is that such a run, if still live, has no surface until
the rebuild lands.

***

## Dependencies

CODING-144 must deliver, and neither has a client-side workaround:

1. **The work-item change revision advances for every published change.**
   `issue.py:110` advances it only on a state move, so a rename publishes no
   frame. `backend/worktracker/CONTEXT.md` already defines the broader
   semantics — the code and the glossary disagree, and no Story owned the gap. A
   backend test must fail when a published field changes without the counter
   advancing, because with push-only freshness a missed bump never heals.
2. **`GET /work-items?ids=…`**, accepting at least 100 ids.

***

## Landing

One branch, replacing the state layer and its tests together, so no intermediate
state exists in which a compatibility layer could survive — that is how this
defect survived twice. Order of work is
[LLD 4 §7](../../../studio/docs/lld/4-deletion-inventory.md).

Record the failing-test baseline at the branch point before starting.

**Measured:** 48 of 208 non-test modules and 45 of 114 test files, so 69 test
files are untouched. The earlier plan assumed "a little over two hundred" modules
and 80 of 89 test files; it had also never counted the seven stores behind the
task workspace.

***

## Verification

* The regression test for the reported bug: mount the Stories pane and the details
  pane, rename through the DOM, assert the row's text changes. Library-agnostic.
* Four enforcement mechanisms and one lint rule —
  [LLD 5](../../../studio/docs/lld/5-testing.md).
* Fourteen behaviours verified by hand, listed in LLD 5 §8, because the test
  suite is re-authored alongside the implementation and cannot protect the change
  while it is happening.