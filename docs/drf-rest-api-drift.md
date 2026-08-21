# DRF REST API drift ledger

Status: active  
Last audited: 2026-08-19  
Verdict: drifted

This is the maintained inventory and convergence plan for deviations from
Ticketry's DRF-first HTTP contract. The governing implementation rules are in
[`AGENTS.md`](../AGENTS.md),
[`ADR 0007`](../backend/worktracker/docs/adr/0007-one-drf-http-surface-and-one-generated-http-contract.md),
and [the DRF implementation skill](../.codex/skills/drf-rest-api/SKILL.md).

Update this ledger in the same change that migrates an operation. An operation
leaves the drift list only when its batch exit criteria pass.

## Audit snapshot

| Metric | Count |
| --- | ---: |
| OpenAPI operations inventoried | 81 |
| OpenAPI paths inventoried | 55 |
| ViewSet/generic operations | 79 |
| `APIView` operations | 2 |
| Confirmed model writes bypassing `ModelSerializer` | 1 |
| Views manually parsing bodies or query parameters | 4 |
| Registered domain operations | 19 |
| Completed override records | 35 |
| Unjustified or needs-proof operations | 2 |

`npm run contract:check` passes after regenerating the TypeScript and Python
SDKs from the current `openapi.json`.
Nullable choices remain nullable properties rather than synthetic null-only
enum components, because OpenAPI Generator produces invalid Python for those
components.

## Classification key

- **Deviation / P1:** an `APIView` or other custom transport duplicates DRF
  machinery and has no accepted override.
- **Needs proof / P0:** authentication is removed from DRF and replaced or
  omitted at the view boundary. It must be secured or documented and fenced by
  tests before other migration work relies on it.
- **Needs proof / P2:** a likely low-risk exception still lacks the required
  override record and regression evidence.

## Drifted operations

Every row below is currently backed by `APIView`, directly or through
`PublicAPIView` / `AuthenticatedAPIView`. `Done` means converted to a
ViewSet/generic, or retained through a completed and tested override record.

### Settings and configuration

Source: [`backend/apps/rest_api.py`](../backend/apps/rest_api.py),
[`backend/apps/settings_store/rest_views.py`](../backend/apps/settings_store/rest_views.py),
and [`backend/apps/rest_urls.py`](../backend/apps/rest_urls.py).

| Done | Method | Path | Operation ID | Classification | Target |
| --- | --- | --- | --- | --- | --- |
| [ ] | GET | `/settings/provider-catalog` | `settings_provider_catalog_retrieve` | Deviation / P1 | Settings ViewSet retrieve action |
| [ ] | PUT | `/settings/provider-catalog` | `settings_provider_catalog_update` | Deviation / P1 | Settings ViewSet update action + DRF serializer |
The retired GET/PATCH `/config` and POST/PUT/DELETE `/config/profiles` operations
now return 404. Stateless folder validation remains as the serializer-backed
`SettingsViewSet.validate_folder` action documented in
[`module-folder-validation.md`](../backend/apps/settings_store/docs/drf-overrides/module-folder-validation.md).
Module links use a `ModelSerializer` allowlist and a `GenericViewSet` with
list, update, and destroy mixins. The provider-catalog rows above remain open
because the typed-configuration rollout deliberately preserves that endpoint.

### Runs and lifecycle

Source: [`backend/apps/rest_api.py`](../backend/apps/rest_api.py) and
[`backend/apps/runs/rest_views.py`](../backend/apps/runs/rest_views.py), with
domain behavior remaining in `backend/apps/runs/`.

No run-status or automation-retry operation remains backed by `APIView`.
Automation retry is a serializer-backed action documented in
[`automation-attempt-retry.md`](../backend/apps/runs/docs/drf-overrides/automation-attempt-retry.md).

### Terminals and viewer leases

Source: [`backend/apps/terminals/rest_views.py`](../backend/apps/terminals/rest_views.py),
with domain behavior remaining in `backend/apps/terminals/`.

No terminal or viewer-lease operation remains backed by `APIView`. Terminal
collection, lifecycle, filtered-history, shell, lease, and native-output
operations are serializer-backed actions documented in
[`terminal-operations.md`](../backend/apps/terminals/docs/drf-overrides/terminal-operations.md).

### Documents and filesystem

