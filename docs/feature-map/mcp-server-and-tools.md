# MCP server and tools

Ticketry exposes local work-management tools to providers through a packaged stdio bridge and an owned data-directory socket.

Surfaces: browser, desktop, manual

## Sub-features

- `mcp-map-socket-ownership`: Bind the private MCP socket only while owning its data directory.
- `mcp-map-provider-bridge`: Connect provider stdio to the in-process socket through the packaged hook executable.
- `mcp-map-global-authority`: Use the installed user-level server across projects without run authority.
- `mcp-map-run-authority`: Keep Ticketry-launched agents inside persistent run grants and project scope.
- `mcp-map-work-item-tools`: Read and edit work items, hierarchy, blockers, tags and attachments.
- `mcp-map-workflow-tools`: Discover workflow policy and perform revision-guarded policy edits and agent-origin state moves.
- `mcp-map-sprint-tools`: Discover open sprints and goals, assign work and publish scoped suggestions.
- `mcp-map-launch-tools`: Launch eligible work through the default-agent and Run Now tools with structured refusal.
- `mcp-map-run-termination`: Stop only the caller's authorized run without changing its ticket.
- `mcp-map-state-readback`: Prove a move from its structured result and authoritative task readback.

## How to get to it

A Ticketry-launched provider receives a `ticketry` MCP stdio configuration whose
command is the absolute packaged `ticketry-hook` path and whose arguments are
`mcp --data-dir <absolute-directory> --agent-run-id <run-id>`. The provider forwards
`TICKETRY_MCP_AUTHORIZATION`; the agent invokes tools through its MCP client,
not through a settings button or keyboard action.

Installed packaged startup registers a user-level global server for Claude Code
and Codex: `ticketry-hook mcp --data-dir <absolute-directory> --global`. Plain CLI
sessions can connect from any local folder. Manual registration uses that same
command in provider configuration; running the command itself does not edit
configuration. See the [socket plan](../plans/CODING-1550-mcp-socket-spec.md),
[global MCP plan](../plans/CODING-2533-global-mcp-spec.md) and
[Work Management context](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/CONTEXT.md).

## Prerequisites

The target Ticketry instance must be running, own the selected data directory
and have finished reconciliation. Calls use that directory's `mcp.sock`; there
is no MCP TCP port. Use the index's isolated desktop profile for test writes.
Run mode additionally needs an existing granted run and nonempty launch
authorization. Global mode requires no secret and cannot be combined with a run
ID. Launch tools also require eligible work, module ancestry, configured launch
policy, provider and folder/trust prerequisites; see [Agent launch](agent-launch.md).

## Expected behavior

- The socket service refuses another directory's ownership guard, leaves a
  non-socket collision intact, reclaims a stale socket and removes only its own
  socket on shutdown. `mcp_ping` checks transport/tool execution without a
  work-item write. Source: socket service and its tests below.
- Global reads cover all projects; run reads and writes resolve through the
  caller's project/grants. Missing run authorization fails rather than falling
  back to global. An offline bridge returns `service_unavailable`; reconnect
  restores initialization, but interrupted requests are not automatically
  replayed. Registration remains on quit; reconnect through the provider's MCP
  controls (Claude `/mcp`) after restarting Ticketry.
- `list_projects`, `list_modules`, `list_issue_types`, `list_tasks`,
  `get_task_details`, `get_task_scope_context` and `get_dependency_graph` provide
  factual reads. Create/update, description, tag, hierarchy, blocker, finding
  and attachment tools delegate to Work Management operations; the
  [live tool catalog](../../studio/src-tauri/crates/surfaces/ticketry-mcp/src/registry.rs)
  owns their names and input shapes.
- `get_issue_type_workflow_settings` returns the start state, transition
  permissions, launch bindings, auto-start and revision. Workflow edits require
  that revision. `update_task_status` identifies every move as agent-origin and
  returns `ok: false` plus the gate's structured reason when refused, including
  `human_only_transition`; global authority obeys the same permissions.
