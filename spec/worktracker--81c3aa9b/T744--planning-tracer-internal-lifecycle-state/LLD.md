# CODIN-744 LLD: Planning lifecycle state

## Scope

Implement the accepted HLD as one parent-level harness for the lifecycle capability. This LLD does not create leaf tickets, register dependency edges, generate PRD/HLD/LLD artifacts, launch agents, or change board workflow semantics.

The implementation must add durable internal lifecycle tracking on `Issue.lifecycle_state` while keeping `Issue.state` as the only visible workflow axis. The only normal UI surface for lifecycle is the issue drawer chicklet and picker.

## Current repo context

- Core tracker models and API live under `worktracker/worktracker`.
- The visible workflow states are `State` rows with frozen groups from `worktracker/worktracker/models/constants.py`.
- `Issue.state` is the existing visible workflow FK in `worktracker/worktracker/models/issue.py`.
- `WorkItemOut` is defined in `worktracker/worktracker/schemas.py`; work-item routes are in `worktracker/worktracker/api/work_items.py`.
- MCP tools are exposed from `worktracker-agent/api/tools.py`, backed by `worktracker-agent/api/service.py`, and registered dynamically by `worktracker-agent/mcp/tools_adapter.py`.
- The current frontend SDK-facing types are in `studio/src/lib/types.ts`; API wrappers are in `studio/src/lib/api.ts`.
- Board columns and swimlanes are pure selectors in `studio/src/stores/backlog/backlogSelectors.ts` and already derive from the `State[]` input.
- Drawer tab/chip integration belongs near `studio/src/shell/IssueDrawerTabs.tsx`.
- State picker, board filter bar, and workflow configuration must remain visible-state only.

The ticket text references `server/apps/execution`; in this checkout that code appears as untracked parent-repo work outside this package plus an execution route consumed through `studio/src/lib/codingBridge.ts` and `worktracker-agent/api/service.py`. The implementation should first resolve the actual checked-in execution module location and then apply the same lifecycle guard there.

## Decision Record

| Decision | Choice | Reason |
| --- | --- | --- |
| Storage | Add nullable enum-like field `Issue.lifecycle_state` | Durable per work item state without creating visible board states. |
| Migration | `worktracker` migration `0009` after `0008_state_is_protected_and_blocked` | Matches current migration sequence. |
| Field type | Django `CharField` with choices and `null=True, blank=True, db_index=True` | Simple, queryable, compatible with current model style. |
| Domain home | New core lifecycle module under `worktracker/worktracker` | Keeps transition table, visible-state pairing map, and guard reusable by HTTP, MCP, execution, and tests. |
| Write path | One guarded service owns lifecycle mutation | Prevents reducers, API routes, and MCP from duplicating validation. |
| Error | `InvalidTransition` domain exception | Single failure type for invalid transition and invalid pairing. |
| HTTP mapping | Invalid lifecycle write maps to `422` | Matches acceptance criteria and request-validation semantics. |
| Visible workflow sync | Validate pairings only; do not mutate `Issue.state` | CODIN-744 defines sync points but phase tickets own visible moves. |
| UI visibility | Lifecycle is not a `State` row | Board, filters, state picker, and workflow config cannot pick it up by construction. |
| Drawer UI | New lifecycle picker beside existing drawer state/agent controls | Provides the only scoped user-facing lifecycle surface. |

## Lifecycle Table

The implementation table is the source of truth for `allowed_transitions()`.