Source: [`backend/apps/documents/rest_views.py`](../backend/apps/documents/rest_views.py),
with domain behavior remaining in `backend/apps/documents/`.

No document-listing, document-update, or filesystem-completion operation remains
backed by `APIView`. Their reconciliation, digest/ETag, and host-filesystem seams
are documented in
[`document-operations.md`](../backend/apps/documents/docs/drf-overrides/document-operations.md).

### Worktrees

Source: [`backend/apps/worktrees/rest_views.py`](../backend/apps/worktrees/rest_views.py), with domain
behavior remaining in `backend/apps/worktrees/`.

No worktree operation remains backed by `APIView`. Live status, idempotent
creation, and discard are serializer-backed actions documented in
[`worktree-operations.md`](../backend/apps/worktrees/docs/drf-overrides/worktree-operations.md).

### Execution

Source: [`backend/apps/execution/rest_views.py`](../backend/apps/execution/rest_views.py), with domain
behavior remaining in `backend/apps/execution/`.

No graph-run operation remains backed by `APIView`. The factual subtree read,
campaign create/advance, and serialized reset actions are documented in
[`graph-run-operations.md`](../backend/apps/execution/docs/drf-overrides/graph-run-operations.md).
Run Now is a serializer-backed execution action; its signed-caller liveness
exception and committed-state failure contract are documented in
[`run-now.md`](../backend/apps/execution/docs/drf-overrides/run-now.md).
Direct agent launch is a serializer-backed execution action; its task identity,
launch-policy resolution, and external-process side effect are documented in
[`direct-agent-launch.md`](../backend/apps/execution/docs/drf-overrides/direct-agent-launch.md).
No execution operation remains backed by `APIView`.

### Work items and attachments

Source: [`backend/worktracker/rest/work_items.py`](../backend/worktracker/rest/work_items.py).

No work-item or attachment operation remains backed by `APIView`. The
asymmetric mutation responses, dual identifier lookup, bounded batch read, and
multipart response seam are documented in
[`work-items-and-attachments.md`](../backend/worktracker/docs/drf-overrides/work-items-and-attachments.md).

### Workflow configuration and launch bindings

Source: [`backend/worktracker/rest/workflow_views.py`](../backend/worktracker/rest/workflow_views.py)
and [`backend/worktracker/rest/domain_ops.py`](../backend/worktracker/rest/domain_ops.py).

| Done | Method | Path | Operation ID | Classification | Target |
| --- | --- | --- | --- | --- | --- |
No workflow configuration or launch-binding operation remains backed by
`APIView`. The revision-body and composite-upsert seams are documented in
[`workflow-composite-mutations.md`](../backend/worktracker/docs/drf-overrides/workflow-composite-mutations.md).

### Retired Workspace and system

Source: [`backend/apps/system_rest.py`](../backend/apps/system_rest.py).

Workspace persistence and both Workspace routes are removed. Public health
access uses a serializer-backed system action documented in
[`authentication-sensitive-host-operations.md`](../backend/apps/docs/drf-overrides/authentication-sensitive-host-operations.md).

## Completed migrations

