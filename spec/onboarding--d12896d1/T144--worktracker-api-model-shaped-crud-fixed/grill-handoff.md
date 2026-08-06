# Grill handoff — T144 WorkTracker API: model-shaped CRUD, fixed read contract, declared routes

**Status:** COMPLETE (2026-08-05). All questions below are resolved. The
spec on CODING-144 and `lld.md` in this directory are the authoritative
record; this file is kept only as the audit trail of the interview.

**Prior art already accepted, do not re-litigate:**
`backend/worktracker/docs/adr/0005-model-shaped-crud-with-quarantined-rpc.md`
(accepted), `backend/worktracker/docs/adr/0006-graphql-considered-and-rejected.md`,
`docs/decisions/2026-08-04-frontend-state-and-api-contract.md`. The DRF-for-CRUD
choice, the quarantine concept, and the route registry are settled. The glossary
already carries **Route registry**, **Canonical collection read** and **Domain
operation** (`backend/worktracker/CONTEXT.md:198-219`).

***

## 1. Decisions confirmed this session

### D1 — Related objects serialize as bare ids, both `state` and `issue_type`

```json
{ "state": "3f2a…", "issue_type": "9c1b…" }
```

Replaces today's nested `StateOut` / `IssueTypeOut` objects
(`backend/worktracker/schemas.py:98-125`).

**Why.** Two documents contradicted each other and one had to give:
`WorkItemOut`'s docstring defends nesting (*"`state` is always one nested
object … never a bare id"*), while invariant 1 of the decision record
(`docs/decisions/2026-08-04-frontend-state-and-api-contract.md:315`) says *"A
record exists in exactly one place. Everything else holds ids."*

The deciding evidence was that nesting **reproduces CODING-142's own bug on a
different field**. `update_state` (`backend/worktracker/services/workflow_config.py:181-205`)
renames or recolours a State and saves *only the State* — no work-item revision
bump, no change frame. A work item's `state_revision` advances only for changes
to the work item itself (`CONTEXT.md:163`). So renaming the "Grill" state leaves
every cached work-item row carrying the stale copy. That is the exact mechanism
this ticket's parent exists to fix.

**Consequences, measured:**

| Consumer            | Effect                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP / agent surface | Already flattens `state` to an id by hand at `surfaces/worktracker-agent/api/service.py:140` — that line gets **deleted**. It wants flat.                                                                                                                 |
| MCP / agent surface | Does keep nested `issue_type` (`api/schemas.py:65`) because agents read the type *name*. Must now join id→name against `list_issue_types(project_id)`, which it already calls at `service.py:197`. This is the one real cost of D1.                       |
| Studio              | 71 read sites of `x.state?.name/color/group` across 17 non-test files, plus 13 in tests. **All already inside the Redux big-bang blast radius** (205 read sites being rewritten regardless), so flattening is near-free now and a second migration later. |

**Follow-on work D1 implies:** amend or delete the `WorkItemOut` docstring's
defence of nesting, so the next reader does not restore it.

***

## 2. Facts established (grounded — do not re-derive)

Full inventory in this session; summary:

* **44 operations total**, confirmed. Mounted `/api/` → `/work-tracker`
  (`backend/studio_server/urls.py:18`, `backend/studio_server/api.py:20`).
* **DRF is not present.** Not in `backend/pyproject.toml:6-17`, not in
  `INSTALLED_APPS` (`backend/studio_server/settings.py:28`). Neither is
  `drf-spectacular`. Note there are **two** settings modules that must both gain
  it: `studio_server/settings.py` and `worktracker/tests/settings.py:9` (the
  latter has its own `ROOT_URLCONF`).
* **`openapi.json` is produced by a ninja-only builder.**
  `worktracker/openapi.py:13` spins up a standalone `NinjaAPI`, mounts the shared
  router, exports paths under `/api/work-tracker`
  (`management/commands/export_openapi.py:22`). Both SDKs generate from that one
  document (`scripts/generate-{typescript,python}-sdk.mjs:14`); the MCP surface
  consumes the Python SDK. **The 28 async `apps/*` handlers are not in that
  document at all.** Aggregate command: `npm run contract:generate`
  (`package.json:27`).
* **Auth** is router-level: `Router(tags=["worktracker"], auth=ApiKeyAuth())`
  (`api/router.py:11`), an `APIKeyHeader` on `x-api-key` (`auth.py:5,13`). All 44
  ops inherit it; none overrides. `WORKTRACKER_DISABLE_AUTH` bypasses globally.