| State | Normal next | Review rejection | Terminal next | Visible pairing |
| --- | --- | --- | --- | --- |
| `backlog` | `refining` | | `failed`, `cancelled` | Backlog |
| `refining` | `prd_generated` | | `failed`, `cancelled` | Backlog |
| `prd_generated` | `prd_review` | | `failed`, `cancelled` | Backlog |
| `prd_review` | `prd_approved` | `refining` | `failed`, `cancelled` | Backlog |
| `prd_approved` | `generating_hld` | | `failed`, `cancelled` | Todo |
| `generating_hld` | `hld_generated` | | `failed`, `cancelled` | Todo |
| `hld_generated` | `hld_review` | | `failed`, `cancelled` | Todo |
| `hld_review` | `hld_approved` | `generating_hld` | `failed`, `cancelled` | Todo |
| `hld_approved` | `registering_split` | | `failed`, `cancelled` | Todo |
| `registering_split` | `split_created` | | `failed`, `cancelled` | Todo |
| `split_created` | `lld_generating` | | `failed`, `cancelled` | Todo |
| `lld_generating` | `lld_generated` | | `failed`, `cancelled` | Todo |
| `lld_generated` | `lld_review` | | `failed`, `cancelled` | Todo |
| `lld_review` | `lld_approved` | `lld_generating` | `failed`, `cancelled` | Todo |
| `lld_approved` | `implementing` | | `failed`, `cancelled` | Todo |
| `implementing` | `done` | | `failed`, `cancelled` | In Progress |
| `done` | | | | Done |
| `failed` | | | | Any visible state except invalid terminal-only assumptions; do not force a visible move |
| `cancelled` | | | | Cancelled |

`failed` and `cancelled` are accepted from active states and rejected from terminal states. There is no lifecycle `blocked` value.

## Implementation Harness

### 1. Core model and migration

- Add the lifecycle choices constant near the existing model constants or in the new lifecycle domain module.
- Add `Issue.lifecycle_state` to `worktracker/worktracker/models/issue.py`.
- Create migration `0009_issue_lifecycle_state.py` depending on `0008_state_is_protected_and_blocked`.
- Keep existing rows nullable; do not backfill to `backlog` in the migration.
- Add the field to admin list/detail only if admin already exposes similar issue metadata; keep it read-oriented if added.

### 2. Lifecycle domain service

- Add a lifecycle module that owns the enum values, transition table, visible-state pairing map, `allowed_transitions(issue_or_state)`, and `set_lifecycle(issue_id_or_issue, target)`.
- Treat `None` current lifecycle as bootstrappable only to `backlog`, `failed`, or `cancelled` unless an explicit existing-ticket migration rule is added during implementation.
- Validate target membership before transition lookup.
- Validate the target is in the exact allowed-next set for the current lifecycle.
- Validate the resulting lifecycle and current `Issue.state.group` or visible state name pairing.
- Raise `InvalidTransition` with enough detail for tests and API error messages, but do not expose internal stack details.
- Save only `lifecycle_state` and `updated_at`; never change `Issue.state`.

### 3. HTTP contract

- Add read-only `lifecycle_state` and `lifecycle_transitions` to `WorkItemOut`.
- Add a small request schema for `POST /work-items/{id}/lifecycle` with a `target` field.
- Add the route in `worktracker/worktracker/api/work_items.py`.
- Route resolution must accept UUID or key consistently with other work-item endpoints.
- Map `InvalidTransition` to 422 with a stable message payload.
- Ensure OpenAPI export and generated TypeScript SDK include the new response fields and endpoint.

### 4. MCP contract

- Add `set_lifecycle_tool(ctx, task_id, target)` to `worktracker-agent/api/tools.py`.
- Add `set_lifecycle(task_id, target)` to `worktracker-agent/api/service.py`.
- Route through the new HTTP endpoint; do not duplicate transition validation in MCP.
- Return the updated task payload or a small operation result consistent with nearby tool behavior.
- Extend MCP tool tests to assert the registered tool name includes `set_lifecycle`.

### 5. Execution retrofit

- Locate the checked-in execution implementation before editing; the design target is the route consumed by `/work-items/{id}/execute-graph` and `/work-items/{id}/generate-leaf-llds`.
- Replace the phantom visible-state gate that checks for a target named `LLD` with a lifecycle check for `hld_approved`.
- Persist lifecycle phase boundaries through the guarded service.
- Preserve `Phase` as the recipe currently running and `lifecycle_state` as durable pipeline progress.
- Do not synchronously mutate `Issue.state` from reducers or signal receivers.
- If an execution phase fails, set lifecycle to `failed` through the guard when the current state is active.

### 6. Frontend model and API

- Update generated SDK artifacts after OpenAPI changes using the repo’s existing generation path.
- Extend `studio/src/lib/types.ts` with a `LifecycleState` union and `lifecycle_state` / `lifecycle_transitions` on `WorkItem`.
- Add a `setLifecycle(id, target)` API wrapper in `studio/src/lib/api.ts`.
- Update issue/backlog stores only where they reconcile returned `WorkItemOut`.
- Do not add lifecycle filters or board axes.

