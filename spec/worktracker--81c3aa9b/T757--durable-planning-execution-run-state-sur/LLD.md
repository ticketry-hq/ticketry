# CODIN-757 LLD: Durable planning/execution run-state

## Scope

Persist the execution engine's private run-state so the one-run-per-task guard survives an ASGI restart. The implementation moves the run-to-task binding out of process memory and into durable tables, then rewires single-task planning and graph execution reads/writes through those tables.

This LLD covers both agreed slices:

| Slice | Scope | Ship value |
| --- | --- | --- |
| S1 | Durable single-task run-state | Planning-run duplicate guard survives restart. |
| S2 | Durable graph run-state | Execute-graph state rebuilds losslessly after restart. |

Out of scope: passive liveness checks, boot sweeps, timeouts, death-marker inference, an agent-facing failure-report tool, new lifecycle semantics, cross-process buses, and any dependency on CODIN-756.

## Preconditions

- CODIN-744 is assumed to land as specified: `Issue.lifecycle_state` is the published lifecycle mirror and execution code uses the guarded lifecycle service for lifecycle transitions.
- CODIN-755 manual release exists or is implemented in parallel; its release action must clear the durable run row instead of only mutating memory.
- The real execution implementation must be resolved before edits. Existing specs identify it as `server/apps/execution/`; this checkout does not contain that path under `worktracker-stack/`, so implementation starts by locating the checked-in execution app in the integrated server tree.
- Current pure engine value types remain the in-memory representation. Durable rows are storage for the same facts, not a second state machine.

## Current behavior to replace

| Behavior | Problem |
| --- | --- |
| `_registry[task_id]` stores the active `EngineState` only in process memory | Restart forgets a still-running detached tmux agent. |
| `planning_run_already_running` reads memory | After restart it can return a false negative and launch a duplicate agent. |
| Dead runs can leave memory stuck as `running` | The guard can wedge until a manual release exists. |
| `_graph_registry[root_id]` stores graph state only in process memory | GET execute-graph loses node status, agent identity, and errors after restart. |
| `AgentRun.status` appears permanently `running` | It cannot be trusted for death detection or automatic failure. |

## Decision Record

| Decision | Choice | Reason |
| --- | --- | --- |
| Durable guard | Use `EngineRun.task_id` as the primary key | The DB enforces one run-state row per task, so restart cannot erase the guard. |
| Stored fields | Mirror the current `EngineState`: task, agent, phase, status, agent run id, error, timestamps, plus project/module context | Keeps implementation mechanical and avoids inventing new engine semantics. |
| Graph header | Add one `GraphRun` row per root task | Keeps graph identity durable while continuing to derive edges from `blocked_by`. |
| Graph nodes | Reuse `EngineRun` rows for per-task graph node status | Avoids a parallel node table and preserves single-task visibility. |
| Completion | Keep `running` to `done` agent-reported through the existing issue-state/lifecycle observer seam | This is the only reliable completion signal. |
| Failure | Persist `failed` only for launch-time spawn errors or manual release | The server must not infer post-launch death. |
| Cache | In-memory registries may remain as an optimization only | All correctness reads must hit durable state or refresh from it. |
| Lifecycle relationship | Store `phase` as engine-private truth; never query both `EngineRun.phase` and `Issue.lifecycle_state` as competing authorities | CODIN-744 owns published lifecycle semantics; CODIN-757 owns run binding. |
| Existing API shape | Do not add public endpoints or MCP tools | Existing planning-run, execute-graph, and manual-release surfaces are retargeted. |

## Data Model

