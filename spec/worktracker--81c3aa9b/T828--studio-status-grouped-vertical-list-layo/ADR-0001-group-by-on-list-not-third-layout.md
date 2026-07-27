# ADR-0001: Status grouping is a group-by control on List, not a third layout

**Status:** Accepted (refinement, 2026-07-07)
**Ticket:** CODIN-828

## Context

Studio's work-items surface has two layouts behind the segmented `LayoutSwitcher`
(List = Backlog grouped by Epic, Board = status kanban). The ask is a vertical,
status-sectioned list. The ticket offered two shapes: (1) a third layout pill with
its own `View`/route, or (2) a group-by control on the existing List.

WorkTracker — the product this switcher is a faithful port of — models this as **one
List layout whose `group_by` is a display option** (state is WorkTracker's default
grouping): `scratch/worktracker/apps/web/core/components/issues/issue-layouts/list/`
(`default.tsx` builds per-state groups via `getStateColumns`, `utils.tsx:211`).
There is no separate "status list" layout in WorkTracker.

## Decision

Option 2, WorkTracker-faithful: `LayoutSwitcher` stays List | Board. The List/Backlog
surface gains a small **group-by control (Epic | Status)**, persisted to
localStorage like the collapsed-section keys. Backlog = List grouped by Epic
(default, unchanged); this feature = List grouped by Status.

Section semantics follow **Studio Board rules, not WorkTracker-exact**: one section per
individual state, ordered by `groupRank` then state order, cancelled suppressed
per #633, empty sections always rendered (no show-empty toggle in v1).

Sub-items are **WorkTracker-faithful**: a subtask appears as a flat row in its own
state's section (parent chip, like Board cards, honoring the existing
`showSubtasks` filter) *and* nested under its parent's chevron expansion —
duplication allowed; `showSubtasks=false` leaves expansion as the only path.

## V1 scope

In: sticky collapsible per-state headers with counts (collapse persisted),
flat rows, sub-issue chevron expansion, epic rail + filter bar applied,
row click opens the drawer.
Out (follow-up tickets): per-section quick-add, drag-between-sections
state change, bulk multi-select mutations.

## Consequences

- No new `View` member, route, or NavDrawer entry; zero switcher churn.
- The grouping mode is not URL-addressable (accepted; collapse keys already
  live in localStorage).
- `boardColumns` already computes per-state groups with the exact filter +
  cancelled + `cardMeta` conventions — the List-by-status selector should reuse
  it (or share its core) rather than re-derive grouping.
- Reversal path: if a third layout is later wanted, the grouped renderer is the
  reusable part; only the switcher/route wiring would change.