| Completed | Method | Path | Operation ID | Result |
| --- | --- | --- | --- | --- |
| 2026-08-19 | GET | `/config` | `config_retrieve` | Retired with file-backed profiles; the route now returns 404. |
| 2026-08-19 | PATCH | `/config` | `config_partial_update` | Retired with recent-profile persistence; the route now returns 404. |
| 2026-08-19 | POST | `/config/profiles` | `config_profiles_create` | Retired with profile persistence; the route now returns 404. |
| 2026-08-19 | PUT | `/config/profiles/{index}` | `config_profiles_update` | Retired with profile persistence; the route now returns 404. |
| 2026-08-19 | DELETE | `/config/profiles/{index}` | `config_profiles_destroy` | Retired with profile persistence; the route now returns 404. |
| 2026-08-19 | POST | `/config/folders/validate` | `config_folders_validate_create` | Serializer-backed settings action delegates stateless host-filesystem validation to the existing validator. |
| 2026-08-19 | GET | `/module-links` | `module_links_list` | Native list mixin with an explicit `ModuleLinkSerializer` allowlist. |
| 2026-08-19 | PUT | `/module-links/{module_id}` | `module_links_upsert` | Native update mixin delegates the transactional per-module upsert to the settings-store service. |
| 2026-08-19 | DELETE | `/module-links/{module_id}` | `module_links_delete` | Native destroy mixin delegates deletion to the settings-store service. |
| 2026-08-19 | GET | `/terminals` | `terminals_list` | Terminal collection list validates task scope with DRF and serializes the service-owned runtime projection through a read-only model serializer. |
| 2026-08-19 | POST | `/terminals` | `terminals_create` | Terminal create validates the launch command with DRF and delegates spawn validation, durable persistence, and runtime launch to the existing control-plane service. |
| 2026-08-19 | DELETE | `/terminals` | `terminals_destroy` | Serializer-backed terminal action binds run identity from the query and delegates runtime termination plus durable soft deletion to the service. |
| 2026-08-19 | POST | `/terminals/resume` | `terminals_resume_create` | Serializer-backed terminal action binds predecessor identity and preserves provider resume eligibility and failure semantics in the service. |
| 2026-08-19 | GET | `/terminals/resumable` | `terminals_resumable_list` | Named query and response serializers expose the service-owned de-duplicated, live-successor-filtered history projection. |
| 2026-08-19 | GET | `/terminals/scratch` | `terminals_scratch_list` | Named query serializer binds project/module scope and returns the runtime-owned scratch-session projection. |
| 2026-08-19 | GET | `/terminals/shells` | `terminals_shells_list` | Serializer-backed terminal action lists live module shells through a read-only model projection. |
| 2026-08-19 | POST | `/terminals/shells` | `terminals_shells_create` | Serializer-backed terminal action delegates module-folder policy, durable run creation, tmux launch, and compensation to shell services. |
| 2026-08-19 | POST | `/terminals/viewers/lease` | `terminals_viewers_lease_create` | Model-derived request allowlist delegates newest-viewer-wins arbitration and locked persistence to the viewer-lease service. |
| 2026-08-19 | POST | `/terminals/viewers/lease/renew` | `terminals_viewers_lease_renew_create` | Named identity serializer delegates holder-scoped TTL renewal and replacement detection to the viewer-lease service. |
| 2026-08-19 | POST | `/terminals/viewers/lease/release` | `terminals_viewers_lease_release_create` | Named identity serializer delegates idempotent holder-scoped lease deletion without affecting the terminal runtime. |
| 2026-08-19 | POST | `/terminals/viewers/output` | `terminals_viewers_output_create` | Named request and response serializers wrap the service-owned native output observation operation. |
| 2026-08-19 | POST | `/work-tracker/work-items/{issue_id}/launch-agent` | `workItemsLaunchAgentCreate` | Authenticated work-item execution action validates the optional provider override with DRF, binds target identity from the URL, and delegates the task-scoped side effect to the execution service without mutating workflow or graph-run state. |
| 2026-08-18 | POST | `/work-tracker/work-items/{issue_id}/run-now` | `workItemsRunNowCreate` | Authenticated work-item execution action validates origin with DRF, derives optional caller-run identity through authentication, and preserves synchronous committed-state launch failures. |
| 2026-08-18 | GET | `/work-tracker/work-items/{issue_id}/graph-run` | `workItemsGraphRunRetrieve` | Authenticated graph-run detail action returns the service-owned factual subtree through named response serializers without requiring a persisted campaign. |
| 2026-08-18 | POST | `/work-tracker/work-items/{issue_id}/graph-run` | `workItemsGraphRunCreate` | Authenticated graph-run action validates optional launch context with DRF and delegates campaign locking, eligibility, persistence, and launches to the execution service. |
| 2026-08-18 | DELETE | `/work-tracker/work-items/{issue_id}/graph-run` | `workItemsGraphRunDestroy` | Authenticated graph-run action binds root identity from the URL and delegates serialized campaign reset while preserving the established `200` result body. |
| 2026-08-18 | GET | `/worktrees` | `worktrees_retrieve` | Authenticated `WorktreeViewSet.status` validates task context with a named query serializer and returns the service-owned live git projection through a declared response serializer. |
| 2026-08-18 | POST | `/worktrees/{task_id}/create` | `worktrees_create_create` | Authenticated worktree action validates the creation context with DRF, preserves idempotent `200` behavior, and delegates git creation and persistence to the worktree service. |
| 2026-08-18 | POST | `/worktrees/{task_id}/discard` | `worktrees_discard_create` | Authenticated worktree action binds task identity from the URL, validates optional context, and delegates idempotent git cleanup to the worktree service. |
| 2026-08-18 | GET | `/documents` | `documents_retrieve` | Authenticated `DocumentViewSet.list` validates query input through a named serializer, preserves service-owned registry reconciliation, and serializes a read-only model-derived document projection. |
| 2026-08-18 | PUT | `/docs/{doc_id}` | `docs_update` | Authenticated `DocumentViewSet.update` validates the two-field write contract, delegates containment and atomic digest CAS to the document service, and preserves success/conflict ETags. |
| 2026-08-18 | GET | `/fs/complete` | `fs_complete_retrieve` | Authenticated serializer-backed document action delegates host directory enumeration to the document service and returns a declared response envelope. |
| 2026-08-19 | GET | `/work-tracker/workspace` | `retrieveWorkspace` | Retired with Workspace persistence; the route now returns 404. |
| 2026-08-18 | GET | `/work-tracker/projects/{project_id}/launch-bindings` | `listLaunchBindings` | Native `ListModelMixin` with `LaunchBindingSerializer`; project scope and ordering remain service-owned. |
| 2026-08-18 | GET | `/work-tracker/issue-types/{type_id}/transitions` | `listIssueTypeTransitions` | Native `ListModelMixin` on the transition collection ViewSet; issue-type scoping and ordering remain service-owned. |
| 2026-08-18 | POST | `/work-tracker/issue-types/{type_id}/transitions` | `createIssueTypeTransition` | Native `CreateModelMixin`; serializer validation precedes revision-guarded service creation. |
| 2026-08-18 | POST | `/work-tracker/work-items/{issue_id}/reorder` | `reorderWorkItem` | Registered domain operation moved from `APIView` to a serializer-backed `GenericViewSet` reorder action. |
| 2026-08-18 | POST | `/work-tracker/projects/{project_id}/states/reorder` | `reorderStates` | Registered serializer-backed action on the owning `StateViewSet`. |
| 2026-08-18 | POST | `/work-tracker/projects/{project_id}/issue-types/reorder` | `reorderIssueTypes` | Registered serializer-backed action on the owning `IssueTypeViewSet`. |
| 2026-08-18 | DELETE | `/work-tracker/issue-types/{type_id}/workflow-settings/states/{state_id}` | `removeStateFromIssueTypeWorkflow` | Registered revision-guarded action on the owning `IssueTypeViewSet`. |
| 2026-08-19 | POST | `/work-tracker/workspace/onboarding/acknowledge` | `acknowledgeWorkspaceOnboarding` | Retired with Workspace persistence; onboarding now belongs to the default project. |
| 2026-08-19 | POST | `/work-tracker/projects/{project_id}/onboarding/acknowledge` | `acknowledgeProjectOnboarding` | Registered project action delegates the default-project guard and monotonic acknowledgement to the onboarding service. |
| 2026-08-18 | PATCH | `/work-tracker/issue-types/{type_id}/transitions/{from_state_id}/{to_state_id}` | `updateIssueTypeTransition` | Composite-scoped transition ViewSet update with a two-field `ModelSerializer` allowlist and service-owned revision CAS. |
| 2026-08-18 | DELETE | `/work-tracker/issue-types/{type_id}/transitions/{from_state_id}/{to_state_id}` | `deleteIssueTypeTransition` | Transition ViewSet destroy override validates the named revision serializer before atomic service pruning. |
| 2026-08-18 | PUT | `/work-tracker/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}` | `upsertLaunchBinding` | Launch-binding ViewSet preserves the established atomic composite-key upsert and 200/201 contract. |
| 2026-08-18 | DELETE | `/work-tracker/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}` | `deleteLaunchBinding` | Launch-binding ViewSet destroy override validates the named revision serializer before service deletion. |
| 2026-08-18 | GET | `/work-tracker/work-items` | `listWorkItems` | Native `ListModelMixin` on the work-item ViewSet with a named UUID query serializer and service-owned queryset. |
| 2026-08-18 | POST | `/work-tracker/work-items/batch` | `batchWorkItems` | Registered bounded-read action on the owning work-item ViewSet preserves de-duplication, omission, and caller order. |
| 2026-08-18 | POST | `/work-tracker/projects/{project_id}/work-items` | `createWorkItem` | `CreateModelMixin` with a model-derived request allowlist delegates workflow-aware creation to the domain service. |
| 2026-08-18 | GET | `/work-tracker/work-items/{issue_id}` | `getWorkItem` | Native `RetrieveModelMixin` preserves UUID-or-project-key lookup through the service boundary. |
| 2026-08-18 | PATCH | `/work-tracker/work-items/{issue_id}` | `updateWorkItem` | `UpdateModelMixin` with a model-derived patch allowlist retains workflow, blocker, and hierarchy service invariants. |
| 2026-08-18 | DELETE | `/work-tracker/work-items/{issue_id}` | `deleteWorkItem` | Native `DestroyModelMixin` delegates child-conflict enforcement and deletion to the service. |
| 2026-08-18 | GET | `/work-tracker/work-items/{issue_id}/attachments` | `listWorkItemAttachments` | Native nested `ListModelMixin` with an issue-scoped attachment queryset. |
| 2026-08-18 | POST | `/work-tracker/work-items/{issue_id}/attachments` | `uploadAttachment` | `CreateModelMixin` validates multipart input with a named model serializer and delegates stored metadata to the attachment service. |
| 2026-08-18 | POST | `/lifecycle/events` | `lifecycle_events_create` | Registered run action authenticates Studio-signed run credentials through DRF and rejects body/run identity mismatches before service ingestion. |
| 2026-08-18 | POST | `/terminals/self-terminate` | `terminals_self_terminate_create` | Registered terminal action derives its only run identity from DRF's signed-run principal and delegates idempotent termination to the service. |
| 2026-08-18 | GET | `/docs/{doc_id}/{asset_path}` | `docs_retrieve` | Explicitly public document action preserves safe registered-root resolution and the established binary media/security-header response. |
| 2026-08-18 | GET | `/healthz` | `healthz_retrieve` | Explicitly public system action uses a named response serializer and remains independent of database readiness. |
| 2026-08-18 | GET | `/settings/keybindings` | `settings_keybindings_retrieve` | Authenticated singleton retrieve on `KeybindingsViewSet` serializes the service-owned decoded JSON envelope with a named DRF serializer. |
| 2026-08-18 | PUT | `/settings/keybindings` | `settings_keybindings_update` | Authenticated singleton update validates arbitrary JSON through `SettingValueSerializer` and delegates the fixed `(host, keybindings)` persistence identity to the settings service. |

