# LLD — Sprint Lifecycle: auto-naming, goal, explicit Start & Complete-with-carryover (#634)

Builds the delta on top of what already ships (#602 model/CRUD/SDK, #617 lens + single-active guard, #608 sprint-in-details). **No new view, no story points.** Four behaviors land: auto-incrementing names, a sprint goal, an explicit Start op (duration→dates), and an atomic Complete-with-carryover. Absorbs #604's deferred close-as-advance.

## Harness — files touched

**Backend — `worktracker/worktracker/`**
- `models.py` — `Sprint.goal`, `Project.sprint_seq`.
- `migrations/0007_sprint_lifecycle.py` — new (0006 rank already landed; take next free number, rebase if a sibling lands first).
- `schemas.py` — `goal` on `SprintOut`/`SprintIn`/`SprintPatch`; new `SprintStartIn`, `SprintCompleteIn`, `SprintCompleteOut`.
- `api.py` — mint logic in `create_sprint`; new `start_sprint`, `complete_sprint` routes; `patch_sprint` unchanged.

**SDK — `worktracker-sdk/worktracker_sdk/`**
- `models.py` — `goal` on `Sprint`, `SprintCreate`, `SprintUpdate`; new `SprintStart`, `SprintComplete`, `SprintCompleteResult`.
- `resources.py` — `start()`, `complete()` on `SprintsResource`.
- `__init__.py` — export the new input/result models.

**Frontend — `studio/src/`**
- `lib/types.ts` — `goal` on `Sprint`/`SprintCreate`/`SprintPatch`; new `SprintStart`, `SprintComplete` bodies.
- `lib/api.ts` — `startSprint`, `completeSprint` clients.
- `stores/backlog/backlogSprintActions.ts` — `startSprint`, `completeSprint` actions (the store dir was refactored under `backlog/` per #649; the ticket's `backlogStore.ts` path maps here).
- `stores/backlog/backlogStore.ts` — declare + wire the two new actions; add a `nextSprintName` selector or compute inline.
- `stores/backlog/backlogSelectors.ts` — `nextSprintName(sprints)` helper.
- `views/Sprints/NewSprint.tsx` — prefill name with next `Sprint N`; add optional goal field.
- `views/Sprints/StartSprintDialog.tsx` — **new**.
- `views/Sprints/CompleteSprintDialog.tsx` — **new**.
- `views/Sprints/SprintsLens.tsx` — wire Start/Complete buttons to open the dialogs instead of calling `setSprintStatus` directly.
- `views/Sprints/SprintCard.tsx` — render `goal`.

**Tests** — `worktracker` BE suite, `worktracker-sdk/tests`, `studio/src/test` (extend `sprintsLens.test.tsx`, add dialog tests).

## Decision-complete steps

### BE-1 — Model fields (`models.py`)
- Add `Sprint.goal = TextField(blank=True, default="")`.
- Add `Project.sprint_seq = PositiveIntegerField(default=0)` — monotonic per-project sprint counter; **never decremented** on delete (Jira board-counter parity). Document it next to the existing `seq_counter` (issue counter) so the two are not confused: `seq_counter` allocates issue sequence ids, `sprint_seq` allocates sprint display numbers.

### BE-2 — Migration `0007_sprint_lifecycle.py`
- `AddField` `Sprint.goal` (default `""`) and `Project.sprint_seq` (default `0`).
- Data migration (`RunPython`, with a no-op reverse) to backfill `sprint_seq` per project = the **max trailing integer parsed from existing `Sprint.name` values matching `Sprint N`** for that project, else `0`. Names that don't match the pattern contribute nothing. Backfill must be **rerun-safe** (idempotent): recomputing max-from-names yields the same value, so a second run is a no-op.
- `goal` needs no backfill beyond the field default.

### BE-3 — Schemas (`schemas.py`)
- Add `goal: str = ""` to `SprintOut`, `SprintIn`, `SprintPatch`.
- `SprintIn.name` becomes optional (`Optional[str] = None`) so blank/omitted name triggers the mint path; an empty string is treated the same as omitted.
- New `SprintStartIn`: `duration_days: Optional[int] = 14`, `start_date: Optional[date] = None`, `end_date: Optional[date] = None`, `goal: Optional[str] = None`.
- New `SprintCompleteIn`: `carryover: Literal["backlog", "sprint"]`, `target_sprint_id: Optional[UUID] = None`.
- New `SprintCompleteOut`: `sprint: SprintOut`, `moved_count: int`.

### BE-4 — `create_sprint` mint logic (`api.py`)
- Inside the existing route: if `payload.name` is `None` or empty/whitespace → in a transaction, `project.sprint_seq += 1`, `project.save()`, set `name = f"Sprint {project.sprint_seq}"`.
- A caller-supplied non-blank name is honored verbatim and **does not** touch `sprint_seq`.
- Pass `goal=payload.goal` through to `Sprint.objects.create(...)`. Keep existing `status`/`start_date`/`end_date` passthrough.

### BE-5 — `start_sprint` route — `POST /sprints/{sprint_id}/start`
- Body `SprintStartIn`. Load sprint or 404.
- Reuse the single-active guard: if another sprint in the same project (exclude self) has `status="active"` → **409** "another sprint is active". (Mirror the exact check in `patch_sprint`; do not duplicate the rule in a way that can drift — keep the one canonical query shape.)
- Set `status="active"`; `start_date = body.start_date or today`; `end_date = body.end_date or (start_date + timedelta(days=body.duration_days or 14))`. If both `start_date` and `end_date` are explicitly supplied, honor them as-is and ignore `duration_days`.
- If `body.goal` is not `None`, set `sprint.goal`.
- Save, return `SprintOut`.
- Edge: starting an already-`active` sprint (self) is idempotent (no other-active conflict with self excluded) — re-stamps dates per the body; acceptable, not an error.

### BE-6 — `complete_sprint` route — `POST /sprints/{sprint_id}/complete`
- Body `SprintCompleteIn`. Load sprint or 404.
- If `sprint.status == "completed"` → **409** "sprint already completed".
- Validate carryover target (before any write):
  - `carryover == "sprint"` requires `target_sprint_id`; if missing → **422**.
  - `target_sprint_id` must not equal the sprint being completed → **422**.
  - target must exist, belong to the **same project**, and not be `completed` → else **422**.
- In `transaction.atomic()`:
  - Set `sprint.status = "completed"`, save.
  - Re-point **unfinished** members only: `Issue.objects.filter(sprint_id=sprint.id)` whose `state__group NOT IN ("completed", "cancelled")` → update `sprint_id` to `target_sprint_id` (carryover=="sprint") or `None` (carryover=="backlog"). Capture the count as `moved_count`.
  - Done/cancelled members keep `sprint_id` on the completed sprint as history (left untouched).
  - Issues with a `NULL` state (no state group) are treated as unfinished and move (conservative: nothing "done" without a completed/cancelled group).
- Return `SprintCompleteOut { sprint, moved_count }`. A 422 raised inside the block rolls the whole transaction back (no partial move observable).
- Zero unfinished members → succeeds with `moved_count=0`.

### BE-7 — `patch_sprint` unchanged
- Remains the path for rename/recolor/re-date and bare status flips (back-compat for scripts). Add `goal` passthrough there too (present-key applies) so the PATCH surface stays complete; the lifecycle ops do not replace it.

### SDK-1 — Models (`models.py`)
- Add `goal: str = ""` to `Sprint` (OutputModel — **mandatory**: `extra="forbid"` means a `SprintOut` carrying `goal` without this field rejects every sprint response, same gotcha as #629), `SprintCreate`, `SprintUpdate`.
- Make `SprintCreate.name` optional (`Optional[str] = None`) to mirror the mint path.
- New input models: `SprintStart { duration_days: Optional[int] = 14; start_date: Optional[date] = None; end_date: Optional[date] = None; goal: Optional[str] = None }`; `SprintComplete { carryover: Literal["backlog","sprint"]; target_sprint_id: Optional[UUID] = None }`.
- New result model `SprintCompleteResult(OutputModel) { sprint: Sprint; moved_count: int }`.
- **Pre-existing mismatch to leave as-is (note, do not fix here):** `Sprint.start_date`/`end_date` are required `date` in the SDK but `Optional` in `SprintOut`; and `SprintsResource.get` parses `SprintDetail`/`SprintProgress` the API never returns. Both are out of scope per the ticket ("server-side progress envelope … wire only if a non-Studio consumer needs it"). Do not widen or rewire them in this story.

### SDK-2 — Resource methods (`resources.py`)
- `start(self, sprint_id, payload: SprintStart) -> Sprint` → `POST sprints/{id}/start`, `json=payload.model_dump(mode="json", exclude_unset=True)`, parse `Sprint`.
- `complete(self, sprint_id, payload: SprintComplete) -> SprintCompleteResult` → `POST sprints/{id}/complete`, same dump, parse `SprintCompleteResult`.
- Export the three new models in `__init__.py` (`SprintStart`, `SprintComplete`, `SprintCompleteResult`).

### FE-1 — Types (`lib/types.ts`)
- Add `goal: string` to `Sprint`; `goal?: string` to `SprintCreate` and `SprintPatch`; make `SprintCreate.name` optional.
- New `SprintStart { duration_days?: number; start_date?: string | null; end_date?: string | null; goal?: string }`.
- New `SprintComplete { carryover: "backlog" | "sprint"; target_sprint_id?: string | null }`.
- New `SprintCompleteResult { sprint: Sprint; moved_count: number }`.

### FE-2 — API clients (`lib/api.ts`)
- `startSprint(id, body: SprintStart) -> Sprint` → `POST /sprints/{id}/start`.
- `completeSprint(id, body: SprintComplete) -> SprintCompleteResult` → `POST /sprints/{id}/complete`.
- Follow the existing `patchSprint` request shape (JSON body, UUID id).

### FE-3 — Selector (`backlogSelectors.ts`)
- `nextSprintName(sprints: Sprint[]): string` — parse trailing integer from each `Sprint N` name, return `Sprint {max+1}` (min `Sprint 1`). Client-side prefill only; the **server is authoritative** on the real number at create time (handles concurrent/raced creates). Used to prefill the input, not to decide the final name.

### FE-4 — Store actions (`backlogSprintActions.ts`)
- `startSprint(set, get, id, body)`:
  - Optimistic: flip that sprint's `status` to `"active"` and apply `goal`/dates from the body locally. Pre-check single-active mirror (refuse with toast if another active, like existing `setSprintStatus`).
  - Call `api.startSprint`; reconcile sprint from the server response (trust server). On non-2xx → roll back the sprint list to snapshot, toast the error (server 409 path).
- `completeSprint(set, get, id, body)`:
  - Snapshot **both** `sprints` and `items`.
  - Optimistic: flip sprint `status` to `"completed"`; move every unfinished member's `sprint_id` locally exactly as BE-6 will (reuse the same group predicate as `sprintProgress`: unfinished = `state?.group !== "completed"` — cancelled don't load) → `target_sprint_id` or `null`.
  - Call `api.completeSprint`; on success reconcile sprint status from `result.sprint` (server source of truth); keep optimistic item moves (server count is informational — optionally toast `Moved N items`).
  - On non-2xx → **roll back every card and the sprint** to the snapshots (no partial board), toast the error.
- Keep `setSprintStatus` for any non-dialog bare flips, but the lens verbs now route through the dialogs.

### FE-5 — Store wiring (`backlogStore.ts`)
- Declare `startSprint(id, body)` / `completeSprint(id, body)` in `BacklogState`; wire to `sprintActions.*` like the existing sprint actions.

### FE-6 — NewSprint (`NewSprint.tsx`)
- Prefill the name input with `nextSprintName(sprints)` on open (sprints read from store) so name is optional — submitting the prefill or a blank field both yield a server-minted name; an edited name is honored.
- Add an optional one-line goal input; pass `{ goal }` through `createSprint`. (Extend the store `createSprint` signature to carry `goal` alongside the existing `dates` arg.)

### FE-7 — StartSprintDialog (`StartSprintDialog.tsx`, new)
- Props: the planned sprint. Fields: name (read-only/prefilled display), optional goal (prefilled from sprint.goal), duration picker — presets **1 / 2 / 3 / 4 weeks** (default **2 weeks** = 14 days) OR explicit start/end dates.
- Disabled/blocked with a clear message ("Complete the active sprint first") when another sprint is active; rely on the server 409 as the backstop (toast + rollback).
- Confirm → `startSprint(id, { duration_days | start_date+end_date, goal })`, close on success.

### FE-8 — CompleteSprintDialog (`CompleteSprintDialog.tsx`, new)
- Props: the active sprint. Show the done/unfinished split from `sprintProgress(items, sprint.id)` (done vs total-done).
- Carryover choice (single): **Backlog** OR a **planned sprint** — dropdown of this project's `planned` sprints, **excluding the sprint being completed and any completed sprint**, plus a "+ new sprint" inline shortcut (calls `createSprint`, then selects it as target).
- If unfinished count == 0 → skip the carryover picker entirely (complete still valid, `moved_count=0`).
- Confirm → `completeSprint(id, { carryover, target_sprint_id })`, close on success; on failure stay open with the error toast (board already rolled back).

### FE-9 — SprintsLens + SprintCard
- `SprintsLens.tsx` — replace the inline `setSprintStatus(active.id, "completed")` / `setSprintStatus(s.id, "active")` button handlers with opening `CompleteSprintDialog` / `StartSprintDialog`. Keep the existing `data-testid` hooks (`complete-{id}`, `start-{id}`) on the trigger buttons so current tests still target them.
- `SprintCard.tsx` — render `sprint.goal` (one muted line under the dates) when non-empty.

## Validation / edge-case matrix (acceptance-aligned)

| Case | Expected |
|---|---|
| Create, blank name | mints `Sprint {seq+1}`, `sprint_seq` incremented |
| Create, explicit name | honored, `sprint_seq` untouched |
| Delete highest sprint, create blank | does **not** reuse the number (counter not decremented) |
| `goal` round-trip model→Out→SDK→Studio | no SDK rejection (SDK field present) |
| `start` no dates, `duration_days=14` | `start=today`, `end=today+14` |
| `start` while another active | **409**, no state change |
| `complete` carryover=backlog | unfinished → `sprint_id=null`; done/cancelled stay; `moved_count` correct |
| `complete` carryover=sprint | unfinished → target; same retention |
| `complete` on completed | **409** |
| `complete` bad/missing/foreign/self/completed target | **422**, full rollback |
| `complete` zero unfinished | succeeds, `moved_count=0` |
| Studio op failure | board + sprint roll back cleanly, toast |

## Out of scope (deferred)
Story points / velocity / burndown; configurable auto-name format; server-side progress envelope; cross-project carryover; per-item partial carryover; date-picker polish; MCP exposure; sprint reordering. Progress stays client-computed and count-based.

## Test plan
- **BE:** counter monotonic across create/delete/create; blank vs explicit name (counter untouched on explicit); start derives end_date from duration; start 409 on 2nd active; complete moves only unfinished; carryover→backlog nulls; carryover→sprint re-points; 409 re-complete; 422 + rollback on bad target; atomicity (no partial move observable on forced failure); backfill rerun-safe.
- **SDK:** `Sprint`/`SprintCreate`/`SprintUpdate` parse `goal`; `start()`/`complete()` hit `sprints/{id}/start|complete` and parse `Sprint`/`SprintCompleteResult`.
- **Studio:** NewSprint prefills next name + goal; Start/Complete dialogs render and dispatch; carryover dropdown excludes completing + completed sprints; optimistic rollback on simulated failure; goal renders on card.
- All three suites green.
