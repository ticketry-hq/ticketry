# Low-Level Design: Newest Story on Top

## Scope

Seed all newly created work items at the top of the existing shared rank order, and restamp existing ranked items so higher `sequence_id` items sort before lower `sequence_id` items. The rank remains one global project-level ordering key used by Backlog, Board columns, and Story Map cells.

This is a backend-only change. No frontend ordering, drag/drop, selector, API contract, or optimistic-rank code changes are part of this task.

## Existing Rank Contract

- Server list order is `rank` ascending, then `sequence_id`.
- Frontend `compareRank` mirrors that same order.
- Manual reorder already persists a new `rank` between same-project neighbors through `reorder_work_item`.
- `append_rank(project_id)` currently allocates a key after the project maximum rank, so creates land at the bottom.
- `0006_issue_rank` originally backfilled ranks in ascending `sequence_id`, preserving oldest-first order.

## Implementation Harness

### Rank Allocation Helper

Add `prepend_rank(project_id)` beside `append_rank(project_id)` in `worktracker/worktracker/work_items.py`.

Decisions:

- Query the minimum non-empty rank for the project.
- Return a key between no lower bound and that minimum rank.
- For an empty project, call the same ranking primitive with no lower or upper bound so the first key matches the existing empty-list behavior.
- Keep `append_rank` unchanged for any future caller that explicitly wants bottom seeding.
- Export nothing new beyond the normal module function; services import it directly from `worktracker.work_items`.

Acceptance signal:

- With existing project ranks, the returned key sorts before the current minimum.
- With no existing ranks, the returned key is non-empty and valid.

### Create Seams

Update both work-item create paths in `worktracker/worktracker/services/work_items.py`.

Decisions:

- `create_project_work_item` uses `prepend_rank(project.id)` when constructing the new `Issue`.
- `create_module_work_item` uses `prepend_rank(module.project_id)` when constructing the new `Issue`.
- Sequence allocation remains unchanged.
- Default state, issue type resolution, parent assignment, description handling, and transaction boundaries remain unchanged.
- `reorder_work_item` remains untouched so manual drag-to-reorder continues to own explicit placement.

Acceptance signal:

- Creating A, then B, then C in one project yields ranks where C sorts before B and B sorts before A.
- The response still includes a non-empty rank.

### Existing Data Migration

Add a new migration after the current migration head. In this repo the current migration list already includes `0007_sprint_lifecycle.py`, `0008_state_is_protected_and_blocked.py`, and `0009_issue_lifecycle_state.py`, so the implementation should use the next available migration name, `0010_rank_newest_first.py`, not a second `0007`.

Decisions:

- Depend on `0009_issue_lifecycle_state`.
- Iterate projects independently.
- For each project, load all issues ordered by descending `sequence_id`, then deterministic `id`.
- Generate evenly spaced keys with `rebalance(count)`.
- Assign the first key to the newest issue, so the newest issue receives the smallest rank.
- Save only rows whose rank changes.
- Reverse migration is `RunPython.noop`, matching the agreed requirement that rollback does not restore old manual ordering.

Acceptance signal:

- After migration, for three existing issues with sequence IDs 1, 2, and 3, the rank for 3 sorts before 2, and 2 sorts before 1.
- No rows are deleted or reparented.
- Reversing the migration is a no-op data reversal.

## Test Plan

### Backend Unit Tests

Update `worktracker/worktracker/tests/test_service_work_items.py`.

Required coverage:

- `prepend_rank` returns a rank before the existing minimum rank.
- `prepend_rank` handles an empty project.
- Project-level creates now sort newest-first by rank.
- Module-level creates now sort newest-first by rank.
- Existing reorder tests remain valid and prove manual rank writes still win after create seeding.

Existing tests that assert increasing ranks from creation order must be updated to assert decreasing rank order, while keeping the non-empty rank assertion.

### Migration Test

Add a migration test for the new migration.

Required coverage:

- Start from the migration before `0010_rank_newest_first`.
- Create one project with multiple issues whose sequence IDs are oldest to newest.
- Apply the new migration.
- Assert every issue has a non-empty rank.
- Assert ranks are unique.
- Assert higher `sequence_id` sorts before lower `sequence_id`.
- Reverse the migration and assert the rows remain present.

### API and E2E Regression

Keep existing reorder API and reorder E2E tests in scope.

Required coverage:

- Create endpoint still assigns rank.
- Server list order follows rank ascending.
- Moving an item between neighbors persists and survives reload.
- Moving to top and bottom still produces rank keys outside the neighbor bounds.

No frontend test updates are required unless an existing test hard-codes oldest-first create order against API-created rows.

## File Change Map

- Modified: `worktracker/worktracker/work_items.py`
  - Add `prepend_rank(project_id)`.
- Modified: `worktracker/worktracker/services/work_items.py`
  - Import `prepend_rank`.
  - Swap both create seams from bottom seeding to top seeding.
- New: `worktracker/worktracker/migrations/0010_rank_newest_first.py`
  - Restamp existing project ranks newest-first.
- Modified or new tests: `worktracker/worktracker/tests/test_service_work_items.py`
  - Cover helper behavior and create ordering.
- New migration test: `worktracker/worktracker/tests/test_migration_0010.py`
  - Cover data restamp behavior.
- Read-only: `worktracker/ranking.py`
  - Existing rank primitive remains the source of truth.
- Read-only: `worktracker/worktracker/api/work_items.py`
  - API contract remains unchanged.
- Read-only: `studio/src/workitems/internal/backlogSelectors.ts`
  - Frontend sort mirror remains unchanged.

## Step-by-Step Implementation Plan

1. Add focused tests for `prepend_rank` before editing production rank allocation.
2. Add `prepend_rank(project_id)` in `work_items.py` using the project minimum rank and `key_between`.
3. Update service imports and replace `append_rank` with `prepend_rank` in the project and module create paths.
4. Update create-order tests that currently expect increasing ranks to expect newest-first ranks.
5. Add migration `0010_rank_newest_first.py` with per-project descending `sequence_id` restamping.
6. Add migration test coverage for the restamp.
7. Run the backend rank/reorder/migration test subset.
8. Run the broader existing backend test target normally used for `worktracker` before handing off implementation.

## Non-Goals

- No frontend sorting changes.
- No new rank field or per-surface rank model.
- No changes to drag/drop neighbor semantics.
- No preservation of pre-migration manual ordering.
- No changes to sequence allocation.

## Risks and Mitigations

- Risk: Migration name collision with the ticket text's requested `0007`.
  - Mitigation: Use `0010` because this checkout already has migrations through `0009`.
- Risk: Restamping overwrites manual ordering.
  - Mitigation: This is explicitly accepted in the task scope and is isolated to the one-time migration.
- Risk: Empty-rank rows sort before ranked rows before migration.
  - Mitigation: The migration rewrites all project issues with non-empty generated ranks.
- Risk: Create tests may encode oldest-first assumptions.
  - Mitigation: Update only tests whose expectation is specifically the create seed direction; keep reorder behavior assertions intact.

## Acceptance Checklist

- New project and module work items seed above all existing project-ranked items.
- Backlog, Board columns, and Story Map cells become newest-first wherever they sort by the shared rank.
- Existing items are restamped newest-first by the new migration.
- Manual reorder still persists because `reorder_work_item` and neighbor semantics are unchanged.
- No frontend files are changed.
- Rank, create, reorder, and migration tests pass.
