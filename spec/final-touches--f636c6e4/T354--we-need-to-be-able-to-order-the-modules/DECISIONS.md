# T354 — Manual module ordering: grill decisions

Ticket #354 · Work Item `17fda93d-a36a-4070-bfee-370c26a11ba8` · Grilled 2026-08-09

## Decisions

1. **Manual replaces recency.** Once a project has a manual module order, it is
   the one canonical order across every surface (sidebar, tab strip, backlog
   grouping, module pickers, keyboard position shortcuts). Agent activity never
   reshuffles it. Projects that have never been manually ordered keep today's
   recency-first behavior.
2. **Reordering is drag-and-drop in both the sidebar (`ModulesPane`) and the
   horizontal module tab strip.** Pickers and other surfaces only reflect the
   order.
3. **Tab strip layout change:** the module-creation "+" button moves to the
   leftmost point of the strip.
4. **New modules enter at the front** of the canonical order (leftmost tab, top
   of the sidebar) — in both recency mode and manual mode.
5. **The order is shared project-wide**, persisted on the backend; every user
   and device sees the same order. One user's drag reorders it for the team.
6. **First drag freezes the visible order.** The moment a project is first
   manually reordered, the recency order the user is looking at becomes the
   baseline and their move is applied to it — nothing visibly jumps.
7. **One-way door in v1.** No "reset to automatic" action; a reset can be added
   later since clearing the manual order restores recency behavior naturally.

## Defaults taken without a decision (conventional)

* Concurrent reorders resolve last-write-wins per module via fractional ranks
  (the existing `Issue.rank` field on module work items is the natural home;
  it currently documents only task within-column ordering and its doc comment
  should be updated).
* All consumers keep reading the one shared cached order in
  `studio/src/features/projects/queries.ts`; the recency provider in
  `moduleRecency.ts` applies only to never-ordered projects.

## Docs written

* `studio/CONTEXT.md`: added **Canonical module order** and **Manual module
  order**; updated **Module tab strip**.
* `studio/docs/adr/0011-manual-module-order-replaces-recency.md`.