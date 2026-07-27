# T760 · MCP `set_lifecycle` tool · LLD

## Scope

Add one MCP write tool that lets agents advance a work item's internal planning lifecycle through the existing guarded lifecycle route. Do not add a second lifecycle validator, do not expose lifecycle writes through generic CRUD patching, and do not change the lifecycle state machine.

This slice depends on the CODIN-744 / CODIN-758 foundation already present in this workspace: `Issue.lifecycle_state`, `WorkItemOut.lifecycle_state`, `WorkItemOut.lifecycle_transitions`, `LifecycleIn`, and `POST /work-items/{issue_id}/lifecycle`.

## Prerequisite Check

Before implementation, confirm the foundation still matches the expected shape:

| Foundation surface | Expected shape |
| --- | --- |
| Backend guard | `POST /work-items/{issue_id}/lifecycle` resolves the item, calls `worktracker.lifecycle.set_lifecycle`, and returns bare `WorkItemOut`. |
| Guard failures | Illegal transitions and illegal lifecycle/visible-state pairings return a 4xx body with `detail`. |
| Read payload | Work-item reads include `lifecycle_state` and `lifecycle_transitions`. |
| Sole writer rule | `Issue.lifecycle_state` is not writable through generic CRUD patching. |

## Implementation Harness

| Area | File | Delta |
| --- | --- | --- |
| MCP service | `worktracker-agent/api/service.py` | Add a `set_lifecycle(work_item_id, target)` service method. Resolve UUID or `KEY-N` with `_resolve_task_id`, call the existing HTTP lifecycle route, and normalize the bare work-item response into the MCP result shape. |
| MCP toolset | `worktracker-agent/api/tools.py` | Add `set_lifecycle_tool(ctx, work_item_id, target)` with the public MCP signature `(work_item_id, target)`. It delegates directly to the service method. |
| MCP registration | `worktracker-agent/mcp/tools_adapter.py` and `worktracker-agent/mcp/server.py` | No registration code change expected. The existing `*_tool` reflection should expose the method as `set_lifecycle`; tests pin this. |
| Agent read schema | `worktracker-agent/api/schemas.py` | Add `lifecycle_state` and `lifecycle_transitions` to `WorktrackerTask`, inherited by `WorktrackerTaskDetail`, so `get_task_details` exposes the lifecycle read fields to agents. |
| Service hydration | `worktracker-agent/api/service.py` | Extend `_task` to copy `lifecycle_state` and `lifecycle_transitions` from backend work-item payloads. |
| Agent tests | `worktracker-agent/tests/test_lifecycle_tools.py` | Add a focused MCP-agent lifecycle test file rather than expanding dependency-tool coverage. |
| SDK | `worktracker-sdk/worktracker_sdk/resources.py` | No SDK writer unless implementation discovers an established SDK-use path inside the agent. The direct agent service already uses `requests` against owned HTTP routes, and the SDK model already has the read fields. |
| Backend | `worktracker/worktracker/*` | No backend changes planned. The guarded route and read fields are the shared source of truth. |

## Write Contract

Input:

| Field | Meaning | Validation owner |
| --- | --- | --- |
| `work_item_id` | Work item UUID or owned `KEY-N` address. | Existing `_resolve_task_id` plus backend `resolve_issue`. |
| `target` | Requested lifecycle state string. | Existing backend `worktracker.lifecycle.set_lifecycle`. |

Output on success:

| Field | Meaning |
| --- | --- |
| `work_item_id` | Resolved UUID of the updated work item. |
| `lifecycle_state` | Current lifecycle state after the transition. |
| `lifecycle_transitions` | Legal next lifecycle targets after the transition. |

Output on guarded rejection:

| Field | Meaning |
| --- | --- |
| `work_item_id` | Resolved UUID when resolution succeeded; original input when resolution fails before a UUID is known. |
| `error` | Backend detail message from the guarded route. This must be explicit and visible to the MCP caller. |

