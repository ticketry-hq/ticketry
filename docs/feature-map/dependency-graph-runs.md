# Dependency-graph runs

Ticketry persists root-scoped campaigns that launch eligible direct children in parallel or serial order and exposes factual planning reads separately from execution.

Surfaces: browser, desktop

## Sub-features

- `dependency-graph-parallel-run`: Arm or press a selected branch's persisted parallel campaign.
- `dependency-graph-serial-run`: Start the first eligible direct child and wait for its serial frontier to settle.
- `dependency-graph-active-run`: Restore the campaign's live-run affordance from persisted holding and status data.
- `dependency-graph-planning-read`: Read the current subtree and dependency edges without launching work.
- `dependency-graph-agent-execution`: Execute or reset a root campaign through scoped MCP tools.
- `dependency-graph-planning-projection`: Share project planning records through Apollo rather than a second execution model.

## How to get to it

Select a module and a work item with children, then open the **Details** region.
Click **Run subtree** or **Run subtree serially**. The selected branch registers
`normal-run-command` (Cmd+Enter) for parallel execution when eligible; serial
execution has no dedicated default chord. While a campaign descendant is live,
use **Open subtree run** to focus its run. Ordinary **Run item** starts one
ticket's agent and is a separate action even on a branch; see
[Agent launch](agent-launch.md).

An authenticated agent can read `get_dependency_graph(root_task_id)` and invoke
`execute_dependency_graph(root_task_id, reset?, agent?)`. These are agent-facing
entry points, not a graph-canvas UI. The `studio/src/features/planning-graph`
domain supplies the project-wide Plan/Sprints read model; it has no separate
execution button or keymap action. [Agent Execution context](../../docs/eventcatalog/domains/agent-execution/index.mdx)
and the [execution context](../../studio/src-tauri/crates/execution/ticketry-agent-execution/src/graph_run_service/CONTEXT.md)
define the scheduling vocabulary.

## Prerequisites

Use a persisted branch with module ancestry and a current issue-type/state
binding whose subtree-run capability is enabled. The provider, model, profile,
module folder and any required trust must permit launch; use a disposable
provider for automated execution. Children and blockers must have configured
workflow states. For automatic advancement, the root must remain armed and the
execution reconciliation service must be available. MCP calls obey the caller's
project/root authority. The project planning projection requires a selected
project; the Plan/Sprints UI is Roadmap-gated separately from subtree execution.

## Expected behavior

- Both subtree buttons share one capability gate. A branch without capability
  shows disabled controls with **Subtree execution is not available in this
  item's current state.** Loading the persisted holding hides the controls.
  Pending presses are guarded per control. Source: the subtree actions and
  `studio/src/app/shell/ticket-workspace/selected-ticket/details/internal/subtreeRun.ts`.
- The frontend reads `ExecutionGraphRunHolding` with a network-only query, then
  uses `CreateExecutionGraphRun` or `UpdateExecutionGraphRun` and writes the
  authoritative returned holding into Apollo. Serial sends `serial`; parallel
  sends a null `executionMode`, which resolves to parallel. A nonempty prepared-child list
  reports **Subtree run started.** or **Serial subtree run started.** An accepted
  press with no launches reports that every remaining work item is finished,
  blocked or already running. Refusal reports the error; a stale capability
  refreshes both capability and item state without automatically retrying.
- A root schedules only direct children, even though the factual graph read
  includes deeper descendants. Declared blockers must be satisfied, including
  blockers outside the subtree; the root's own blockers do not gate children.
  Archived, completed-group, cancelled-group and **Review** items satisfy a
  dependency. Candidates sort by stored sequence then ID. Parallel claims all
  eligible children; serial selects the first and holds its frontier until the
  child is satisfied and both run and terminal are inactive. An ended,
  unsatisfied child requires a deliberate press. Durable claims prevent
  automatic replay from creating another launch. Source: execution context,
  graph predicates and the Rust graph-run service tests.
- A deliberate press can revive inactive work after cleanup and refreshes
  policy/mode for future children while preserving existing claims. There is
  no prelaunch confirmation/cancel dialog on these controls. MCP reset clears
  the root header and claims before execution; reset alone does not terminate
  existing processes or change Work Items or dependencies.
- The Details projection selects the newest live descendant run started at or
  after the persisted campaign's update timestamp. It displays a lifecycle
  badge and **Open subtree run**, hiding parallel and serial buttons. Completion
  restores the controls; a refusal can refresh a stale holding. This is a
  presentation projection, not the scheduler's direct-child frontier. Source:
  `studio/src/features/execution/usePersistedSubtreeRun.ts`.