- `list_sprints` returns planned/active sprints in sequence order;
  `get_sprint_goals` supplies goal identities. Create/update sprint selection
  distinguishes omitted, null and a selector; a sprint update is an exclusive
  patch. `suggest_sprint_story` publishes suggestions for the bound suggestion
  run without assigning a Story. Follow [Sprint lifecycle](sprint-lifecycle-and-goals.md)
  and [Suggestion review](suggestion-review.md) for product behavior.
- Launch tools return durable launch identities or structured refusal. Graph
  execution and reset are described in [Dependency-graph runs](dependency-graph-runs.md).
  `terminate_current_run` stops the bound run without changing or archiving its
  ticket; global callers are refused. A committed handoff returns
  `continued_by_handoff` and keeps the run alive for the queued destination.
  Disconnecting the MCP client alone is not a run cancellation.

## Verifying it

Use `mcp_ping`, then read the target with `get_task_details(id_or_key)` and its
type's `get_issue_type_workflow_settings(type_id)`. Make an allowed
`update_task_status(project_id, task_id, status_name)` call, inspect structured
`ok` and any `code/detail/from/to`, and read `get_task_details` again to confirm
the returned `state_id`. Resolve that identity against policy/catalog state;
the requested name or a successful JSON-RPC envelope alone proves no move.
For a rejected human-only move, verify the task retains its previous state.
After reconnect/restart, read again before retrying an interrupted write.

