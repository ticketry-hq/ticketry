# Board: reuse planning filter dropdowns - LLD

## Scope lock

This implementation is frontend-only and limited to the Board planning-filter integration. The Board will reuse the existing planning filter dropdowns and persisted `planningFilterStore` axes for Epics, Sprints, and States. Board-local search, priority filtering, Show sub-tasks, Group by epic, drag/drop, rank ordering, selection, card navigation, and existing quick-add entry points remain Board behavior.

Quick-add planning behavior is deferred. This ticket must not redesign quick-add, agent kickoff, parent seeding, or sprint seeding.

## Implementation harness

### Source files to modify

| File | Change |
| --- | --- |
| `studio/src/views/BoardFilterBar.tsx` | Replace the old single-module `FilterSelect` with `EpicsFilterDropdown`, add `SprintsFilterDropdown` and `StatesFilterDropdown`, and keep `SearchBox`, Priority chips, Show sub-tasks, and Group by epic. |
| `studio/src/views/BoardView.tsx` | Sync `planningFilterStore` to the active project, reconcile it after the current project data has loaded, read planning axes, pass them into Board selectors, and stop deriving quick-add parent seed from planning epics. |
| `studio/src/stores/backlog/backlogSelectors.ts` | Extend `boardColumns` and `boardSwimlanes` to consume planning axes while preserving the existing `BacklogFilters` contract for Board-local filters. |
| `studio/src/test/board.test.tsx` | Add selector tests for planning epics, planning sprints, `BACKLOG_ROW`, state-column visibility, No-State hiding under active state selection, and search spanning all epics. |
| `studio/src/test/filterControls.test.tsx` or focused Board render test file | Cover `BoardFilterBar` rendering the three planning dropdowns and exposing only Priority chips from `FilterChips`. |

### Files to reuse without changing by default

| File | Role |
| --- | --- |
| `studio/src/stores/ui/planningFilterStore.ts` | Existing persisted project-scoped planning axes and reconcile behavior. |
| `studio/src/views/planning/EpicsFilterDropdown.tsx` | Existing multi-select Epic dropdown with `NO_EPIC`. |
| `studio/src/views/planning/SprintsFilterDropdown.tsx` | Existing multi-select Sprint dropdown with `BACKLOG_ROW`. |
| `studio/src/views/planning/StatesFilterDropdown.tsx` | Existing multi-select State dropdown with no No-State sentinel. |
| `studio/src/views/FilterChips.tsx` | Existing chip control; Board should call it with Priority only. |

## Selector contract

Introduce a Board-only planning axes input for selector calls. It should contain `epicIds`, `sprintIds`, and `stateIds`, matching `planningFilterStore` naming and empty-means-all semantics.

Do not merge these axes into `BacklogFilters`. `BacklogFilters` remains responsible for query, priorities, and `showSubtasks` on Board.

### Epic behavior

When Board search is empty, selected planning epics narrow visible cards and swimlanes. `NO_EPIC` matches cards with no owning epic. Empty planning epics means all epics.

When Board search is non-empty, search spans all epics even if planning epics are selected. Priority, sprint, state visibility, and Show sub-tasks still compose normally with search.

### Sprint behavior

Selected planning sprints narrow visible cards in flat Board and swimlane Board. `BACKLOG_ROW` matches cards where `sprint_id` is null. Empty planning sprints means all sprints and unsprinted cards.

Remove the old Board Sprint chip path by rendering Priority chips only in `BoardFilterBar`.

### State behavior

Selected planning states control visible Board columns and the cards inside those columns. Empty planning states means all normal non-cancelled columns, with the existing synthetic No-State column shown only when it has visible cards.

Because `StatesFilterDropdown` has no No-State sentinel, an active state selection hides null/unknown-state cards and hides the synthetic No-State column.

State remains the Board axis. Do not add state back as a hidden row-level card filter in `BacklogFilters`.

## BoardView wiring

On active project change, Board must call `planningFilterStore.setProject(projectId)`.