## Cross-cutting drift

These items are not additional endpoint counts; they affect rows above.

| Priority | Drift | Evidence | Resolution |
| --- | --- | --- | --- |
| P1 | Pydantic validates settings request bodies inside views. | `_pydantic()` and its callers in `backend/apps/rest_api.py` | Replace with named DRF serializers and `is_valid(raise_exception=True)`. |
| P1 | Response schemas are descriptive rather than enforced. | `_serialize_result()` returns dictionaries or `model_dump()` output directly. | Serialize every result through its declared DRF response serializer. |
| P1 | One model write uses a plain mirror serializer. | Module create in `backend/worktracker/rest/serializers.py` | Use an explicit `ModelSerializer` field/read-only allowlist; keep invariants in services. |
| P2 | Ten host operations lack explicit `operation_id` annotations. | `extend_schema` calls in `backend/apps/rest_api.py` | Set stable operation IDs before moving classes so SDK method names cannot drift accidentally. |
| P2 | Remaining host callers bypass generated SDK operations. | Settings and run feature clients | Move transport to generated SDKs and keep caller-specific shaping in feature adapters. |
| P2 | One host adapter still owns settings and run capabilities. | `backend/apps/rest_api.py` | Move each remaining surface into its owning Django app. |

## Path to resolution

Migrate one coherent batch at a time. Before changing an endpoint, follow the
[`drf-rest-api` skill](../.codex/skills/drf-rest-api/SKILL.md) and trace its
model, serializer, view, URL, service, contract, and frontend consumer.

