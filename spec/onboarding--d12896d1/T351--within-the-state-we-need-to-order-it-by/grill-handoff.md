# Grill handoff — T351 Within a state, order work items by when they were moved there

**Status:** COMPLETE (2026-08-10). All Grill decisions below are resolved and
confirmed by the reporter. This file is the audit trail of the interview; the
Spec stage produces the authoritative spec.

***

## 1. Current behavior, pinned down

`transition_state` (`backend/worktracker/workflow.py`) never touches `rank`
(the word does not appear in the file). Every work item carries one
project-global fractional `rank` (`backend/worktracker/models/issue.py:82`),
and every state grouping sorts by it (`compareRank` in
`studio/src/features/work-items/internal/backlogSelectors.ts:9`, ties broken by
`sequence_id`). So a ticket that changes state lands wherever its old rank
happens to sort among the destination state's items — top, middle, or bottom —
which is why moved tickets are hard to track.

## 2. Decisions (all confirmed)

### D1 — Mechanism: rank-to-bottom, NOT a timestamp

A strict chronological order via a durable state-entry timestamp was considered
early in the interview and **explicitly dropped** once the reporter scoped the
problem to "where does a ticket land when it enters a new state." Decision: on
a successful state transition, assign the item a new fractional rank at the
bottom of the destination state. No new fields, no second ordering regime, no
change to how any view sorts. Recorded as ADR
`backend/worktracker/docs/adr/0008-transitions-append-to-bottom-via-rank-not-timestamp.md`.

### D2 — Positional vs non-positional transitions

Append-to-bottom applies only to **non-positional** transitions: state changes
via dropdown/detail panel, agent-origin moves, and API writes. A cross-column
drag is an explicit placement — **the drop position wins**. Items that enter
the state later append below whatever arrangement exists at that moment.
(The reporter double-confirmed this after a mid-interview clarification.)

### D3 — Global rank placement: minimal disturbance

`rank` is project-global and shared with non-state views (backlog). The new
rank goes **just after the destination state's current last item** (fractional
key between that item and its global successor via
`worktracker.ranking.key_between`), not at the global bottom — the smallest
possible movement in the backlog. Reporter's guiding constraint: "don't
interfere with the order that exists now."

### D4 — Empty destination state

The item keeps its existing rank — it is trivially at the bottom of an empty
column, so nothing moves. (Proposed default, confirmed with the summary.)

### D5 — Surface consistency

No per-surface decision needed: because rank stays the single project-global
ordering, board columns, tasks-pane status sections, and Story Map cells all
get the behavior consistently for free. Within-column drag-reorder
(`studio/src/app/shell/ticket-workspace/tasks/internal/ticketReorder.ts`,
`studio/src/features/work-items/mutations.ts`) is unchanged.

### D6 — Migration: none

Existing items keep their positions exactly. The rule applies only to
transitions performed after the feature ships. No backfill from history.

### D7 — Atomicity and origin

The re-rank happens atomically with the state-transition write, in the backend
transition service, for every transition origin (`human` and `agent`).

## 3. Docs written during the interview

* Glossary term **Transition landing position** added to
  `backend/worktracker/CONTEXT.md` (avoids: chronological column order,
  state-entry timestamp, auto-sort).
* ADR 0008 (see D1) with the rejected timestamp alternative and consequences.

## 4. Open items for Spec

* Exact placement of the re-rank inside `transition_state` (after gate checks,
  same transaction) and the query that finds the destination state's last item
  (project-scoped, excluding archived items — confirm archive semantics).
* Concurrency: two simultaneous transitions into the same state must not
  produce identical ranks (`key_between` under race; consider row locking or
  retry).
* Frontend: verify optimistic updates in the Studio projections reflect the
  server-assigned rank (transition responses/status feed must carry the new
  rank so columns don't jump on refetch).