### 7. Drawer lifecycle picker

- Add `LifecyclePicker.tsx` near the drawer shell.
- Render the current lifecycle as a compact chicklet beside the visible state area or drawer run controls.
- Show only `lifecycle_transitions` from the server; the client must not invent transitions.
- Include `failed` and `cancelled` only when the server includes them.
- On selection, call the guarded HTTP endpoint and reconcile the returned work item.
- Show disabled/empty state when `lifecycle_state` is null and there are no legal transitions.
- Leave `StatePicker.tsx`, `BoardFilterBar.tsx`, and `WorkflowStatesPanel.tsx` behavior unchanged except for tests proving lifecycle values are absent.

## Test Plan

### Backend domain tests

- Every table-defined normal transition is accepted.
- PRD/HLD/LLD review rejection back-edges are accepted.
- Representative skips are rejected, including `backlog` to `hld_approved` and `prd_review` to `hld_generated`.
- `failed` and `cancelled` are accepted from active states.
- `failed` and `cancelled` are rejected from `done`, `failed`, and `cancelled`.
- `allowed_transitions()` returns exactly the table-defined set for every lifecycle state.
- Legal lifecycle and visible-state pairings are accepted.
- Illegal lifecycle and visible-state pairings are rejected, including `implementing` while visible state is Backlog.
- No test depends on a seeded visible `LLD` state.

### Backend API and MCP tests

- `WorkItemOut` includes `lifecycle_state` and `lifecycle_transitions`.
- `POST /work-items/{id}/lifecycle` applies a legal transition and returns the updated work item.
- Invalid transition returns 422.
- MCP `set_lifecycle` posts to the lifecycle endpoint and surfaces success/failure consistently.
- MCP dynamic registration includes `set_lifecycle`.

### Execution tests

- Split completion or leaf-LLD launch readiness keys off `hld_approved`, not a visible state named `LLD`.
- Phase-boundary lifecycle writes call the guarded service.
- Failed execution marks lifecycle `failed` only through the guard.
- Reducer/signal receiver tests assert they do not mutate `Issue.state` synchronously.

### Frontend tests

- `boardColumns()` and `boardSwimlanes()` continue deriving columns only from `State[]`.
- Lifecycle values do not appear in `StatePicker`, `BoardFilterBar`, or workflow configuration.
- Drawer chicklet renders current lifecycle.
- Drawer picker renders only server-provided legal transitions.
- Selecting a lifecycle transition calls the API and reconciles the returned work item.
- No board or filter test requires a seeded visible `LLD` state.

## Implementation Order

1. Add backend lifecycle domain, model field, and migration.
2. Add backend domain tests and pairing tests.
3. Add WorkItemOut fields and lifecycle HTTP endpoint.
4. Update OpenAPI and SDK artifacts.
5. Add MCP service/tool wrapper and tests.
6. Retrofit execution lifecycle writes and remove the `LLD` visible-state gate.
7. Add frontend type/API/store support.
8. Add drawer lifecycle chicklet and picker.
9. Add visibility regression tests for board, state picker, filters, and workflow config.
10. Run backend, MCP, SDK, and frontend focused test suites before broad validation.

## Risk Controls

- Keep lifecycle values out of `DEFAULT_STATES`; this is the main guard against board leakage.
- Keep `set_lifecycle` as the only write path; reject direct writes in tests where practical.
- Validate pairings using state group where possible so renamed visible state rows do not break the model.
- Treat `failed` specially: it records internal failure without forcing a visible workflow move.
- Do not add a `blocked` lifecycle value; existing Blocked state and blocker edges remain the blocking model.
- Preserve nullable lifecycle for existing rows and define explicit bootstrap behavior.

## Acceptance Signal

CODIN-744 is implementation-ready when `Issue.lifecycle_state` is durable and guarded, lifecycle transitions and visible-state pairings are enforced, HTTP and MCP expose the guarded write path, execution persists lifecycle without the phantom `LLD` visible-state gate, and Studio shows lifecycle only in the drawer while board/workflow surfaces remain `State`-only.
