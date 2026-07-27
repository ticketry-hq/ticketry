# T761 LLD: Engine lifecycle retrofit

## Scope

Retrofit the #700 automation engine in `../server/apps/execution` so planning progress is persisted on `Issue.lifecycle_state` through CODIN-744's guarded lifecycle service. Remove the phantom visible-state gate that checks for a destination state named `LLD`.

This slice does not implement CODIN-744's lifecycle foundation, add visible workflow states, mutate `Issue.state`, create split children, generate artifacts, or change frontend behavior.

## Preconditions

- CODIN-744 slice 1 has landed with `Issue.lifecycle_state`, the lifecycle enum, `InvalidTransition`, `allowed_transitions()`, and a guarded `set_lifecycle()` service.
- The guard supports the lifecycle values named here: `refining`, `prd_approved`, `generating_hld`, `hld_approved`, `registering_split`, `split_created`, `lld_generating`, `implementing`, `done`, `failed`, and `cancelled`.
- The guard validates visible-state pairings and never mutates `Issue.state`.

## Current behavior to replace

- `apps/execution/reducer.py` marks `split` complete only when `SeamEvent.to_state == "LLD"`.
- `apps/execution/driver.py` resolves `to_state_id` only to feed that magic string into the reducer.
- Driver tests seed a visible `LLD` `State` row to prove split completion.
- Engine position is mainly process-local in `_registry`; restart loses phase progress except for live run rows and visible `Issue.state`.

## Clarified Ownership

| Topic | Decision |
| --- | --- |
| Engine identity | T761 retrofits the #700 `apps/execution` automation engine. It is not a second engine. |
| Relationship to #757 | #757 owns durable engine run-state and restart recovery. T761 owns durable planning lifecycle milestones on `Issue.lifecycle_state`. |
| Shared boundary with #757 | #757 may use `Issue.lifecycle_state` as an input when rebuilding engine state, but lifecycle transition semantics stay in T761/CODIN-744. |
| `Phase` vs lifecycle | `Phase` remains the recipe currently running; `lifecycle_state` records durable pipeline progress. |
| Scope correction | Lifecycle writes for graph/implement boundaries are allowed only where they are direct engine-owned lifecycle milestones; the core T761 fix is planning-phase lifecycle and the split gate. |
| Fake `LLD` gate | `to_state == "LLD"` is fake because it depends on a visible workflow `State` row named `LLD`, but the product does not seed or own such a board state. HLD approval is now represented by lifecycle `hld_approved`. |

## Decision Record

| Decision | Choice | Reason |
| --- | --- | --- |
| Lifecycle writer | Driver writes through CODIN-744 guarded service | Reducer remains pure; all durable mutation stays behind the guard. |
| Reducer input | Add lifecycle value to `SeamEvent` | Completion rules can key off durable lifecycle without DB access in the reducer. |
| Split gate | `lifecycle_state == hld_approved` | This is the approved HLD signal defined by CODIN-744; no visible `LLD` state is seeded. |
| Register precondition | `Issue.lifecycle_state == hld_approved` | Register starts after HLD approval, not after a visible-state name. |
| Visible workflow | Read and validate only | The engine does not synchronously move `Issue.state`; phase tickets or humans own visible board movement. |
| Failure write | Best-effort `failed` through the guard before marking engine failed | Keeps lifecycle durable while respecting terminal-transition validation. |
| Graph execution | Write `implementing` at leaf launch and `done` at visible completion | Existing graph completion seam remains visible `completed`, but lifecycle is persisted separately. |

## Lifecycle Boundary Map

| Engine boundary | Lifecycle write or read | Owner |
| --- | --- | --- |
| `execute(..., phase="refine")` before launch | Write `refining` | Driver |
| Refine completion on Backlog to Todo seam | Write `prd_approved` | Driver |
| `execute(..., phase="split")` before launch | Write `generating_hld` | Driver |
| HLD approval | Read `hld_approved` from guarded lifecycle event or refreshed issue | Human/phase ticket writes; driver reacts |
| Split completion chain to register | No visible state read; launch register from `hld_approved` | Driver |
| `execute(..., phase="register")` before launch | Write `registering_split` | Driver |
| Register success | Out of scope unless CODIN-744 exposes an existing success seam; split-registration agent or phase ticket writes `split_created` | Agent/phase ticket |
| `generate_leaf_llds()` before each leaf launch | Write `lld_generating` | Driver |
| `execute_graph()` leaf launch | Write `implementing` | Driver |
| Implement completion on visible Done seam | Write `done` | Driver |
| Launch failure or run failure observed by execution | Write `failed` through guard when legal | Driver |