* **Error seam** is a single context manager `_http_errors()` (`api/router.py:14`)
  mapping `ServiceError` → ninja `HttpError`; the docstring states `HttpError`
  must appear nowhere else. The workflow gate's structured 422 bypasses it by
  returning `JsonResponse(exc.as_body(), 422)` directly
  (`api/work_items.py:262`).
* **Nothing paginates.** Every list read returns its full set. Work-item lists
  order by `rank, sequence_id` (`api/work_items.py:92,179`). `GET /projects` and
  `GET /projects/{id}/modules` have **no ordering at all** —
  unspecified database order (`api/projects.py:22`, `api/modules.py:19`;
  `Project.Meta` has no `ordering`, `models/project.py:30`).
* **Non-model fields on `WorkItemOut`:** `key` is a model *property*
  (`models/issue.py:94`), `sub_issues_count` is an annotation that excludes
  archived children (`schemas.py:143`, `work_items.py:26`), `blocked_by_ids` /
  `blocks_ids` are resolvers over M2M edges (`schemas.py:133,138`).
* **Test split.** \~29 HTTP-level test files (re-authored) vs \~15 dedicated
  service/domain files plus 16 migration files (carried over untouched). Largest
  HTTP clusters: `test_types_states_config.py` (23 HTTP),
  `test_mutations.py` (23 HTTP), `test_work_items_api.py` (18),
  `test_scoped_workflow_api.py` (16), `test_owned_tool_behaviors.py` (15).

***

## 3. Contradictions found in the existing documents

These need resolving in the spec, not just noting:

1. **Nesting vs invariant 1** — resolved by D1 above. The `WorkItemOut`
   docstring must be amended.
2. **The quarantine's framework is never stated.** ADR 0005 says ninja stays
   "for the 28 async handlers in `apps/*`" and says the non-CRUD half moves to
   "a named quarantine module" — without saying on which framework. This decides
   whether `openapi.json` comes from one generator or needs a **two-generator
   merge**, which is unspecified work.
3. **Four ops are quarantined that are honestly CRUD** (see Q1 below). Shipping
   the registry with them marked "exceptional" is the mislabelling that user
   story 22 exists to prevent.

***

## 4. Open questions, in dependency order

### Q1 — Reclassify the four CRUD-in-disguise ops before implementing? *(asked, deferred to next agent at the user's request — ask this first)*

The user pushed back hard on quarantine-vs-CRUD and the pushback was partly
right. Established during that exchange:

**Genuinely resists CRUD, with evidence:**

| Reason                                                                                                                                                                              | Ops                                                                               | Evidence                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Write cascades and returns something other than what you wrote — deleting one transition also deletes *other* transitions and launch bindings, then returns the recomputed workflow | transitions ×3, remove-state, start-state                                         | `_delete_impact_rows`, `services/scoped_workflows.py:189-195`; all return `ScopedWorkflowOut` |
| Writes nothing — a POST body describing a hypothetical                                                                                                                              | workflow impact, state impact                                                     | `preview_impact`, `scoped_workflows.py:198`                                                   |
| There is no model — a Python registry, a `Dict[str, List[UUID]]`, a graph walk, a composite across three models                                                                     | provider-capabilities, subtree-run-capabilities, scope-context, workflow-settings | `launch_capabilities.py:33`; `build_scope_context`                                            |
| Multi-row atomic total reordering via `ordered_ids` — not an update to *a* resource                                                                                                 | states/reorder, issue-types/reorder                                               | `ReorderIn`, `schemas.py:355`                                                                 |
| Server computes a value the client cannot; deliberately the *sole* rank write path "so the fractional-key algebra can't be bypassed"                                                | work-item reorder                                                                 | `api/work_items.py:281`                                                                       |

**Honestly CRUD, should probably leave the quarantine:**

