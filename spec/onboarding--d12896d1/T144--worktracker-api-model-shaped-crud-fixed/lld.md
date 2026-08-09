# LLD — T144 WorkTracker API: model-shaped CRUD, fixed read contract, declared routes

Low-level design from the 2026-08-04/05 grill. The Story description on
CODING-144 is the spec; this file adds file-level detail for implementing
agents. File paths were verified during the grill; re-verify before editing.

## 1. New models and migrations (`backend/worktracker/models/`)

### 1.1 Catalog tables (new)

* `Provider`: `slug` (unique, max 64), `activated` (bool, default False),
  `supports_unattended` (bool). A startup guard (extend the existing drift
  guard referenced in `services/launch_capabilities.py` docstring) asserts
  every row's slug exists in the code-owned adapter set, and every adapter
  has a row.
* `Model` (pick a non-clashing class name, e.g. `AgentModel`): `provider` FK
  (PROTECT), `name` (the model id string), unique on (provider, name).
* `ReasoningLevel`: `name` (unique: minimal/low/medium/high/xhigh/max...).
* Link table `AgentModel.permitted_reasoning_levels = M2M(ReasoningLevel)`.

### 1.2 LaunchBinding changes (`models/launch_binding.py`)

* Remove `agent` (CharField) — provider is implied by the model row.
* `model`: CharField → FK to AgentModel, `on_delete=PROTECT`, null allowed
  (unset inherits from the global launch default, unchanged semantics).
* `reasoning`: CharField → FK to ReasoningLevel, PROTECT, null allowed.
  `clean()` validates the level is in the model's permitted links.
* Keep `has_launch_policy`; its `self.agent` check becomes `self.model_id`.
* Keep the "no auto-start without launch configuration" guard
  (`CONTEXT.md:147`) as serializer/model validation.

### 1.3 Data migration

* Seed Provider/AgentModel/ReasoningLevel from today's
  `PROVIDER_CAPABILITIES` in `worktracker/services/launch_capabilities.py`
  (claude, agy, codex, gemini; aliases become AgentModel rows; agy gets
  seeded rows — `accepts_any_model` has no table equivalent, free text is
  removed).
* Map existing LaunchBinding text triples onto rows; create missing
  AgentModel rows for values not in the seed (do not drop user data).
* Move activation from the settings-store JSON
  (`apps/settings_store/provider_catalog.py`, `activated_providers`) into
  `Provider.activated`; delete the JSON field and its accessors. The global
  launch default triple stays in settings JSON but is validated against the
  tables at write.

### 1.4 delete\_state simplification (`services/workflow_config.py`)

* `delete_state(state_id)` only: refuse `protected_state`,
  `last_state_in_group`, and now `occupied` (any Issue in the state) or
  workflow-referenced requiring repair. Delete `reassign_to`,
  `impact_token`, the sha256 token build (\~line 339), `compare_digest`
  checks (\~449-454), and the reassignment loop.
* Delete `get_state_impact` and `preview_impact`
  (`services/scoped_workflows.py:198`) plus `_build_impact`/`_public_impact`
  internals that only served previews. Keep the prune internals
  (`_reachable_state_ids`, `_delete_impact_rows`) — transition delete and
  start-state change still prune.

## 2. DRF surface (`backend/worktracker/`)

New package layout (suggestion): `worktracker/rest/` with `serializers.py`,
`viewsets.py`, `domain_ops.py` (the quarantine — plain APIViews only, never
`@action`), `registry.py`, `urls.py`.

**Ninja removal rule (expand–contract):** DRF mounts beside the ninja router
in the expand ticket, but each migrate ticket DELETES the ninja handlers of
the resource it moves and shrinks the conformance test's tier-2 allowlist in
the same change — two surfaces never serve the same model at once, and no
deletion pile accumulates. The contract ticket removes only the empty shell:
`worktracker/api/` (router, `auth.py`, `_http_errors`, remaining handlers),
`worktracker/schemas.py`, `worktracker/openapi.py`, and
`management/commands/export_openapi.py`'s ninja builder (replace with
drf-spectacular export). Update BOTH settings modules:
`studio_server/settings.py` and `worktracker/tests/settings.py` (own
ROOT\_URLCONF) — add `rest_framework`, `drf_spectacular`.

### 2.1 CRUD resources (viewsets, ModelSerializers)

