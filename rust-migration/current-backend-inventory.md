# Current backend and consumer inventory

## Scale and boundaries

The production Python surface inspected here is approximately 19,636 lines
across `backend/worktracker`, six capability apps, and `studio_server`, excluding
tests and migrations. The existing Tauri source is approximately 10,340 Rust
lines. Counts use `find`, `wc -l`, and the 2026-08-12 working tree.

| Area | Production Python files | Production lines | Test lines | Migration lines |
| --- | ---: | ---: | ---: | ---: |
| `backend/worktracker` | 55 | 6,261 | 12,003 | 3,089 |
| `backend/apps/documents` | 10 | 1,025 | 1,039 | 53 |
| `backend/apps/execution` | 9 | 1,149 | 2,551 | 149 |
| `backend/apps/runs` | 17 | 1,169 | 2,507 | 499 |
| `backend/apps/settings_store` | 10 | 790 | 1,045 | 64 |
| `backend/apps/terminals` | 53 | 7,387 | 7,059 | 126 |
| `backend/apps/worktrees` | 12 | 955 | 751 | 59 |
| `backend/studio_server` | 11 | 900 | 1,184 | n/a |

The codebase's own context map divides the product into Work Management, Agent
Execution, Workspace Runtime, Studio Experience, and Desktop Runtime
([`../CONTEXT-MAP.md`](../CONTEXT-MAP.md)). That is a better migration unit than
the current REST tags because it follows ownership and lifecycle.

The dependency map shows why the current boundary is hard to extract: 38 files
under the capability apps import `worktracker`, while eight WorkTracker files
import `apps.*`; the production outbound dependency is primarily settings
access. Runs, automation attempts, graph runs, and launch ledgers all relate
back to WorkTracker identities
([`../backend_dependency_map.md`](../backend_dependency_map.md)).

## Persistence model

There are 21 product models and 70 Django migration files across WorkTracker and
the six capability apps.

| Owner | Models | Important invariants and relations |
| --- | --- | --- |
| WorkTracker | `Workspace`, `Project`, `State`, `IssueType`, `Issue`, `Attachment`, `IssueTypeTransition`, `LaunchBinding`, `Provider`, `AgentModel`, `ReasoningLevel`, `AgentModelReasoningLevel` | `Issue` is the unified module/task record; it carries parent and denormalized module links, type, state, fractional rank, blockers, archive state, and a revision. Projects allocate human sequence IDs and carry collection revision. Type/state workflow and launch policy are explicit rows. See [`../backend/worktracker/models/`](../backend/worktracker/models/). |
| Documents | `DesignDocument` | Database metadata plus filesystem watching and update publication. See [`../backend/apps/documents/models.py`](../backend/apps/documents/models.py) and [`../backend/apps/documents/watch.py`](../backend/apps/documents/watch.py). |
| Execution | `GraphRun`, `LaunchedTask` | Durable graph-run header and per-task launch ledger tied to root/project/module/work item identities. See [`../backend/apps/execution/models.py`](../backend/apps/execution/models.py). |
| Runs | `AgentRun`, `AutomationAttempt` | Provider run lifecycle and a unique automation attempt for a work item/transition occurrence. See [`../backend/apps/runs/models.py`](../backend/apps/runs/models.py). |
| Settings | `AppSetting` | Database-backed host settings; profiles/features also exist as data-directory JSON. See [`../backend/apps/settings_store/models.py`](../backend/apps/settings_store/models.py) and [`../backend/apps/settings_store/config.py`](../backend/apps/settings_store/config.py). |
| Terminals | `AgentTerminalSession`, `AgentRunViewerLease` | Run-to-tmux identity, runtime namespace/cleanup state, and viewer lease. tmux is live authority. See [`../backend/apps/terminals/models.py`](../backend/apps/terminals/models.py). |
| Worktrees | `Worktree` | Database operation state around Git/filesystem authority. See [`../backend/apps/worktrees/models.py`](../backend/apps/worktrees/models.py). |

