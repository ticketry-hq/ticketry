# LLD — T738: Collapse loopback HTTP — route owned backend through worktracker services directly

**Module:** `refactor--e6e6fa8f` (Refactor WorkTracker backend around a domain service layer)
**Work item:** #738
**Phase:** LLD (no implementation in this phase)
**Repos touched:**
- `worktracker-stack/worktracker/worktracker/` — new read/query service surface (CORE/generic-relevant).
- `core/core/worktracker_client.py` + `server/` — consolidate the adapter, drop the loopback (server-side overlay/host).

---

## 1. Objective

The ASGI server calls itself over HTTP: `worktracker.api.router` is mounted in-process at `/api/work-tracker`, yet `WorktrackerRepository` reaches those same routes over httpx at `http://127.0.0.1:8787/api/work-tracker`. Replace that self-targeted loopback with **direct in-process Python calls** into the `worktracker` package, and collapse the **two** near-identical adapter copies into **one** server-side adapter.

This is a transport + boundary change, not a behavior change. Every consumer call site, every `core.models` DTO shape, and the externally mounted REST API all stay byte-for-byte the same. The only thing that disappears is the localhost round-trip.

Scope is bounded by three locked decisions from refinement and the sibling tickets:
1. Read path gets first-class **read/query service functions** in `worktracker`, symmetric with #724's mutation services.
2. The adapter **stays server-side** (its current `core.worktracker_client` home) and keeps mapping to `core.models`; `worktracker` never imports `core.models`, preserving the `server → worktracker` dependency direction.
3. No `worktracker_gateway`, no WorkTracker/WorkTracker swappable-bridge abstraction (#739, locked). `resolve_profile`/`NoProfileSelected`/`backend` survive untouched (their removal is #741).

---

## 2. Current state

### 2.1 The duplication

| File | Role | Imported by production? |
| --- | --- | --- |
| `core/core/worktracker_client.py` | **Live** adapter: `WorkTrackerRepository` (SDK) + `WorktrackerRepository` (httpx loopback) + `get_repo`/`repository_for`/`resolve_profile`/`resolve_profile_index`/`NoProfileSelected`. | Yes — `terminals/{api,consumers}.py`, `documents/api.py`, `worktrees/api.py`, `studio_server/api.py`. |
| `server/studio_server/worktracker_repo.py` | Near-identical **duplicate** `WorktrackerRepository` + its own `NoProfileSelected`/`resolve_profile`/`repository_for`/`get_repo`. | **No.** Only its own egg-info `SOURCES.txt` plus a filename coincidence with `tests/worktracker/test_worktracker_repo.py` (which actually imports `core.worktracker_client`). |

Consolidation = delete the duplicate, keep the one in `core.worktracker_client`.

### 2.2 The adapter contract (what callers depend on)

`WorktrackerRepository` exposes **9 async methods** — 7 reads + 2 writes. (The ticket body enumerates "6 reads"; that list omits `get_module_task_summaries`, which is also a read the scope explicitly requires preserved. This LLD treats it as the 7th read.)

| # | Method | R/W | Live call site(s) |
| --- | --- | --- | --- |
| 1 | `get_projects()` | R | (none today, kept for contract parity) |
| 2 | `get_modules(project_id)` | R | `consumers.py`, `documents/api.py` |
| 3 | `get_tasks_and_states(project_id, module_id)` | R | `consumers.py` |
| 4 | `get_module_task_summaries(project_id, module_id)` | R | `terminals/api.py` |
| 5 | `get_subtasks(project_id, issue_id)` | R | (none today, kept for contract parity) |
| 6 | `get_states(project_id)` | R | (none today, kept for contract parity) |
| 7 | `get_task_details(project_id, issue_id)` | R | `consumers.py`, `documents/api.py` |
| 8 | `create_module(project_id, name)` | W | (kept for contract parity) |
| 9 | `update_task_state(project_id, issue_id, state_id)` | W | (kept for contract parity) |

All callers `await` these methods. All but one wrap them in a broad `except Exception`. The single exception is `terminals/api.py` (see §7).

---

## 3. Target architecture

Three layers, one dependency direction (`server → worktracker`, never the reverse):

- **`worktracker` (CORE).** Owns all read and write behavior over the Django ORM. Mutation services already exist (`services/modules.py`, `services/work_items.py`, …). This ticket adds a **read/query surface** that returns plain, framework-neutral Python data (`dict`/`list`/`tuple` of primitives). It imports nothing from `core`.
- **Adapter (server-side, `core/core/worktracker_client.py`).** `WorktrackerRepository` keeps its async 9-method contract. Each method calls a worktracker service inside `sync_to_async` and maps the returned plain data into `core.models` DTOs using the **existing** dict→DTO mappers. No transport.
- **Consumers (server-side: terminals, documents, worktrees).** Unchanged call sites. One narrow `except` clause retargeted (§7).

The httpx client, base-URL normalization, and api-key header all leave the owned path entirely.

---

## 4. New worktracker read surface

### 4.1 Module placement

Add one new module: **`worktracker/services/queries.py`**. It is the read peer of the existing mutation services and maps 1:1 onto the adapter's read methods. Reasons for a dedicated module rather than scattering reads into `services/{projects,modules,work_items}.py`: it keeps the read surface cohesive, makes the read/write split legible (symmetric with #724/#735), and gives the adapter a single import target.

It depends only on existing worktracker internals already used by the route handlers: `worktracker.models`, `worktracker.work_items` (`task_qs`, `issue_qs`, `resolve_issue`), and `worktracker.services.errors`.

### 4.2 The contract: plain dicts shaped like the current `*Out` subset

The query functions return the **same data the REST API serializes today, restricted to the fields the adapter actually reads.** This is the central parity lever: because the returned `dict` keys match the existing `WorkItemOut` / `StateOut` / `ProjectOut` / `ModuleOut` field names, the adapter's existing `_to_task_summary` / `_to_state` mappers consume them **verbatim** — no field gymnastics, no DTO shape drift.

The query functions build these dicts from ORM objects directly (no Ninja `Schema` import — services stay framework-neutral per #735). All ORM access (lazy relations, the `child_count` annotation) happens **inside** the query function so it runs entirely within the `sync_to_async` thread; the returned value is fully materialized primitives.

Per-work-item dict — exactly the subset the adapter reads (a strict subset of `WorkItemOut`):

| Key | Source | Notes |
| --- | --- | --- |
| `id` | `issue.id` | stringified by adapter |
| `name` | `issue.name` | |
| `project_id` | `issue.project_id` | |
| `sequence_id` | `issue.sequence_id` | |
| `priority` | `issue.priority` | |
| `state` | nested `{id, name, group, color}` or `None` | from `issue.state`; the adapter's `"Unknown"` fallback handles `None` |
| `assignees` | `[{display_name, email}, …]` | from `issue.assignees.all()` |
| `labels` | `[{name}, …]` | from `issue.labels.all()` |
| `description_html` / `description_stripped` / `description` | issue fields | |
| `parent_id` | `issue.parent_id` or `None` | |
| `sub_issues_count` | annotated `child_count` (fallback `issue.children.count()`) | mirrors `WorkItemOut.resolve_sub_issues_count` |

Fields the adapter never reads (`key`, `rank`, `blocked_by_ids`, `blocks_ids`, `sprint_id`, `created_at`, `updated_at`, `is_archived`, `issue_type`) are **not** materialized — keeping the read surface minimal.

### 4.3 Function-by-function map

Each function is **sync** (plain Django ORM). The "Today's logic" column is the route handler whose behavior must be reproduced exactly.

| Query function (new) | Replaces adapter method | Today's route logic | Returns |
| --- | --- | --- | --- |
| `list_projects()` | `get_projects` | `Project.objects.all()` → `ProjectOut(id,name,slug)` | `list[{id, name, slug}]` |
| `list_modules(project_id, include_archived=False)` | `get_modules` | `api/modules.list_modules`: `Issue.filter(project,type="module")`, exclude archived | `list[{id, name, project_id}]` |
| `list_states(project_id)` | `get_states` | `api/configuration.list_states`: `State.filter(project).order_by(sort_order, created_at)` | `list[{id, name, group, color}]` |
| `list_module_tasks_and_states(project_id, module_id)` | `get_tasks_and_states` | `api/work_items.list_module_work_items` (subtree) **+** `list_states`; adapter then keeps only direct children (`parent_id == module_id`) | `tuple[list[work-item dict], list[state dict]]` |
| `list_module_task_subtree(module_id, include_archived=False)` | `get_module_task_summaries` | `api/work_items.list_module_work_items`: full task-descendant subtree via the BFS frontier walk, ordered `rank, sequence_id` | `list[work-item dict]` (full subtree) |
| `list_subtasks(project_id, parent_id)` | `get_subtasks` | `api/work_items.list_work_items` filtered by `parent` | `list[work-item dict]` |
| `retrieve_work_item(issue_id)` | `get_task_details` | `api/work_items.retrieve_work_item`: `resolve_issue(issue_id)` (attachments dropped — adapter ignores them) | single `work-item dict` |

Design notes that are decisions, not options:

- **One query function per logical read, even when today's adapter made two HTTP calls.** `get_tasks_and_states` today fires two parallel httpx GETs (items + states); in-process they collapse into **one** `list_module_tasks_and_states` executed in a **single** `sync_to_async` hop. This avoids a second thread/connection hop and keeps the two reads transactionally adjacent. (`get_states` standalone keeps its own function for the `get_states` method.)
- **`list_module_tasks_and_states` returns the full subtree, not the pre-filtered direct children.** The "direct children only" filter (`parent_id == module_id`) is the adapter's responsibility today and stays in the adapter, so the two methods (`get_tasks_and_states` vs `get_module_task_summaries`) keep their distinct semantics from one shared query.
- **`child_count` annotation.** The work-item dict's `sub_issues_count` must come from the `task_qs()` / `issue_qs()` `child_count` annotation (which already excludes archived children per #633), matching `WorkItemOut.resolve_sub_issues_count`. The query functions therefore source their querysets from `task_qs()` (tasks) so the annotation is present; the standalone serializer falls back to `children.count()` when unannotated, exactly as the schema does.
- **`retrieve_work_item` uses `worktracker.work_items.resolve_issue`** (UUID-or-`KEY-N`), reproducing the route. The adapter passes `issue_id` straight through.

### 4.4 Error contract for reads

The query functions raise the **framework-neutral** `worktracker.services.errors` family (the #735 contract), never Django `Http404` or httpx errors:

- `resolve_issue` raises Django `Http404` (`get_object_or_404`). `retrieve_work_item` **catches `Http404` and re-raises `NotFoundError`** so the service boundary stays framework-neutral. (This is the only read with a not-found path today; the list reads return empty lists for an unknown project/module, matching current behavior.)
- The list functions perform no existence check that the route didn't, so they raise nothing new.

---

## 5. Write path

No new write services — the two writes route through the **existing** #724 mutation services:

| Adapter write | Existing service call | Post-call shaping |
| --- | --- | --- |
| `create_module(project_id, name)` | `services.modules.create_module(project_id, name)` → returns the created `Issue` (module) | Map to `ModuleSummary(id, name, project_id)`. The module `Issue` already carries these attributes directly; no re-query needed. |
| `update_task_state(project_id, issue_id, state_id)` | `services.work_items.update_work_item(issue_id, state_id=state_id)` → returns the updated `Issue` | The service return lacks the `child_count` annotation and nested-state convenience the DTO needs; **re-resolve** via `worktracker.work_items.resolve_issue(str(issue.id))` (exactly as the PATCH route does) to obtain the annotated `task_qs` row, serialize to the work-item dict, then map to `TaskSummary`. |

To keep mapping uniform, the cleanest split is a thin write-side query: `update_work_item` then `resolve_issue` are both ORM work and run inside the **same** `sync_to_async` hop. This is implemented as a small composition in `queries.py` (e.g. `apply_state_and_reload(issue_id, state_id)` returning the work-item dict) so the adapter performs exactly one thread hop per write and never touches the ORM outside it. `create_module` is similarly composed (`create_module_and_serialize`) returning the module dict.

---

## 6. Adapter changes (`core/core/worktracker_client.py`)

### 6.1 Removed

- `import httpx`.
- Module constants `OWNED_API_PATH`, `LOCAL_OWNED_API_URL`.
- `_normalize_owned_api_url(...)`.
- On `WorktrackerRepository`: `_open()`, the `_base_url` / `_headers` instance state, and the `x-api-key` header plumbing. `_set_profile` no longer stores any transport details. `workspace_slug` is dropped (no in-process read consumes it).

### 6.2 Kept unchanged

- The class name `WorktrackerRepository` and all 9 async method **signatures** (so every call site and every `monkeypatch.setattr(pc.WorktrackerRepository, …)` in tests keeps working).
- The dict→DTO mappers `_to_task_summary(item: dict)` and `_to_state(raw: dict | None)` — they already consume the exact dict shape §4.2 defines, so they are reused **verbatim** (their docstrings retarget "owned REST API" → "worktracker query service").
- `WorkTrackerRepository` (SDK) entirely — its removal is #741.
- `NoProfileSelected`, `load_config`, `resolve_profile`, `resolve_profile_index`, `repository_for`, `get_repo` — profile/backend resolution is out of scope (#741).

### 6.3 Method bodies (the transform)

Each method becomes: call the worktracker query/service through `sync_to_async`, then map the returned plain data with the existing mappers. Pattern, per method:

- `get_projects` → `await sync_to_async(queries.list_projects)()` → `[ProjectSummary(id, name, identifier=p["slug"]) …]`.
- `get_modules` → `await sync_to_async(queries.list_modules)(project_id)` → `[ModuleSummary …]`.
- `get_states` → `await sync_to_async(queries.list_states)(project_id)` → `[self._to_state(s) …]`.
- `get_tasks_and_states` → `items, states = await sync_to_async(queries.list_module_tasks_and_states)(project_id, module_id)`; tasks = `[self._to_task_summary(i) for i in items if str(i["parent_id"]) == str(module_id)]`; states = `[self._to_state(s) …]`. **Direct-children filter stays in the adapter.**
- `get_module_task_summaries` → `await sync_to_async(queries.list_module_task_subtree)(module_id)` → `[self._to_task_summary(i) …]` (full subtree, no filter).
- `get_subtasks` → `await sync_to_async(queries.list_subtasks)(project_id, issue_id)` → `[self._to_task_summary(i) …]`.
- `get_task_details` → `await sync_to_async(queries.retrieve_work_item)(issue_id)` → `TaskDetails(task=self._to_task_summary(item))`.
- `create_module` → `await sync_to_async(queries.create_module_and_serialize)(project_id, name)` → `ModuleSummary(…)`.
- `update_task_state` → `await sync_to_async(queries.apply_state_and_reload)(issue_id, state_id)` → `self._to_task_summary(item)`.

`asyncio.gather` of two `asyncio.to_thread` calls disappears wherever it existed (it's now a single `sync_to_async` hop).

### 6.4 Async/sync boundary

Use `asgiref.sync.sync_to_async` (already a Django dependency) at the adapter edge — **not** `asyncio.to_thread`, because the wrapped code touches the Django ORM and `sync_to_async` carries the correct thread-sensitive context. The query functions are fully synchronous and return materialized primitives, so no ORM object crosses the async boundary and no lazy relation is touched outside the sync thread (avoids `SynchronousOnlyOperation`).

---

## 7. Error mapping and consumer edits

### 7.1 What propagates

`worktracker.services.errors.ServiceError` (and subclasses `NotFoundError` 404 / `ValidationError` 422 / `ConflictError` 409) propagate from the adapter **as-is**. The adapter introduces **no** new exception type and does **no** translation back to HTTP. Rationale: today consumers see `httpx.HTTPStatusError` / `httpx.RequestError`; `ServiceError` is the in-process peer and carries `status_code` + `message`, so any future consumer that wants HTTP semantics has them.

### 7.2 Consumer behavior — preserved by construction

- `terminals/consumers.py` (3 read sites) and `documents/api.py` (1 site) wrap adapter calls in **`except Exception`** → `ServiceError` is caught identically to the old httpx errors. **No edit needed.**
- `worktrees/api.py` imports only `NoProfileSelected` + `resolve_profile_index` (profile resolution, no repo read). **No edit needed.**

### 7.3 The one required consumer edit — `terminals/api.py`

`get_module_task_summaries` is wrapped in `except httpx.RequestError as exc:` (degrade to `tasks = []` when topology is unavailable). After the loopback is gone there is no httpx error to catch.

- Retarget the catch to **`except Exception as exc:`** — strictly broader, preserving the "topology unavailable → empty list, log a warning" degrade for any in-process read failure (`NotFoundError`, ORM/DB error, …).
- Remove `import httpx` from `terminals/api.py` (its only use).

This is the **sole** production consumer change; everything else is unchanged.

---

## 8. Deletions and test updates

### 8.1 Delete

- `server/studio_server/worktracker_repo.py` — dead duplicate, no production importer.
- `server/studio_server/tests/worktracker/test_worktracker_repo.py` — an S3 contract test that drives the **httpx** repository against a live provisioned owned backend. Once the transport is gone the httpx contract it asserts no longer exists; the in-process path is covered by new tests (§9). Delete it (the "test name coincidence" the refinement flagged).

### 8.2 Update

- `server/studio_server/tests/worktracker/test_selection.py` — imports `LOCAL_OWNED_API_URL` (being removed) and asserts `repository_for(...)` returns a `WorktrackerRepository` for owned / backend-absent profiles. Drop the `LOCAL_OWNED_API_URL` import and any assertion about base-URL normalization; **keep** the profile/backend-selection assertions (that behavior is unchanged and out of #738's scope to alter).
- `server/terminals/tests/test_api.py` — the failure-path test raises `httpx.ConnectError` to exercise the degrade-to-empty branch. Retarget it to raise a generic `Exception` (or a `ServiceError`) from the patched `get_module_task_summaries`, matching the new `except Exception`; drop `import httpx` if it becomes unused.
- `server/terminals/tests/test_consumers.py`, `server/documents/tests/test_docs.py` — these `monkeypatch.setattr(pc.WorktrackerRepository, <method>, fake)` and never construct transport. They keep working **as-is** (class + method names preserved); no change unless an assertion inspects removed attributes.

### 8.3 Egg-info

`worktracker_repo.py` lingers in `muxed_server.egg-info/SOURCES.txt`; that file regenerates on build and needs no manual edit.

---

## 9. Parity invariants (must hold after the change)

1. **State fallback** — a `None`/absent state serializes to `TaskState(name="Unknown")` (adapter `_to_state`).
2. **`sub_issues_count`** — sourced from the `child_count` annotation (archived children excluded, #633), not recomputed differently.
3. **Module membership** — `get_tasks_and_states` returns only the module's **direct children** (`parent_id == module_id`); `get_module_task_summaries` returns the **full task-descendant subtree** (#516 roll-ups).
4. **Ordering** — work-item lists keep `order_by("rank", "sequence_id")`; states keep `order_by("sort_order", "created_at")`.
5. **Archived hidden** — list reads exclude `is_archived=True` (no `include_archived` is exposed to the adapter; default `False`, matching today's API default).
6. **`ProjectSummary.identifier`** — populated from the project `slug`.
7. **DTO shapes** — `ProjectSummary` / `ModuleSummary` / `TaskState` / `TaskSummary` / `TaskDetails` / `AssigneeSummary` / `LabelSummary` returned with identical fields and types.
8. **External REST API untouched** — `/api/work-tracker` routes, schemas, status codes, OpenAPI, and the SDK path are not modified. Only the owned-backend adapter stops calling them over the wire.

---

## 10. Implementation sequence

1. **Add `worktracker/services/queries.py`** with the 7 read functions (§4.3) + the two write compositions (§5), returning the plain dicts of §4.2 and raising the §4.4 error contract. Pure ORM; no `core` import, no Ninja `Schema` import.
2. **Unit-test `queries.py`** in the worktracker suite against fixtures: shape parity with the current `*Out` subset, ordering, archived exclusion, `child_count`, `Http404 → NotFoundError`.
3. **Rewrite `WorktrackerRepository`** in `core/core/worktracker_client.py` (§6): delete transport, switch each method to `sync_to_async(queries.*)` + existing mappers, keep signatures.
4. **Edit `terminals/api.py`** (§7.3): retarget the `httpx.RequestError` catch to `Exception`; drop `import httpx`.
5. **Delete** the duplicate module + its contract test; **update** `test_selection.py` and `test_api.py` (§8).
6. **Run both suites** (server + worktracker) and the boundary grep (§11).

Ordering rationale: the query surface lands and is proven first (1–2), so the adapter rewrite (3) targets a known-good API; the consumer/test cleanup (4–5) follows; verification last.

---

## 11. Verification

- **No loopback** — grep the owned adapter path for `127.0.0.1`, `/api/work-tracker`, `httpx`, `x-api-key`, `_normalize_owned_api_url`, `LOCAL_OWNED_API_URL`, `OWNED_API_PATH`: zero hits in `core/core/worktracker_client.py` and `server/terminals/api.py`.
- **Single adapter** — `server/studio_server/worktracker_repo.py` absent; exactly one `class WorktrackerRepository` in the tree (`core.worktracker_client`).
- **In-process reads** — `worktracker/services/queries.py` exists and is the adapter's read source; both reads and writes go through the `worktracker` package.
- **Dependency direction** — no `core` import anywhere under `worktracker/`.
- **Green suites** — server test suite (incl. `terminals`, `documents`) and worktracker test suite pass; the consumer behavior (degrade-to-empty, `except Exception` paths) is exercised.

---

## 12. Out of scope (separate tickets)

- **#741** — drop WorkTracker/WorkTracker switchability, delete `WorkTrackerRepository`, simplify profile resolution. This ticket keeps `resolve_profile` / `NoProfileSelected` / the `backend` field and the `studio_server` `NoProfileSelected` exception handler intact.
- **#737** — the `core/` → `server/` packaging merge. The adapter is consolidated at its current `core.worktracker_client` home regardless of #737.
- Any change to WorkTracker's HTTP API paths, schemas, status codes, OpenAPI, or SDK behavior. The mounted `/api/work-tracker` router stays for external/SDK callers.

---

## 13. Acceptance trace

| Acceptance criterion (ticket) | Satisfied by |
| --- | --- |
| No httpx call targets `127.0.0.1` / `/api/work-tracker` from the owned adapter path | §6.1, §11 |
| Exactly one `WorktrackerRepository`; duplicate gone | §8.1, §11 |
| worktracker exposes read query functions used in-process; reads + writes both via the package, no loopback | §4, §5, §11 |
| Consumer behavior + `core.models` DTO shapes unchanged; both suites green | §7, §9, §11 |