| Table | Column | Type / constraint | Notes |
| --- | --- | --- | --- |
| `engine_runs` | `task_id` | UUID primary key, FK to task issue | One row per task; this is the durable guard. |
| `engine_runs` | `project_id` | UUID FK or denormalized UUID | Copied from task for scoped queries and diagnostics. |
| `engine_runs` | `module_id` | UUID nullable FK/UUID | Root/module context used by graph and planning surfaces. |
| `engine_runs` | `agent` | string, required | The selected agent profile name. |
| `engine_runs` | `phase` | string, required | Existing engine phase value; no new phase names. |
| `engine_runs` | `status` | string enum-like, required | Existing engine status values: idle/running/done/failed/halted where applicable. |
| `engine_runs` | `agent_run_id` | string nullable | Binding to spawned detached tmux/AgentRun session. |
| `engine_runs` | `error` | text nullable | Launch error or manual-release reason. |
| `engine_runs` | `created_at` | timestamp | Standard audit field. |
| `engine_runs` | `updated_at` | timestamp, indexed | Freshness/debugging only; not liveness. |
| `graph_runs` | `root_id` | UUID primary key, FK to root task issue | One durable graph header per root. |
| `graph_runs` | `project_id` | UUID FK/denormalized UUID | Copied from root. |
| `graph_runs` | `module_id` | UUID nullable FK/UUID | Copied from root/module context. |
| `graph_runs` | `agent` | string, required | Default agent used for graph launches. |
| `graph_runs` | `created_at` | timestamp | Standard audit field. |
| `graph_runs` | `updated_at` | timestamp | Updated when graph header is touched. |

No migration backfill is needed. Existing in-memory state disappears on deploy exactly as it does today; new launches become durable.

## API and Service Contract

| Surface | Change |
| --- | --- |
| `POST /work-items/{id}/planning-run` | The duplicate-run 409 guard reads `engine_runs` by task id. If a non-terminal durable row exists for the task, return the existing `planning_run_already_running` conflict without spawning. |
| `POST /work-items/{id}/planning-run` spawn success | Write or update `EngineRun` to `running` with agent, phase, task context, and agent run id before returning success. |
| `POST /work-items/{id}/planning-run` spawn error | Persist `EngineRun` as `failed` with error when the launch attempt is known to have failed. Do not create a fake agent run id. |
| `POST /work-items/{id}/execute-graph` | Create or read `GraphRun`, seed/read node `EngineRun` rows, launch ready nodes idempotently, and return graph state from durable rows. |
| `GET /work-items/{id}/execute-graph` | Rebuild graph state from `GraphRun`, `EngineRun`, and current `blocked_by` edges. A 404 now means no graph header exists, not merely that the server restarted. |
| Issue/lifecycle observer seam | Persist matching running rows to `done` when the existing completion event fires. Leave unrelated or stale events unchanged. |
| Manual release | Clear or terminally rewrite the durable `EngineRun` row according to CODIN-755's accepted contract, then allow the next launch. |

No OpenAPI schema shape needs to change unless the existing graph/planning response schemas are currently tied to process-local classes. If they are, map the durable row back to the existing response objects rather than changing clients.

## File Change Map

| File | Change |
| --- | --- |
| `server/apps/execution/models.py` | Add `EngineRun` and `GraphRun` models with the fields above. |
| `server/apps/execution/migrations/000X_engine_run.py` | Create `engine_runs` and `graph_runs`; no data migration. |
| `server/apps/execution/driver.py` | Retarget `_store`, `_store_graph`, `get_state`, `get_graph`, execute launch writes, graph seeding, and observer writes to durable storage. Keep registries as optional read-through/write-through cache only. |
| `server/apps/execution/api.py` | Rewire `planning_run_already_running` to read the durable row and make GET execute-graph rebuild from durable rows. |
| `server/apps/execution/signals.py` | Ensure the existing completion observer path calls the driver write path that persists `running` to `done`. |
| `server/apps/execution/state.py` | Read-only unless row mapping exposes a missing status/phase constant. Do not add lifecycle semantics here. |
| `server/apps/execution/graph.py` | Read-only unless graph reconstruction needs a small pure helper for current `blocked_by` edges. |
| CODIN-755 manual-release files | Retarget release from in-memory deletion to durable-row clearing or terminal rewrite. Keep this as the only post-launch stuck-run recovery. |
| `server/apps/execution/tests/*` | Add durable guard, restart, graph rebuild, manual-release, and negative liveness-inference coverage. |

If the integrated repo places execution under a different package name, preserve these ownership boundaries and update the paths in the implementation PR.

## Implementation Steps