`Issue.state_revision` now advances for every meaningful published field change,
not only state changes. That broader meaning is authoritative over older design
notes and must be retained by Rust
([`../backend/worktracker/models/issue.py`](../backend/worktracker/models/issue.py),
[`../backend/worktracker/services/work_items.py`](../backend/worktracker/services/work_items.py)).

## HTTP surface

The checked OpenAPI document contains 81 GET/POST/PUT/PATCH/DELETE operations
([`../openapi.json`](../openapi.json)). The count by generated tag is:

| Tag | Operations | Tag | Operations |
| --- | ---: | --- | ---: |
| Attachments | 2 | Issue types | 6 |
| Launch bindings | 3 | Models | 4 |
| Modules | 2 | Projects | 4 |
| Providers | 2 | Reasoning levels | 4 |
| States | 5 | Work items | 7 |
| Workflows | 5 | Workspace | 2 |
| Configuration | 5 | Documents | 4 |
| Execution | 4 | Runs | 4 |
| Settings | 4 | System | 1 |
| Terminals | 10 | Worktrees | 3 |

The REST registration is split between WorkTracker routes and host capability
routes ([`../backend/worktracker/rest/urls.py`](../backend/worktracker/rest/urls.py),
[`../backend/apps/rest_api.py`](../backend/apps/rest_api.py)). It covers catalogue
and work-item CRUD, workflow configuration, launch policy, provider/model
catalogues, graph launch/read/reset behavior, run status/lifecycle, terminal
creation/resume/deletion/viewer lease, documents, settings/configuration, and
worktrees.

The 81 operations are not all equally important to preserve. Some exist for the
browser/HTTP architecture or generated SDK shape. Migration acceptance should
be based on the consumer matrix below plus explicit external compatibility
decisions, not on mechanically generating 81 GraphQL fields.

## Realtime and startup behavior

ASGI mounts two WebSockets: `/ws/status` and `/ws/terminal`
([`../backend/studio_server/routing.py`](../backend/studio_server/routing.py)).

The status stream is a correctness protocol, not just a notification socket. It
builds a project-scoped snapshot, accepts a work-item cursor, replays newer
facts, and then sends live workflow, run, attempt, document, and work-item
frames. Work-item frames use identity plus revision so the frontend can
invalidate a single entity and, when membership changed, the containing
collection
([`../backend/apps/runs/consumers.py`](../backend/apps/runs/consumers.py),
[`../backend/apps/runs/projections.py`](../backend/apps/runs/projections.py),
[`../studio/src/features/agents/status/statusFeed.ts`](../studio/src/features/agents/status/statusFeed.ts)).
The React store retains the cursor across reconnects. Rust subscriptions must
preserve snapshot/replay/live ordering and define lag recovery.

The terminal WebSocket is a browser-compatible byte stream backed by tmux
([`../backend/apps/terminals/consumers.py`](../backend/apps/terminals/consumers.py)).
Desktop has an additional native viewer path through Tauri commands, while the
current desktop client still shares some backend/tmux WebSocket behavior
([`../studio/src/features/agents/terminal/internal/terminalClientRuntime.ts`](../studio/src/features/agents/terminal/internal/terminalClientRuntime.ts),
[`../studio/src/features/agents/terminal/internal/tauriTerminalClient.ts`](../studio/src/features/agents/terminal/internal/tauriTerminalClient.ts)).

ASGI startup/shutdown also owns work that will need an explicit Rust lifecycle:
document watcher shutdown, hook-spool ingestion, worktree reconciliation,
provider-catalogue validation, terminal reconciliation, and periodic idle
terminal cleanup ([`../backend/studio_server/asgi.py`](../backend/studio_server/asgi.py)).
These tasks must be composed under Tauri startup and cancelled on exit rather
than recreated as detached processes.

## Domain and complexity hotspots

### Work management