After the current project data has loaded and `backlogProjectId` matches `projectId`, Board must call `planningFilterStore.reconcile` with live module ids, sprint ids, and non-null state ids. This mirrors the Story Map pattern and prunes stale persisted selections per project.

Board selector calls must receive both Board-local `filters` and the planning axes. Both flat Board and epic swimlanes must use the same selector semantics.

Quick-add parent seeding must not become planning-aware. The current single-epic filter source is being removed from Board, so quick-add should create with the clicked state only unless an existing non-planning Board-local source still supplies a parent. Do not seed sprint from planning filters.

## BoardFilterBar wiring

The filter bar order should keep the Board readable and familiar:

1. Search box.
2. Epics planning dropdown.
3. Sprints planning dropdown.
4. States planning dropdown.
5. Priority chips.
6. Show sub-tasks.
7. Group by epic.

Remove `FilterSelect`, module list reads, `NO_EPIC` usage, and `setFilter({ epicIds })` from `BoardFilterBar`. The old single-module select must not remain mounted.

`FilterChips` must be called with Priority only on Board. The global backlog filter bar remains unchanged.

## Tests

### Selector tests

Add or update `boardColumns` coverage for:

| Case | Expected result |
| --- | --- |
| Empty planning axes | Existing all-columns/all-cards Board behavior is preserved. |
| Planning epic selected | Only cards owned by that epic appear when search is empty. |
| `NO_EPIC` selected | No-epic cards appear. |
| Search plus planning epic selected | Matching cards from all epics can appear; priority and sprint still apply. |
| Planning sprint selected | Only matching sprint cards appear. |
| `BACKLOG_ROW` selected | Unsprinted cards appear. |
| Planning state selected | Only selected state columns and their cards appear. |
| Planning state selected with stateless cards | Synthetic No-State column and null/unknown-state cards are hidden. |

Repeat the same behavior coverage for `boardSwimlanes`, including lane visibility and aligned column arrays.

### Render/control tests

Add a Board filter bar render test that verifies:

| Control | Expected result |
| --- | --- |
| Epics dropdown | Present in Board filter bar. |
| Sprints dropdown | Present in Board filter bar. |
| States dropdown | Present in Board filter bar. |
| Old module select | Not present. |
| Priority chips | Present. |
| Sprint chip | Not exposed by Board `FilterChips`. |
| Search, Show sub-tasks, Group by epic | Still present. |

Add a BoardView integration-style test if the existing harness can support it cheaply:

| Behavior | Expected result |
| --- | --- |
| Project load | `setProject(projectId)` is called for Board. |
| Loaded project data | `reconcile` receives live module, sprint, and non-null state ids. |

## Decision-complete implementation steps

1. Update selector signatures to accept Board planning axes separately from `BacklogFilters`.
2. In `boardColumns`, derive epic filtering from planning epic ids, but relax epic filtering when query is non-empty.
3. In `boardColumns`, derive sprint filtering from planning sprint ids and map `BACKLOG_ROW` to null `sprint_id`.
4. In `boardColumns`, use planning state ids to choose which columns are emitted; hide No-State under active state selection.
5. Apply the same visibility rules in `boardSwimlanes`, keeping the column array uniform across lanes.
6. Update BoardView to read planning axes, call project sync/reconcile, and pass axes to both selector paths.
7. Remove planning-derived quick-add parent seeding from BoardView for this ticket.
8. Update BoardFilterBar to mount the three planning dropdowns and call `FilterChips` with Priority only.
9. Add selector tests for flat Board.
10. Add selector tests for swimlane Board.
11. Add render/control coverage for BoardFilterBar.
12. Run the existing frontend test target that covers `studio/src/test/board.test.tsx`, planning dropdown tests, and filter control tests.

## Acceptance signal

The LLD is implementation-ready when Board has one source for planning axes, those axes stay isolated in `planningFilterStore`, selector behavior is specified for flat Board and swimlanes, No-State and search semantics are explicit, quick-add planning behavior is deferred, and tests cover the new filter controls plus selector behavior.