| Model                                  | Routes                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project                                | list/create/retrieve/patch/delete (as today, DRF-shaped)                                                                                                                                                                                          |
| Module                                 | list under project, create                                                                                                                                                                                                                        |
| WorkItem (Issue)                       | `GET /work-items?project=&module=&state=` (+ existing archived/pathfind hide params, defaults unchanged), create (absorbs review findings — see 2.3), retrieve (bare, no attachments), patch (state moves keep the gate + structured 422), delete |
| Attachment                             | `GET /work-items/{id}/attachments` (new), existing write                                                                                                                                                                                          |
| State                                  | list under project, create, patch, delete (reject-when-occupied)                                                                                                                                                                                  |
| IssueType                              | list under project, create, patch (now also `start_state` — prunes on disconnect), delete                                                                                                                                                         |
| IssueTypeTransition                    | list under issue type (new canonical read), create, patch (agent\_allowed), delete (prunes)                                                                                                                                                       |
| LaunchBinding                          | list under project, PUT/DELETE by (issue\_type, state) composite key; auto\_start + subtree\_run\_enabled are ordinary fields on the write                                                                                                        |
| Workspace                              | retrieve (singleton)                                                                                                                                                                                                                              |
| Provider / AgentModel / ReasoningLevel | list + create/patch/delete (AgentModel rows user-addable; PROTECT errors → 409)                                                                                                                                                                   |

Related objects serialize as **bare ids** (D1) — delete the nested
`StateOut`/`IssueTypeOut` from `schemas.py:98-125` and the `WorkItemOut`
docstring's defence of nesting. Computed read fields allowed only: `key`,
`sub_issues_count` (meaning unchanged: non-archived children),
`blocked_by_ids`, `blocks_ids`. Rule (3 conditions) goes in ADR 0005
amendment.

### 2.2 Quarantine (`domain_ops.py`) — exactly five

1. `POST /work-items/{id}/reorder` — server-computed fractional rank.
2. `POST /projects/{id}/states/reorder` — atomic `ordered_ids` rewrite.
3. `POST /projects/{id}/issue-types/reorder` — same.
4. `DELETE /issue-types/{type_id}/workflow-settings/states/{state_id}`
   (path may be simplified) — remove state from workflow + prune.
5. `POST /workspace/onboarding/acknowledge` — one-way.

Workflow-revision concurrency guard moves into write bodies where it exists
today.

### 2.3 Deleted routes and their replacements