| Op                                            | Why                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /workspace`                              | A retrieve of one model row; only "special" because it is a singleton with no path id            |
| `GET /projects/{id}/launch-bindings`          | A plain collection read of `LaunchBinding` — the definition of a canonical collection read       |
| `PATCH .../auto-start`, `PUT .../subtree-run` | Two booleans on one `LaunchBinding` row; one `PATCH /launch-bindings/{type}/{state}` covers both |
| `PUT/DELETE .../launch-bindings/{state_id}`   | Upsert/delete of a `LaunchBinding` by composite key — CRUD with a two-part id                    |

**On the line, argue each:** `acknowledge` is one boolean but deliberately
one-way ("no inverse action is exposed", `api/workspaces.py:26`) and a `PATCH`
would expose the inverse; `review-findings` creates an `Issue` but rejects a
non-Story-in-Review parent *before any write*; state transitions are already a
`PATCH` — CRUD with a gate, correctly not quarantined.

**Recommendation:** reclassify all four. Quarantine 21 → \~16, CRUD 22 → \~27.
Costs: `LaunchBinding` needs a composite-key viewset, the launch-binding writes
must stop returning `ScopedWorkflowOut`, and auto-start must keep its "refuse if
no launch configuration exists" guard (`CONTEXT.md:147`) as serializer
validation.

### Q2 — Which framework serves the quarantine? *(drafted, not asked — blocked on Q1)*

* **DRF standalone `APIView`s (recommended).** All worktracker ops on DRF, one
  schema generator, one `openapi.json`, `worktracker/openapi.py` deleted. Must
  be plain `APIView`s in one module, **not** `@action` on the viewsets — an
  `@action` puts the domain op back inside the CRUD class and destroys
  countability.
* **Keep quarantine on ninja.** Zero rewrite of the hardest handlers, but
  requires building and maintaining a two-generator `openapi.json` merge and
  reconciling two error conventions in one surface.

### Q3 — Pagination policy *(never asked; explicitly open at `docs/decisions/2026-08-04-…:307`)*

Nothing paginates today. Needs a threshold, an envelope, and a decision on
whether it applies at all — the module read must return every descendant because
three features depend on it (collapsed-branch subtree chicklets, cross-descendant
search, live-terminal cycling), per the rejected `(module, state)` endpoint at
`…:290-296`. Interacts with that deferred endpoint.

### Q4 — Do the two work-item list scopes both survive?

The spec says both may exist but "neither is a filtered variant of the other".
**Fact: today they are strictly nested.** `listProjectWorkItems` with no `parent`
returns every task in the project; `listModuleWorkItems` returns a module's
descendant subtree — a strict subset. The decision record diagrams the full
containment chain at `…:56-61`. So either the project-scope read goes, or the
"not a filtered variant" claim needs restating.

### Q5 — What happens to `include_archived` / `include_pathfind`

Spec says rows the caller may need are always returned and hiding becomes the
caller's derivation. Confirm, and confirm it for the MCP surface too, which
currently relies on server-side hiding. Note `sub_issues_count`'s annotation
*excludes archived children* (`work_items.py:26`) — if archived rows are now
always returned, that count's meaning needs deciding.

### Q6 — The attachments read endpoint's shape

`/work-items/{id}/attachments` (nested, what a nested router generates) vs
`/attachments?work_item=` (flat with a filter — but a query filter is the kind of
thing that forms cache keys, which the read contract forbids). Also: the
single-work-item read stops bundling them, so `WorkItemDetailOut` disappears
entirely and `getWorkItem` returns a bare work item.

### Q7 — What the registry's "route table" spans

Django's resolver sees *everything*. If the conformance test asserts two-way
match over the whole table, the 28 async `apps/*` handlers must also be declared
— they are currently absent even from `openapi.json`. Decide the boundary and how
the test expresses it, since "no undeclared route exists" is meaningless without
a stated scope.

### Q8 — Non-model read fields on the work-item serializer

`key` (model property), `sub_issues_count` (annotation), `blocked_by_ids` /
`blocks_ids` (M2M resolvers). Each needs an explicit `ModelSerializer` field
declaration, which weakens the "adding a model field flows through
automatically" claim. Needs a stated rule for when a computed read field is
allowed.

### Q9 — Auth and the error contract on DRF

`ApiKeyAuth` needs a DRF equivalent applied via `DEFAULT_PERMISSION_CLASSES`
(uniform, and story 20 wants the uniformity *asserted*). `_http_errors()` needs
to become a DRF exception handler. The workflow gate's structured 422
(`detail`/`code`/`from`/`to`) must survive byte-for-byte — DRF's default error
body differs, and the UI renders that `detail`.

### Q10 — Sequencing and landing

Does the backend land on its own branch first, or in the same big bang as the
Redux frontend rebuild? The decision record calls this one breaking change
released together (`…:187-189`), but the frontend is a sibling ticket.

### Q11 — DRF in the frozen sidecar

Adding `rest_framework` (+ `drf-spectacular`) means new PyInstaller hidden
imports in `backend/packaging/muxed-backend.spec` and a sidecar rebuild.
`backend/packaging/tests/test_sidecar.py` has 2 tests that exercise worktracker
HTTP through the packaged sidecar and will need to pass.