- The MCP factual read returns current nonarchived subtree nodes with state,
  parent and internal blocker edges; it needs no campaign and launches nothing.
  A childless root returns `graph_empty`. Execution additionally evaluates
  external blockers and liveness. The project `PlanningGraph` query supplies
  epics, Stories, sprints, states and creation types to Plan/Sprints; that query
  neither arms nor advances graph runs.

## Verifying it

Browser feature cases live in `studio/e2e/features/dependency-graph-runs.spec.ts`;
only passing runner evidence verifies the cells below.

Scope controls to `getByRole('region', { name: 'Details' })`, then use the exact
button names above; there is no dedicated subtree-button test ID. Check
`aria-busy`, disabled state, lifecycle badge and toast, then read `graphRuns`
by root identity and the launched children's Agent Run/Terminal Session records.
Reload/reselect to verify the holding and active affordance; restart evidence
must also establish authoritative state and settled terminal cleanup.

| Existing coverage | Narrow command | Proof limit |
| --- | --- | --- |
| `studio/src/test/overhaulSubtreeRunAcceptance.test.tsx`: guarded Cmd+Enter, shape dispatch, missing binding, `overhaul-21` repeated press, `overhaul-57` serial/shared gate, `overhaul-339` persisted active affordance, `overhaul-340` refusal refresh | `bun run --cwd studio test src/test/overhaulSubtreeRunAcceptance.test.tsx` | Mocked runtime/GraphQL; no external provider or native renderer. |
| `studio/src/features/execution/mutationTransport.test.ts`: holding read, restricted create/update, omitted mode and authoritative cache write | `bun run --cwd studio test src/features/execution/mutationTransport.test.ts` | Transport contract with fixtures. |
| `studio/src/features/planning-graph/planningModel.test.ts`: project planning adaptation, Story filtering, backlog/state and identity rules | `bun run --cwd studio test src/features/planning-graph/planningModel.test.ts` | Planning projection only. |
| `studio/src-tauri/tests/graph_run_service.rs`: policy refresh, reset, races, durable replay, settled retry, serial satisfaction/termination and external blocker advancement | `cargo test --manifest-path studio/src-tauri/Cargo.toml --test graph_run_service` | SQLite/service harness with injected terminal runtime; no paid provider/native rendering. |
| `studio/src-tauri/crates/execution/ticketry-agent-execution/tests/it/execution_graph_facts.rs`: current graph without campaign, external blockers, liveness/claims and scope failures | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-agent-execution --test it execution_graph_facts` | Factual read/service seam only. |
| `studio/e2e/web-app.spec.ts`: **sends serial and parallel subtree launches through the visible controls** | `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'sends serial and parallel subtree launches'` | Intercepts graph mutations; stale selector/setup described below. |

The numbered subtree cases are part of `studio/docs/overhaul-acceptance.md` and
`bun run --cwd studio test:overhaul`. The disposable desktop harness
`studio/scripts/desktop-agent-acceptance.mjs`, invoked with
`bun run --cwd studio test:e2e:desktop`, covers a single Run item and restart
journey, not a dependency campaign. No current provider-backed end-to-end
campaign/restart or graph-specific native desktop journey was identified.
This map was verified against source/tests, without a live walkthrough.

## End-to-end suite

Suite: studio/e2e/features/dependency-graph-runs.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `dependency-graph-parallel-run` | @case-graph-serial-parallel @case-graph-frontier-blockers | n/a: Campaign controls submit immediately and have no cancel dialog. | @case-graph-empty-recovery | @case-graph-empty-recovery | @case-graph-serial-parallel @case-graph-empty-recovery | @case-graph-serial-parallel @case-graph-empty-recovery |
| `dependency-graph-serial-run` | @case-graph-serial-parallel @case-graph-frontier-blockers | n/a: Serial launch has no confirmation or cancel dialog. | @case-graph-empty-recovery | @case-graph-empty-recovery @case-graph-empty-disabled | @case-graph-serial-parallel | @case-graph-serial-parallel @case-graph-frontier-blockers |
| `dependency-graph-active-run` | @case-graph-serial-parallel | n/a: Open subtree run focuses an existing run without confirmation. | n/a: The active affordance is a read-only projection; campaign request refusals are covered by the serial and parallel rows. | @case-graph-empty-disabled | @case-graph-serial-parallel | @case-graph-serial-parallel |
| `dependency-graph-planning-read` | @case-graph-factual-planning @case-graph-frontier-blockers | n/a: Factual graph reads do not mutate or launch work. | @case-graph-empty-disabled | @case-graph-empty-disabled | @case-graph-factual-planning | @case-graph-factual-planning |
| `dependency-graph-agent-execution` | desktop-only: Browser MCP execute_dependency_graph refuses with execution_reconciliation_unavailable. | n/a: MCP reset clears claims and is not process cancellation. | @case-graph-mcp-reset | desktop-only: Browser MCP execution refuses execution_reconciliation_unavailable even on a childless root. | @case-graph-mcp-reset | @case-graph-mcp-reset |
| `dependency-graph-planning-projection` | @case-graph-apollo-projection @case-graph-projection-empty-recovery | n/a: The project planning projection is a read-only query. | @case-graph-projection-empty-recovery | @case-graph-projection-empty-recovery | @case-graph-apollo-projection | @case-graph-apollo-projection @case-graph-projection-empty-recovery |

All cases run in a browser with the real Rust GraphQL/MCP adapter.
Browser UI campaigns launch real providers; its MCP execution/reset path is
refused with `execution_reconciliation_unavailable` because the adapter starts
the MCP runtime without a terminal-launch service. The refusal case checks
both presses leave the authoritative campaign unchanged. Graph
mutation requests are observed, never replaced with successful responses.
The copied serial/parallel case retains its exact title and serial success
assertion; the current serial control's accessible name is Run subtree serially.
The feature runner owns disposable profiles, fixture process and private tmux
cleanup. Provider completion waits for the runtime's 15-second lifecycle sweep
through authoritative historical session state and process absence.

## Relevant code

- `studio/src/features/execution`: Graph Run operations, mutation transport and persisted active-run projection.
- `studio/src/features/planning-graph`: Apollo project planning query, adaptation, convergence and refresh; no independent execution engine.
- `studio/src/app/shell/ticket-workspace/selected-ticket/details/NormalRunAction.tsx`, `studio/src/app/shell/ticket-workspace/selected-ticket/details/SerialRunAction.tsx`, `studio/src/app/shell/ticket-workspace/selected-ticket/details/internal/subtreeRun.ts` and `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx`: buttons, capability, feedback and descendant selection.
- `studio/src/app/navigation/keymapBindings.ts`: Cmd+Enter default.
- `studio/src-tauri/crates/execution/ticketry-agent-execution/src/graph_run_service` and `studio/src-tauri/crates/execution/ticketry-agent-execution/src/execution/graph`: persisted scheduling and factual reads.
- `studio/src-tauri/crates/execution/ticketry-agent-execution/src/execution/graph_run` and `studio/src-tauri/crates/execution/ticketry-agent-execution/src/execution/reconciliation`: restricted Graph Run mutations and automatic advancement.
- `studio/src-tauri/crates/surfaces/ticketry-mcp/src/launch_tools.rs` and `studio/src-tauri/crates/surfaces/ticketry-mcp/src/read_tools.rs`: agent graph entry points.
- [One live agent per work item ADR](../../studio/docs/adr/0013-one-live-agent-per-work-item-decided-by-the-edge.md): replacement and liveness constraints.

## Gotchas

- **Subtree** is the read scope, not recursive launch permission. The factual
  read omits external blocker edges; their absence does not prove a child can
  launch. Work-item workflow state and run/terminal liveness remain separate.
- The legacy browser case still asks for **Run serially**, while the new feature suite and production expose
  **Run subtree serially**; shared `studio/e2e/support.ts` also waits for removed
  `modules-pane-toggle`. It is existing historical coverage, not a current
  passing proof. Do not silently repair product or harness code in this map task.
- Genuine launches require a configured real or disposable provider and runtime
  services. Mocked launch lists prove UI feedback only. Browser/xterm evidence
  cannot prove native libghostty rendering, desktop focus or native retention;
  those require a desktop build. No paid-provider execution was performed here.
- An armed header alone is not live work. The active affordance depends on
  status delivery and campaign timestamps; the serial frontier also requires
  termination. Resetting claims while processes still run is not cancellation.
- The old [Context Map](../../CONTEXT-MAP.md) contains pre-crate-split links and
  projection wording. Follow the linked current execution context and source
  above for graph semantics; neither the planning read nor a success toast is
  proof of a completed campaign.