### Batch 0 — prove or remove authentication exceptions

Scope: lifecycle events, terminal self-termination, document assets, and
health.

Status: completed 2026-08-18. Signed-run authentication is framework-owned;
document assets and health retain reviewed public-route reasons and completed
override records. Existing authorization, containment, origin, and liveness
tests cover the chosen contracts without test changes.

1. Implement run-scoped credentials as a DRF authentication class for lifecycle
   and self-termination, or complete an override record explaining why the
   framework seam is insufficient.
2. Decide how document subresources authenticate: normal API-key auth, signed
   expiring URLs, or a minimal documented public seam.
3. Add authorization tests for missing, malformed, foreign-scope, expired, and
   valid credentials. Document assets also need an explicit unauthenticated
   access test matching the chosen policy.
4. Give health a named serializer, stable operation ID, and a completed public
   endpoint override record.

Exit: no endpoint silently disables installation-wide authentication; every
remaining exception has a completed override record and regression test.

### Batch 1 — stabilize schemas and error handling

Scope: all remaining rows in `backend/apps/rest_api.py`.

1. Add explicit operation IDs while preserving current path and method shapes.
2. Move serializers into the owning app and replace `inline_serializer`.
3. Replace Pydantic request parsing with DRF serializers, including query
   serializers for terminal, run, document, and worktree filters.