WorkTracker owns more than CRUD. Services validate workflow reachability and
start states, type-specific transition permission, hierarchy/module ancestry,
dependency cycles, rank insertion/rebalancing, scoped reparenting, and
revision-aware writes
([`../backend/worktracker/workflow.py`](../backend/worktracker/workflow.py),
[`../backend/worktracker/ranking.py`](../backend/worktracker/ranking.py),
[`../backend/worktracker/services/`](../backend/worktracker/services/)).
The largest focused files include work-item services at about 449 lines, scoped
workflow logic at about 392 lines, launch binding logic at about 384 lines, and
workflow configuration at about 303 lines. Generated GraphQL CRUD cannot safely
replace these command paths.

### Runs and dependency-graph execution

Graph execution computes scope, respects dependencies, launches eligible work,
records the attempt ledger, and reconciles provider/terminal outcomes back into
the graph. The execution driver is about 546 lines and is coupled to lifecycle
signals and run/terminal facts
([`../backend/apps/execution/driver.py`](../backend/apps/execution/driver.py),
[`../backend/apps/execution/signals.py`](../backend/apps/execution/signals.py),
[`../backend/apps/runs/dao/lifecycle.py`](../backend/apps/runs/dao/lifecycle.py)).
This should migrate after durable events, launch effects, run lifecycle, and
terminal reconciliation exist in Rust.

### Terminals and local effects

Terminals are the largest capability app. Launching, persistence, tmux runtime,
reconciliation, cleanup, browser attachment, native viewer leases, hook
ingestion, and provider-specific command construction are separate authorities
([`../backend/apps/terminals/CONTEXT.md`](../backend/apps/terminals/CONTEXT.md),
[`../backend/apps/terminals/launch.py`](../backend/apps/terminals/launch.py),
[`../backend/apps/terminals/reconciliation.py`](../backend/apps/terminals/reconciliation.py),
[`../backend/apps/terminals/runtime/_tmux.py`](../backend/apps/terminals/runtime/_tmux.py)).
The hard part is preserving crash-window behavior and deciding whether the
database, tmux, provider hook, or viewer owns each lifecycle fact.

### Documents and worktrees

These are smaller by line count but have dual authority: database rows describe
operations while filesystem watchers and Git determine reality. Migration must
use durable operation IDs and startup reconciliation; it must not assume a
committed database row proves a filesystem effect occurred
([`../backend/apps/documents/`](../backend/apps/documents/),
[`../backend/apps/worktrees/`](../backend/apps/worktrees/)).

## What Studio actually consumes

The main generated-SDK wrapper is a 992-line compatibility layer
([`../studio/src/shared/api/client.ts`](../studio/src/shared/api/client.ts)). Its
current consumers use these capabilities:

- configuration profiles and feature configuration;
- workspace bootstrap/acknowledgement;
- projects and the unified module/work-item hierarchy;
- states, issue types, ordering, workflows, transitions, and launch bindings;
- providers, models, reasoning levels, keybindings, and provider catalogue;
- attachments and design-document save/list/completion;
- graph execution and module activity;
- terminal list/create/resume/delete/scratch/viewer lease;
- worktree get/create/discard; and
- live status, workflow, run, attempt, work-item, and document events.

Some host operations bypass the generated wrapper through focused clients,
especially agent launch/status, terminals, and worktrees
([`../studio/src/features/agents/api/agentApi.ts`](../studio/src/features/agents/api/agentApi.ts),
[`../studio/src/features/agents/status/`](../studio/src/features/agents/status/),
[`../studio/src/features/agents/worktrees/internal/api.ts`](../studio/src/features/agents/worktrees/internal/api.ts)).
These raw calls must be included in the migration registry; regenerating only
the OpenAPI-derived calls would miss them.

Studio already follows an entity-cache discipline: server data belongs in
React Query, collection membership is IDs, and realtime identity/revision facts
trigger invalidation. Apollo should replace or feed that authority deliberately;
running Apollo and React Query as independent entity stores would recreate the
duplicate-state problem the existing decisions resolved
([`../docs/decisions/2026-08-04-frontend-state-and-api-contract.md`](../docs/decisions/2026-08-04-frontend-state-and-api-contract.md),
[`../docs/decisions/2026-08-06-one-holding-per-thing.md`](../docs/decisions/2026-08-06-one-holding-per-thing.md)).