| Deleted                                                        | Replacement                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects/{id}/review-findings`                          | work-item create with parent \= Story in Review; same pre-write gate, identical 422; server still derives type Implementation + start stage |
| `GET /issue-types/{id}/workflow-settings`                      | issue-type retrieve + transition list + launch-binding list; standing warnings become client derivation                                     |
| `GET /states/{id}/impact`, `POST .../workflow-settings/impact` | none — client derives dialogs; delete rejects                                                                                               |
| `GET /projects/{id}/subtree-run-capabilities`                  | client derives from launch-binding rows                                                                                                     |
| `GET /launch-bindings/provider-capabilities`                   | catalog table reads                                                                                                                         |
| `GET /work-items/{id}/scope-context`                           | MCP tool assembles from CRUD reads (see §5)                                                                                                 |
| `GET /modules/{id}/work-items`                                 | `GET /work-items?module=`                                                                                                                   |

### 2.4 Auth + errors

* `ApiKeyAuth` (`api/auth.py`, header `x-api-key`) → DRF authentication
  class in `DEFAULT_AUTHENTICATION_CLASSES` + permission class; keep
  `WORKTRACKER_DISABLE_AUTH`.
* `_http_errors()` (`api/router.py:14`) → one `EXCEPTION_HANDLER` mapping
  ServiceError subclasses; the docstring rule ("HttpError nowhere else")
  carries over as "raise ServiceError, never Response, outside the handler".
* Transition gate 422: `detail`/`code`/`from`/`to` byte-for-byte
  (`InvalidTransition.as_body()`), test-pinned.

## 3. Route registry + conformance test

* `worktracker/registry.py`: pure-data declaration keyed by model:
  `{model: {reads: [(verb, path, purpose)], writes: [...]}}` plus
  `domain_operations: [(verb, path, reason)]`.
* Conformance test walks `get_resolver().url_patterns` (full table), three
  tiers: (1) worktracker + GraphRun per-model declarations; (2) flat
  allowlist file for remaining async `apps/*` routes (one line each — a new
  undeclared async route fails too); (3) exclusion prefixes (admin, static,
  schema endpoint). Two-way assert: declared⇒resolves, resolves⇒declared.
* Schema conformance: responses validated against drf-spectacular-generated
  schema, parameterized over declared reads.

## 4. Graph runs (`backend/apps/execution/`)

* Reshape paths: `POST/GET/DELETE /work-items/{id}/graph-run` replacing
  `POST /work-items/{id}/execute-graph` (+ its DELETE). Handlers stay ninja
  async in `apps/execution/api.py`.
* Guards on create: 409 when a GraphRun header exists for the root
  (OneToOne PK already enforces storage-level); refusal when the (type,
  state) cell lacks subtree-run capability. Guards live in the service.
* Declare all three in the registry tier 1 as GraphRun CRUD.
* Update Studio + MCP callers (`execute_dependency_graph`,
  `get_dependency_graph` internals) to the new paths.

## 5. MCP surface (`surfaces/worktracker-agent/`) — mechanical only

* Regenerate from the new `openapi.json` (Python SDK →
  `npm run contract:generate`, `scripts/generate-{typescript,python}-sdk.mjs`).
* `get_task_scope_context`: keep the tool's output shape; implement via
  work-item read (has `blocked_by_ids`/`blocks_ids`) + one list read for
  neighbors; move the advisory sentence composition (currently
  `worktracker/work_items.py:183-219`) into the tool. Delete
  `build_scope_context` from the tracker (it composes prompt text, which
  violates the tracker's own CONTEXT.md boundary).
* `create_review_finding`: call the work-item create.
* Delete the hand-flattening of `state`
  (`surfaces/worktracker-agent/api/service.py:140`); for the nested
  issue-type name, join id→name via `list_issue_types` (already called at
  `service.py:197`).
* Tool argument shapes DO NOT change. No MCP redesign (backlogged).

## 6. Studio touchpoints (handled mostly by the sibling Redux ticket, but the

stacked branch must compile)

* Launch triple picker: providers/models/levels from the catalog reads;
  free-text model input removed; "add model" action creates an AgentModel
  row. Settings Model-configuration section writes `Provider.activated`.
* Workflow editor: state-delete dialog derives counts/references from held
  rows and shows "empty the state first" when refused; transition-removal
  dialog derives the prune preview client-side (reachability from held
  transitions).
* Normalized row store invariant: every response merges by id; filtered
  list responses never form separate caches.

## 7. Packaging + tests

* `backend/packaging/muxed-backend.spec`: hidden imports for
  `rest_framework`, `drf_spectacular`; rebuild the frozen sidecar (see
  memory: frozen-sidecar rebuild rule). `packaging/tests/test_sidecar.py`
  (2 worktracker HTTP tests) must pass.
* Re-authored: the \~29 HTTP-level test files under `worktracker/tests/`
  (largest: `test_types_states_config.py`, `test_mutations.py`,
  `test_work_items_api.py`, `test_scoped_workflow_api.py`,
  `test_owned_tool_behaviors.py`) → replaced by registry-parameterized
  suites + hand-written tests for the five domain ops + targeted tests:
  occupied-state delete 409, prune on transition delete, graph-run create
  409, catalog PROTECT 409, acknowledge one-way, auth uniformity, pinned
  gate 422.
* Carried over untouched: \~15 service/domain test files + 16 migration
  files.

## 8. Docs to update in the same change

* `backend/worktracker/docs/adr/0005-…`: amend — quarantine is five ops on
  DRF APIViews; add the computed-read-field rule; record the two deliberate
  service changes (state delete, graph-run reshape) and the catalog tables.
* `backend/worktracker/CONTEXT.md`: amend Route registry / Canonical
  collection read / Domain operation for the filter decision; delete or
  amend Workflow prune's "after a human confirms a preview" clause (preview
  is now client-derived).
* `backend/apps/terminals/agents/CONTEXT.md`: rewrite Activated provider
  (activation lives on the Provider row) and Workflow launch configuration
  (FK references).
* `studio/CONTEXT.md`: rewrite Model configuration ("never stores model
  lists" becomes false) and Launch triple picker (levels are rows; free
  text removed).
* `docs/decisions/2026-08-04-frontend-state-and-api-contract.md`: append the
  filter + normalized-store amendment.

## 9. Backlog tickets to file (not in this change)

1. Bulk operations (incl. bulk state reassignment — the future answer for
   emptying an occupied state; decide gate semantics there).
2. MCP surface redesign / improvements.
3. Pagination + the deferred `(module, state)` read.

## 10. Landing

Backend branch (this LLD + regenerated SDKs, domain suite green) → Redux
rebuild ticket stacks on it → main receives both as one release. Intentional
contract breaks are the table in §2.3 plus D1 flat ids and the graph-run
paths.