1. Locate the checked-in execution app and confirm the current `EngineState`, `GraphState`, `_registry`, `_graph_registry`, `execute`, `execute_graph`, `get_state`, `get_graph`, planning-run API, and completion observer names.
2. Add the execution models and migration. Keep field names aligned with the current response/state object names so row mapping is direct.
3. Add small row-mapping helpers in the driver boundary: row to engine state, engine state to row fields, graph header plus rows to graph state. Keep reducers and pure graph logic unaware of the database.
4. Change single-task `_store` to write through to `EngineRun` on every existing state transition, then refresh/update the optional memory cache from the saved row.
5. Change `get_state(task_id)` to read `EngineRun` first. Treat a missing row as no engine state; do not consult memory as the source of truth.
6. Rewire the planning-run duplicate guard to use `get_state` or a narrower durable guard query. A running durable row must return 409 after the in-memory registry is cleared.
7. On launch success, persist `running` only after the spawn returns a concrete agent run id. On launch failure, persist `failed` with the launch error and return the existing error mapping.
8. Update the completion observer so the current completion event resolves the matching durable row and persists `done`. Ignore completions for tasks with no durable running row or mismatched phase.
9. Add `GraphRun` creation/read logic to execute-graph. Re-invocation with an existing header returns the current durable graph and only launches newly ready nodes that do not already have non-terminal rows.
10. Change graph GET to rebuild from `GraphRun`, current task descendants/`blocked_by` edges, and `EngineRun` rows. Recompute halted display status from dependencies during read; do not persist derived edges.
11. Retarget manual release to clear or terminally update the durable `EngineRun` row per CODIN-755. After release, the same task must be launchable again.
12. Remove or demote any tests that assert registry-only behavior. Keep cache-clearing helpers only as restart simulation utilities.
13. Add an explicit negative check in tests or static assertions that no timeout, boot sweep, marker poll, or AgentRun death inference path was added.

## Test Plan

| Area | Required coverage |
| --- | --- |
| Model/migration | Tables create successfully; `task_id` and `root_id` uniqueness are enforced; nullable fields match launch/error needs. |
| Single-task restart guard | Seed a durable `running` row, clear `_registry`, POST planning-run, assert 409 and no spawn call. |
| Fresh launch | With no durable row, POST planning-run launches and persists `running` with agent, phase, agent run id, project/module context, and no error. |
| Spawn failure | Launch exception persists `failed` with error and returns the current error contract. |
| Completion seam | Existing issue-state/lifecycle observer event flips a matching durable running row to `done`; cache clear does not lose it. |
| Manual release | Durable row is cleared or released according to CODIN-755, then a new POST planning-run can launch. |
| Concurrency | Two same-task launch attempts cannot create two rows; the loser sees the existing row/409 path. |
| Graph restart | Seed `GraphRun` plus node rows, clear `_graph_registry`, GET execute-graph returns the full graph with agent, status, agent run id, and error intact. |
| Graph idempotency | Re-invoking execute-graph with existing durable rows does not relaunch already running/done nodes. |
| Derived edges | Changing `blocked_by` affects rebuilt graph edges/status on read without stored edge rows. |
| Negative liveness | No test path marks `running` to `failed` from timeout, server startup, AgentRun status, or missing tmux marker. |

Focused validation should run the execution app's migration tests, driver tests, API tests for planning-run and execute-graph, and CODIN-755 release tests if available.

## Risk Controls

| Risk | Control |
| --- | --- |
| Duplicate launch race | Rely on `EngineRun.task_id` primary key/unique constraint, not only a preflight read. |
| Accidental death inference | Keep all row mutation sites enumerated: launch success, launch failure, completion observer, manual release. |
| Lifecycle confusion with CODIN-744 | Do not validate board/lifecycle progress from `EngineRun.phase`; it is private execution context only. |
| Graph drift after blocker edits | Store only root/header and node status; derive edges from current `blocked_by`. |
| Cache divergence | Tests must clear memory and still pass through durable reads. |
| Manual-release mismatch | CODIN-755 must be updated in the same implementation window or S1 acceptance is incomplete for wedged rows. |

## Acceptance Signal

CODIN-757 is implementation-ready when the accepted plan is to persist `EngineRun` and `GraphRun`, read the duplicate guard from the database, write all existing engine transitions through durable storage, rebuild execute-graph from rows after cache loss, and keep failure recovery manual-only. The green implementation result is: after an ASGI restart simulation, an existing running planning run still returns 409 without spawning a duplicate; graph state survives cache loss with no lost agent/error facts; no server path infers death or flips running to failed except launch failure or manual release.