Server errors and transport failures still raise; only backend 4xx guard details are converted into clean tool errors.

The MCP result intentionally uses a small normalized shape rather than returning the full backend work-item payload. Agents need the current lifecycle state, legal next transitions, and explicit guard error; broader task details remain available through `get_task_details`.

## Decision Map

| Decision | Choice | Reason |
| --- | --- | --- |
| Guard path | Call `POST /work-items/{id}/lifecycle` from the agent service. | This reuses the single guarded write path and avoids duplicating transition or pairing validation in MCP. |
| ID handling | Accept UUID or `KEY-N`, resolving through `_resolve_task_id` before POST. | Matches existing blocker tools and keeps agent ergonomics consistent. |
| Error shape | Convert backend 4xx `detail` into `{"work_item_id": ..., "error": ...}`. | Mirrors dependency-tool behavior and prevents silent no-ops. |
| Success shape | Return the updated lifecycle fields from the backend response. | Lets the agent immediately see the new state and legal next moves without a second read. |
| Read surface | Put lifecycle fields on `WorktrackerTask` so details inherit them. | The existing task-details MCP read is the agreed read path. |
| SDK writer | Do not add one in this slice unless required by existing agent patterns. | Acceptance is MCP behavior through the guard; the agent service currently calls HTTP directly. |
| Test location | Use a new lifecycle MCP test file. | Keeps dependency and execution tests focused while pinning this new tool surface. |

## Implementation Steps

1. Extend agent schemas with lifecycle read fields.
2. Extend `WorktrackerService._task` to hydrate those fields from backend work-item payloads.
3. Add `WorktrackerService.set_lifecycle`, using `_resolve_task_id`, `POST /work-items/{resolved}/lifecycle`, and `_http_error_detail` for explicit 4xx tool errors.
4. Add `WorktrackerToolset.set_lifecycle_tool` with parameters `work_item_id` and `target`.
5. Add focused MCP-agent tests for read hydration, successful lifecycle POST, guarded 422 response, server-error propagation, `KEY-N` resolution, public tool signature, and reflection registration.
6. Run the agent test file that owns this surface, then run the smallest related backend/API tests if touched unexpectedly.

## Test Plan

| Test | Setup | Expected result |
| --- | --- | --- |
| `test_get_task_details_surfaces_lifecycle_fields` | Backend task payload includes `lifecycle_state` and `lifecycle_transitions`. | MCP detail model exposes the same values. |
| `test_set_lifecycle_posts_to_guarded_route` | Service call with UUID and target. | Calls `POST /work-items/{uuid}/lifecycle` with only the target body; result includes updated lifecycle fields. |
| `test_set_lifecycle_resolves_key_before_post` | Service call with `CODIN-760`. | Performs existing GET resolution, then POSTs with resolved UUID. |
| `test_set_lifecycle_guard_error_returns_clean_error` | Guarded route raises 422 with `detail`. | Tool result contains explicit `error`; no silent success. |
| `test_set_lifecycle_server_error_still_raises` | Guarded route raises 500. | `requests.HTTPError` propagates, matching existing service policy. |
| `test_set_lifecycle_tool_signature_is_public` | Inspect the wrapped MCP callable. | Exposed signature is `(work_item_id, target)`, with no `ctx`. |
| `test_lifecycle_tool_is_registered` | Collect `generate_worktracker_tools()` names. | `set_lifecycle` is present. |

## Out Of Scope

- No lifecycle state-machine edits.
- No database migration.
- No frontend changes.
- No direct CRUD patch support for `lifecycle_state`.
- No lifecycle validation in MCP.
- No task state changes from Todo to LLD until the user approves this LLD in-session.

## Acceptance Signal

This slice is ready when agents can call `set_lifecycle(work_item_id, target)`, legal transitions update through the existing guarded HTTP path, illegal transitions or invalid lifecycle/state pairings return a visible tool error, and `get_task_details` exposes both current lifecycle state and legal next transitions.