| Existing coverage | Narrow command | Proof limit |
| --- | --- | --- |
| `studio/src-tauri/crates/surfaces/ticketry-mcp/src/tests.rs`: owned/private socket, collisions, scoped reads, handshake, restart authority and readiness | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-mcp --lib` | Real socket/service fixtures; no installed provider. |
| `studio/src-tauri/crates/app/ticketry-hook/tests/cli.rs`: incompatible modes and no run-to-global fallback | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-hook --test cli` | Helper process/CLI seam. |
| `studio/src-tauri/crates/app/ticketry-hook/tests/mcp_global_runtime.rs`: cross-project reads, human-only refusal with state readback, run-termination refusal and offline recovery | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-hook --test mcp_global_runtime` | Real bridge/listener plus temporary database; no provider configuration discovery. |
| `studio/src-tauri/tests/mcp_acceptance.rs`: CRUD, hierarchy, workflow, blockers and ordered stage skills | `cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance mcp_mutations_cover_crud_hierarchy_workflow_and_blockers_through_rust_commands` and `cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance mcp_stage_skills_use_the_workflow_list_contract` | Rust command/socket fixture coverage. |
| `studio/src-tauri/tests/mcp_acceptance/sprint_assignment.rs` and `studio/src-tauri/tests/mcp_acceptance/sprint_discovery.rs`: selector assignment, refusal and discovery | `cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance sprint_assignment` and `cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance sprint_discovery` | Temporary database and granted-run fixtures. |
| `studio/src-tauri/tests/mcp_acceptance/termination.rs`: reply-before-stop, restart, handoff and ticket preservation | `cargo test --manifest-path studio/src-tauri/Cargo.toml --test mcp_acceptance termination` | Injected terminal/process runtime; response is not independent installed-process termination proof. |
| `studio/scripts/desktop-agent-acceptance.mjs` and `studio/scripts/desktop-acceptance-provider.mjs` | `bun run --cwd studio test:e2e:desktop` | Authored macOS desktop path with disposable Codex-compatible provider, packaged bridge, occupied former ports, visible `state-picker` moves Implement → Review → Done, reload and desktop application restart. Stale setup is described below; no paid provider. |

The [desktop harness](../../studio/e2e-desktop/README.md) checks the provider's
nonempty launch authority and matching data directory and records
`provider-mcp.log`. UI state and persisted reload/restart are additional proof.
This is authored coverage, not current passing desktop proof: the harness
still clicks **+ Add Module**, while current setup uses the footer Module
Manager's **New module** form. It inherits the source-confirmed module-creation
setup drift described in [Onboarding gotchas](onboarding.md#gotchas), which must
be migrated before this scenario can establish current desktop MCP behavior.
Provider registration file tests live in
`studio/src-tauri/crates/foundation/ticketry-provider/tests/claude_global_mcp.rs`
and `studio/src-tauri/crates/foundation/ticketry-provider/tests/codex_global_mcp.rs`;
run them with `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-provider --test claude_global_mcp`
or `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-provider --test codex_global_mcp`.
These cover configuration writes, not live CLI discovery. Installed global
checks are separately recorded in the [release evidence](../plans/CODING-2684-global-mcp-release-evidence.md).
This map adds no live walkthrough; paid-provider tool execution and a complete
desktop journey for every tool family remain uncovered here.

## End-to-end suite

Suite: studio/e2e/features/mcp-server-and-tools.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `mcp-map-socket-ownership` | @case-mcp-socket-ping | n/a: binding the socket is automatic and has no cancel step | @case-mcp-socket-handshake-refusals | @case-mcp-socket-ping | @case-mcp-socket-ping @case-mcp-bridge-authority-modes | desktop-only: reclaiming a stale socket and removing it on shutdown need a restart of the owning instance, which the browser suite cannot do; `ticketry-mcp` socket tests and the desktop harness restart cover it |
| `mcp-map-provider-bridge` | @case-mcp-provider-run-scope | @case-mcp-provider-run-scope | @case-mcp-bridge-authority-modes | @case-mcp-provider-run-scope | @case-mcp-provider-run-scope @case-mcp-bridge-authority-modes | @case-mcp-provider-run-scope |
| `mcp-map-global-authority` | @case-mcp-global-reads | n/a: a global call is one request and reply with no cancel step | @case-mcp-launch-refusals | @case-mcp-global-reads | @case-mcp-global-reads @case-mcp-bridge-authority-modes | @case-mcp-root-story-stream @case-mcp-task-edit-and-move |
| `mcp-map-run-authority` | @case-mcp-provider-run-scope | n/a: a run grant has no cancel step; stopping the run is `mcp-map-run-termination` | @case-mcp-provider-run-scope @case-mcp-socket-handshake-refusals @case-mcp-bridge-authority-modes | @case-mcp-provider-run-scope | @case-mcp-provider-run-scope | @case-mcp-provider-run-scope |
| `mcp-map-work-item-tools` | @case-mcp-attachment-renders @case-mcp-task-edit-and-move @case-mcp-description-append @case-mcp-root-story-stream @case-mcp-subtask-reparent @case-mcp-blocker-edge @case-mcp-tags-and-dependencies @case-mcp-global-reads | n/a: each tool call commits or refuses atomically, with no cancel step | @case-mcp-attachment-missing @case-mcp-subtask-reparent @case-mcp-blocker-edge @case-mcp-tags-and-dependencies | @case-mcp-global-reads | @case-mcp-global-reads @case-mcp-task-edit-and-move @case-mcp-description-append @case-mcp-root-story-stream @case-mcp-subtask-reparent @case-mcp-blocker-edge @case-mcp-tags-and-dependencies @case-mcp-attachment-renders | @case-mcp-attachment-renders @case-mcp-task-edit-and-move @case-mcp-description-append @case-mcp-root-story-stream @case-mcp-subtask-reparent @case-mcp-blocker-edge @case-mcp-tags-and-dependencies |
| `mcp-map-workflow-tools` | @case-mcp-workflow-policy @case-mcp-task-edit-and-move | n/a: a policy edit or move commits or refuses atomically | @case-mcp-workflow-policy @case-mcp-human-only-edge | @case-mcp-workflow-policy | @case-mcp-workflow-policy @case-mcp-task-edit-and-move | @case-mcp-workflow-policy @case-mcp-human-only-edge |
| `mcp-map-sprint-tools` | @case-mcp-sprint-assignment @case-mcp-provider-run-scope | n/a: sprint reads and selector writes have no cancel step | @case-mcp-sprint-assignment @case-mcp-provider-run-scope | @case-mcp-sprint-assignment | @case-mcp-sprint-assignment @case-mcp-provider-run-scope | @case-mcp-sprint-assignment |
| `mcp-map-launch-tools` | desktop-only: the browser GraphQL adapter's MCP service has no terminal launcher, so `launch_default_coding_agent` returns `terminal_launch_unavailable` and `run_now` returns `run_now_unavailable` | n/a: a launch request has no cancel step; stopping the run is `mcp-map-run-termination` | @case-mcp-launch-refusals | n/a: every launch names exactly one target | desktop-only: both launch tools refuse in the browser adapter, as recorded under Success | desktop-only: no browser launch through MCP commits, so there is no launch identity to read back |
| `mcp-map-run-termination` | @case-mcp-provider-terminates-own-run | n/a: a termination request has no cancel step | @case-mcp-launch-refusals | n/a: termination always targets the caller's bound run | @case-mcp-provider-terminates-own-run | @case-mcp-provider-terminates-own-run |
| `mcp-map-state-readback` | @case-mcp-state-readback | n/a: a move commits or refuses atomically | @case-mcp-state-readback @case-mcp-human-only-edge | @case-mcp-state-readback | @case-mcp-state-readback | @case-mcp-state-readback |

Every case calls the isolated profile's socket through
`studio/scripts/mcp-socket-client.mjs` (`callSocketMcpTool`, global authority) or
drives the packaged `ticketry-hook mcp` bridge. Run-authority cases launch the
disposable Codex-compatible provider through **Run item**. Its `startCalls`
control makes run-scoped calls while the provider is still live, then closes the
bridge. No case uses the developer's socket or data directory. The eight
convergence cases from `studio/e2e/web-app.spec.ts` keep their exact titles. The
review-finding tools are proven by the [Review findings](review-findings.md) suite,
and `execute_dependency_graph` by [Dependency-graph runs](dependency-graph-runs.md).

`suggest_sprint_story` succeeds only for the sprint's current suggestion run.
Typed suggestion execution carries no interactive MCP credentials, so the
browser suite proves its `run_not_current` refusal and leaves published
suggestions to [Suggestion review](suggestion-review.md). The browser adapter
refuses MCP launches (see the launch row). A refused launch still started a
run about seven seconds later in exploration; that defect is tracked as
CODING-LAUNCH-DEFECT. `continued_by_handoff` and restart behavior remain proven
by the `mcp_acceptance` termination tests listed above.

## Relevant code

- `studio/src-tauri/crates/surfaces/ticketry-mcp/src`: tool registry, dispatch, scope, handshake, socket lifecycle and termination.
- `studio/src-tauri/crates/app/ticketry-hook/src`: provider stdio bridge and CLI authority modes.
- `studio/src-tauri/crates/foundation/ticketry-data-directory/src`: data-directory ownership guard.
- `studio/src-tauri/crates/foundation/ticketry-provider/src/global_mcp.rs` and `studio/src-tauri/crates/foundation/ticketry-provider/src/codex_global_mcp.rs`: provider registration.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/mcp_runtime.rs`, `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/global_mcp_registration.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/rust_runtime_launch.rs`: owned desktop listener, registration gates and launch wiring.
- `studio/src-tauri/crates/execution/ticketry-launch/src/planning/mcp_profile.rs`: run-specific provider configuration.

## Gotchas

- Development builds, the GraphQL adapter and launches with data-directory
  overrides skip global registration. Global authority means this local
  instance's projects, not remote access or run-control permission.
- Follow [CLAUDE.md](../../CLAUDE.md) and the
  [Work Management route/operation registry](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs):
  database-backed public writes bind concrete identity and allowlist writable
  fields; WorkItem parent, blockers, classification, archive and state enter
  the restricted model update. A GraphQL state transition is an exclusive
  patch, never mixed with unrelated fields. MCP convenience tools do not
  authorize replacement per-field GraphQL RPCs or direct database writes.
- A state move, run lifecycle and process termination are separate facts.
  `termination_requested` is a request result; verify terminal/run liveness
  separately. Handoff continuation is deliberately not a stop.
- Browser GraphQL or mocked frontend evidence does not prove socket/bridge
  connectivity, native rendering or actual provider discovery. Keep fixture,
  installed-release and paid-provider claims distinct.