4. Replace `_serialize_result()` with declared response serializer output.
5. Route service failures through `ServiceError` and the installed
   `service_exception_handler`; remove per-view error translation.

Exit: generated request/response schemas match runtime validation and no host
view parses transport input or assembles JSON responses by hand.

### Batch 2 — migrate simple reads

Scope: settings reads, run status, document lists,
filesystem completion, worktree status, transition lists,
launch-binding lists, and work-item/attachment reads.

1. Use retrieve/list generics or ViewSet actions with scoped querysets.
2. Bind existing URL shapes explicitly in each app's `urls.py`.
3. Add authentication, scope, missing-row, and response-allowlist tests.

Exit: the selected read operations no longer appear in the drift tables and
their OpenAPI operation IDs remain stable.

### Batch 3 — migrate model CRUD

Scope: module creation; work-item create, patch, and delete; attachments;
workflow transitions; launch bindings; and persisted run resources.

1. Use explicit `ModelSerializer.fields` and `read_only_fields` for model
   resources.
2. Use DRF CRUD mixins with URL identity and queryset scoping.
3. Delegate `perform_create`, `perform_update`, and `perform_destroy` to the
   existing services so REST, MCP, background, and test writers share domain
   invariants.
4. Preserve `transaction.atomic`, locking, revision CAS, compensation, and
   rollback behavior in services.

Exit: protected fields are absent from request schemas, ordinary CRUD is native
DRF, and invariant/rollback tests pass.

### Batch 4 — migrate registered and execution actions

Scope: the six registered domain operations, graph-run lifecycle, launch
agent, run-now, worktree create/discard, and automation retry.

1. Put each operation on the owning resource ViewSet as `@action`.
2. Declare named request, success, and error serializers.
3. Keep orchestration and durable side effects in the owning service.
4. Complete an override record for every custom seam that remains.

Exit: there are no handwritten `APIView` subclasses and every RPC-shaped
operation is registered, serializer-backed, and service-owned.

### Batch 5 — seal the generated contract and callers

Run after each preceding batch, and once more for the completed migration.

1. Run `npm run contract:generate` and commit `openapi.json`, both generated
   SDKs, and wire frames together.
2. Replace ad-hoc Studio HTTP clients with generated SDK operations and
   feature-local adapters.
3. Run focused backend tests, then:

   ```bash
   (cd backend && uv run --extra dev pytest -q)
   npm run contract:check
   npm run typecheck
   npm run test:overhaul --workspace @worktracker/studio
   ```

4. Re-run the audit searches and update the snapshot counts and checkboxes in
   this ledger.

Exit: `contract:check` passes, callers use generated operations, and the audit
verdict is `aligned` or every remaining seam is a documented justified
override.

## Per-operation completion checklist

Check a row only when all applicable items are true:

- [ ] ViewSet/generic or completed override record.
- [ ] Named DRF request, query, response, and error serializers.
- [ ] Explicit stable `operation_id` and tag.
- [ ] URL identity and queryset scope are enforced declaratively.
- [ ] Server-owned fields are read-only and absent from request schemas.
- [ ] Domain invariants and atomicity remain in the service layer.
- [ ] Authentication, scope, allowlist, rollback, and error tests pass.
- [ ] `openapi.json` and both SDKs were generated rather than edited.
- [ ] Frontend consumers use the generated SDK through a feature adapter.
- [ ] Contract, typecheck, and required acceptance gates pass.