## MCP and generated SDK surface

There are three generated/adapter surfaces:

- the TypeScript OpenAPI SDK used by Studio
  (about 15,685 TypeScript lines under `src`;
  [`../surfaces/worktracker-typescript-sdk/`](../surfaces/worktracker-typescript-sdk/));
- the Python OpenAPI SDK used by the agent service
  (about 33,210 Python lines under its package;
  [`../surfaces/worktracker-sdk/`](../surfaces/worktracker-sdk/)); and
- the FastMCP agent service
  (about 2,022 production Python lines under `api` and `mcp`;
  [`../surfaces/worktracker-agent/`](../surfaces/worktracker-agent/)).

The current FastMCP registry is generated from 28 `*_tool` methods plus
`mcp_ping` and `terminate_current_run`: 30 tools in all
([`../surfaces/worktracker-agent/api/tools.py`](../surfaces/worktracker-agent/api/tools.py),
[`../surfaces/worktracker-agent/mcp/tools_adapter.py`](../surfaces/worktracker-agent/mcp/tools_adapter.py),
[`../surfaces/worktracker-agent/mcp/server.py`](../surfaces/worktracker-agent/mcp/server.py)).
The actual registry groups as follows:

- four catalogue/list tools: projects, modules, issue types, and tasks;
- eight workflow/launch-policy tools: get settings, add/remove transition,
  transition permission, start state, upsert/clear launch binding, and auto-start;
- seven item read/create tools: details, task, subtask, review finding, dependency
  graph, scope context, and default-agent launch;
- nine item mutation/execution tools: status, description append, edit, replace/add
  blocker, add dependent, execute graph, reparent, and attach file; and
- two service tools: ping and terminate the current run.

The roughly 1,287-line service composes generated HTTP calls into higher-level
agent operations such as scope context, workflow settings, dependency graph,
review findings, launch, reparent, and attachment
([`../surfaces/worktracker-agent/api/service.py`](../surfaces/worktracker-agent/api/service.py)).

The Rust destination should express that composition once in application
services and make both GraphQL and MCP thin projections. Keeping the Python MCP
adapter would retain a Python process and generated Python SDK, defeating the
sidecar-removal goal. External MCP clients still need a transport, so the target
must expose a narrowly authenticated Rust MCP listener from the Tauri process.

## Existing Rust that stays

The Tauri shell already contains substantial product code:

- data-directory ownership and instance coordination
  ([`../studio/src-tauri/src/ownership.rs`](../studio/src-tauri/src/ownership.rs));
- native ghostty/libghostty integration and frame/view lifecycle
  ([`../studio/src-tauri/src/native_terminal/`](../studio/src-tauri/src/native_terminal/),
  [`../studio/src-tauri/native/`](../studio/src-tauri/native/));
- durable tmux viewer attachment and native commands
  ([`../studio/src-tauri/src/tmux_viewer.rs`](../studio/src-tauri/src/tmux_viewer.rs),
  [`../studio/src-tauri/src/viewer_commands.rs`](../studio/src-tauri/src/viewer_commands.rs)); and
- executable discovery and approved host execution
  ([`../studio/src-tauri/src/discovery.rs`](../studio/src-tauri/src/discovery.rs),
  [`../docs/desktop-executable-policy.md`](../docs/desktop-executable-policy.md)).

Keep those capabilities. Decompose the oversized composition in
[`../studio/src-tauri/src/lib.rs`](../studio/src-tauri/src/lib.rs) before adding
the application backend. The sidecar supervisor, health/readiness plumbing,
port discovery, and Python packaging become deletion candidates only after the
last Rust capability and MCP cut over
([`../studio/src-tauri/src/supervisor.rs`](../studio/src-tauri/src/supervisor.rs),
[`../backend/packaging/sidecar.py`](../backend/packaging/sidecar.py)).