## File Change Map

| File | Change |
| --- | --- |
| `../server/apps/execution/state.py` | Extend `SeamEvent` with a lifecycle field. Do not add lifecycle mutation actions to the reducer contract. |
| `../server/apps/execution/reducer.py` | Replace `_is_complete()` split logic with lifecycle equality to `hld_approved`; remove `to_state == "LLD"` assumptions. |
| `../server/apps/execution/driver.py` | Import CODIN-744 lifecycle guard; write lifecycle at launch/completion/failure boundaries; stop resolving `to_state_id` for split completion; add a lifecycle-change observer entrypoint if CODIN-744 provides a signal. |
| `../server/apps/execution/signals.py` | Wire any CODIN-744 lifecycle-changed signal to the driver. Keep issue-state receiver for visible completion/refine/implement seams. |
| `../server/apps/execution/tests/test_reducer.py` | Replace `LLD` seeded-state cases with lifecycle-driven split completion cases. |
| `../server/apps/execution/tests/test_driver.py` | Assert guard calls and lifecycle-driven register chaining; remove all seeded visible `LLD` state dependencies. |
| `../server/apps/execution/tests/conftest.py` | Add focused lifecycle guard fakes or fixtures only if repeated setup makes tests noisy. |

## Implementation Steps

1. Identify CODIN-744's exact lifecycle module path and service signature, then import only the public guard API.
2. Extend `SeamEvent` with a nullable lifecycle value and update tests/helpers that construct lifecycle completion events.
3. Change reducer split completion to require a running `split` phase plus `lifecycle_state == hld_approved`.
4. In driver launch paths, call the guarded service before spawning the corresponding phase run. If the guard rejects, do not spawn; return a failed engine state with the guard error.
5. Replace `execute(..., phase="register")` precondition from visible `State.name == "LLD"` to `Issue.lifecycle_state == hld_approved`.
6. Add a driver observer for lifecycle changes if CODIN-744 emits one. If it does not, have existing execution-facing calls refresh `Issue.lifecycle_state` and pass it into `SeamEvent`.
7. When split reaches `hld_approved`, mark split done and immediately chain register exactly as today, but without looking up a visible destination state.
8. Add lifecycle writes to graph launch and visible completion boundaries without changing ready-set ordering or dependency behavior.
9. On launch failure, run failure, task cancellation, or failed graph node, write `failed` or `cancelled` only through the guard and tolerate terminal rejection without moving `Issue.state`.
10. Update reducer and driver docstrings/comments so they describe lifecycle approval, not an `LLD` visible-state transition.

## Test Plan

| Area | Tests |
| --- | --- |
| Reducer | Running split completes on lifecycle `hld_approved`; split ignores missing lifecycle, other lifecycle values, unrelated task IDs, and non-running states; no test sends `to_state="LLD"`. |
| Driver launch | Refine, split, register, leaf LLD, and implement launches call the guarded service with the expected lifecycle target before spawn. |
| Split chain | A lifecycle change to `hld_approved` completes split and launches register once; replay does not relaunch. |
| Phantom gate removal | Driver tests do not create a visible `LLD` `State`; register precondition reads lifecycle only. |
| Failure path | Spawn failure writes `failed` through the guard and records engine failure. |
| Visible-state guardrail | Tests assert execution never calls `Issue.save(update_fields=["state"])` or otherwise mutates visible `Issue.state`. |
| Existing behavior | Existing implement completion and graph ready-set tests still pass with added lifecycle writes. |

## Out of Scope

- Implementing the CODIN-744 lifecycle model, migration, HTTP endpoint, MCP tool, or drawer picker.
- Backfilling lifecycle values for existing tasks.
- Adding `LLD`, `HLD`, or lifecycle values as visible `State` rows.
- Having the engine synchronously move issues between Backlog, Todo, In Progress, or Done.
- Changing recipes or prompts except comments that mention the obsolete `LLD` gate.

## Acceptance Signal

This slice is implementation-ready when the reducer's only split-completion signal is `hld_approved`, the driver writes lifecycle through CODIN-744's guard at engine-owned phase boundaries, driver tests prove no visible `LLD` state is required, and visible `Issue.state` remains untouched by execution lifecycle persistence.
