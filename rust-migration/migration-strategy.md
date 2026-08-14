# Recommended migration strategy

## Strategy in one sentence

Implement a vertical strangler **inside the real Tauri shell**, proving and
landing small feature-owned Rust slices while Django remains the shipping
authority, then make one evidence-gated persistence/production handoff and
delete the Python sidecar after all Studio and MCP consumers use the Rust core.

This separates an incremental implementation from the final database-writer
switch. It avoids both failure modes seen before: a new standalone product and a
50,000-line external replacement that reaches the real integration seam only at
the end ([prior-attempts-postmortem.md](prior-attempts-postmortem.md)).

## Non-negotiable seams

- The migrated backend is managed state in the Tauri process, not a child
  executable.
- Studio uses generated GraphQL operations over TauRPC, not loopback REST.
- Domain writes call authored application commands; generated CRUD cannot
  bypass invariants.
- GraphQL, MCP, and native commands call the same application services.
- Events/effects are durable before publication/execution.
- Django and Rust never dual-write production state.
- Existing native ghostty, tmux viewer, ownership, and approved-executable code
  remain until deliberately superseded
  ([`../studio/src-tauri/src/`](../studio/src-tauri/src/)).

## Phase 0: freeze evidence and decisions

Goal: turn the moving source into an executable compatibility ledger before
porting behavior.

Ticket-sized outcomes:

1. Record the 81-operation OpenAPI manifest by consumer: Studio, Python MCP,
   provider hook, browser-dev-only, or unused/retirable
   ([`../openapi.json`](../openapi.json)).
2. Freeze the current 30-tool MCP list, input schemas, result envelopes,
   structured failures, auth, and termination behavior
   ([`../surfaces/worktracker-agent/api/tools.py`](../surfaces/worktracker-agent/api/tools.py),
   [`../surfaces/worktracker-agent/mcp/`](../surfaces/worktracker-agent/mcp/)).
3. Capture status and terminal WebSocket frame/reconnect fixtures
   ([`../backend/apps/runs/tests/test_status_stream.py`](../backend/apps/runs/tests/test_status_stream.py),
   [`../backend/apps/terminals/tests/`](../backend/apps/terminals/tests/)).
4. Import and update the prior attempt's route, MCP, scenario, and 47-database
   manifests as test data, not runtime code.
5. Decide PostgreSQL, browser-only development, and HTTP compatibility policy;
   record the outcomes as ADRs.
6. Define normalized differential comparison: response, rows, revision/cursor,
   emitted facts, and authorized effects.

Exit: every shipping consumer and persistence generation has an owner and an
acceptance case; known intentional contract changes are explicit.

## Phase 1: establish the in-process foundation

Goal: prove the template extensions in Ticketry's actual shell before domain
estimates harden.

Ticket-sized outcomes:

1. Split Tauri composition/managed state out of the oversized `lib.rs` without
   changing behavior ([`../studio/src-tauri/src/lib.rs`](../studio/src-tauri/src/lib.rs)).
2. Pin the template's Rust/SeaORM/Seaography/GraphQL/TauRPC/codegen toolchain and
   add deterministic generated-artifact verification.
3. Mount one small Ticketry-owned GraphQL query through TauRPC alongside all
   existing native commands.
4. Prove relational generation, field hiding, an authored command, typed domain
   error mapping, initialization failure, and restart persistence.
5. Build a database-backed cursor/outbox and prove snapshot/replay/live plus
   lag recovery through a Tauri subscription.
6. Add Tauri composition, migration, transport-bound, and frontend client/cache
   tests following the template.

Exit: [template-architecture.md](template-architecture.md)'s eight-point
composition proof passes in Ticketry.

## Phase 2: adopt persistence safely

Goal: make current Ticketry databases comprehensible to Rust without changing
shipping ownership.

Ticket-sized outcomes:

1. Port/update schema classification, snapshot, restore, historical bridge, and
   semantic preflight from `ticketry-rust`.
2. Create reversible SeaORM migrations that reproduce current physical tables
   and generate committed entities/SDL from a clean database.
3. Add all current and historical SQLite fixtures; prove unknown-schema refusal
   and crash-resumable adoption.
4. Implement the chosen PostgreSQL import/parity path.
5. Add installation manifest, source fingerprint, backup hash, transform ledger,
   and post-adoption validation.

Exit: Rust can adopt a copy of every supported database and reopen it without
altering IDs or replaying effects. Full detail is in
[data-migration.md](data-migration.md).

## Phase 3: Work Management reads and cache seam

Goal: prove the real frontend generation/cache path on the broadest read model
before porting mutations.

Ticket-sized outcomes:

1. Implement read repositories and GraphQL types for workspace, projects,
   states, issue types, modules/work items, attachments, transitions, and launch
   bindings ([`../backend/worktracker/models/`](../backend/worktracker/models/)).
2. Author representative `.graphql` queries and generate TypeScript nodes.
3. Migrate one Studio feature at a time, choosing Apollo or React Query as its
   sole entity authority and deleting the old holding on cutover.
4. Match canonical collection filters/order and unified module/work-item shape
   used in [`../studio/src/shared/api/client.ts`](../studio/src/shared/api/client.ts).
5. Run read-only Django-versus-Rust fixture comparisons and existing Studio
   acceptance cases.

Exit: all Work Management reads in a gated build use in-process GraphQL with no
duplicate cache authority; Django still owns mutations.

## Phase 4: Work Management commands

Goal: port the core transactional rules before any automation can depend on
them.

Implement in independently reviewable command slices:

1. project/catalogue creation and ordering;
2. item creation/update/archive/delete and human sequence allocation;
3. hierarchy, reparenting, module ancestry, and descendant repair;
4. fractional ranking/rebalance and manual module order;
5. blocker graph validation and dependency queries;
6. workflow start/transition/reachability/state deletion rules;
7. revision compare-and-set and identity/revision event publication; and
8. attachments and filesystem authorization.

Primary behavior sources are [`../backend/worktracker/`](../backend/worktracker/),
the pure algorithms/tests in
`/Users/karthik/merge_conflicts/coding/worktracker-rust/src/domain/`, and the
broader parity corpus in
`/Users/karthik/merge_conflicts/coding/Rusty/ticketry-rust/crates/muxed-domain/src/worktracker/`.
Current Django wins whenever older Rust semantics differ.

Exit: every Work Management mutation and resulting row/revision/event matches
the characterized contract on isolated fixture databases.

## Phase 5: settings, provider catalogue, and launch policy

Goal: establish the policy inputs needed by runs and terminals.

Ticket-sized outcomes:

1. migrate `AppSetting`, keybindings, profiles/features JSON, and provider
   catalogue loading/validation;
2. migrate providers, models, reasoning levels, and compatibility joins;
3. migrate launch bindings, required skills, prompt, auto-start, and subtree-run
   policy as authored commands; and
4. replace Studio consumers and publish policy/configuration change facts.

Sources:
[`../backend/apps/settings_store/`](../backend/apps/settings_store/),
[`../backend/worktracker/models/launch_binding.py`](../backend/worktracker/models/launch_binding.py),
and [`../backend/worktracker/models/provider_catalog.py`](../backend/worktracker/models/provider_catalog.py).

Exit: Rust can decide what should launch, but launch effects remain disabled.

## Phase 6: durable events, runs, and automation lifecycle

Goal: make lifecycle facts reliable before launching processes.

Ticket-sized outcomes:

1. finalize the durable event vocabulary/cursor and project-scoped projection;
2. migrate `AgentRun` lifecycle and authoritative status queries;
3. migrate automation-attempt uniqueness/idempotency and transition-occurrence
   identity;
4. implement predetermined IDs and durable launch-effect records;
5. adapt Studio's status store to GraphQL subscription snapshot/replay/live; and
6. port run-scoped auth and termination semantics required by MCP.

Sources:
[`../backend/apps/runs/`](../backend/apps/runs/),
[`../backend/worktracker/signals.py`](../backend/worktracker/signals.py), and the
prior attempt's event/launch-effect ADRs summarized in
[prior-attempts-postmortem.md](prior-attempts-postmortem.md).

Exit: lifecycle state survives crash/restart and duplicate facts do not launch
twice. No production process launch yet.

## Phase 7: documents and worktrees

Goal: port lower-volume local effects and prove the common operation-journal
pattern before terminals.

Ticket-sized outcomes:

1. migrate design-document metadata, authorized paths, watcher lifecycle, and
   document events;
2. migrate worktree lookup/create/discard with per-repository locking;
3. add durable operation IDs and startup reconciliation for filesystem/Git
   crash windows; and
4. cut over Studio document/worktree clients.

Sources:
[`../backend/apps/documents/`](../backend/apps/documents/) and
[`../backend/apps/worktrees/`](../backend/apps/worktrees/).

Exit: database claims and local filesystem/Git reality reconcile after injected
crashes.

## Phase 8: terminal launch, persistence, and reconciliation

Goal: join the existing Rust viewer/runtime to a Rust-owned terminal lifecycle.

This is a hotspot and should be decomposed into separate tickets:

1. terminal-session and viewer-lease repositories;
2. approved provider command construction without a shell;
3. tmux create/discover/attach/input/resize/kill adapter;
4. durable launch/cleanup effect journal with predetermined run/session IDs;
5. hook-spool ingestion and provider lifecycle mapping;
6. startup and periodic reconciliation, idle sweep, and recovery status;
7. native libghostty viewer integration using the existing Tauri code; and
8. optional browser-dev terminal adapter, if the policy retains it.

Sources:
[`../backend/apps/terminals/`](../backend/apps/terminals/),
[`../studio/src-tauri/src/native_terminal/`](../studio/src-tauri/src/native_terminal/),
[`../studio/src-tauri/src/tmux_viewer.rs`](../studio/src-tauri/src/tmux_viewer.rs),
and the prior attempt's local/tmux adapters.

Exit: launch, attach, crash, restart, orphan, idle cleanup, and app-exit cases
pass with tmux as live authority and no Python terminal process.

## Phase 9: dependency-graph execution

Goal: port the orchestration layer after all of its dependencies are Rust-owned.

Ticket-sized outcomes:

1. migrate graph scope/dependency eligibility and graph-run creation;
2. migrate the per-task launch ledger and idempotent scheduling/retry;
3. migrate serial/parallel execution modes that exist in the current working
   tree;
4. consume run/terminal events to advance graph state;
5. reconcile interrupted graph runs at startup; and
6. cut over Studio graph execution and module activity.

Sources:
[`../backend/apps/execution/`](../backend/apps/execution/) and the dependency
relations/services under [`../backend/worktracker/`](../backend/worktracker/).

Exit: deterministic graph scenarios match Django rows, launches, and lifecycle
facts under concurrency and injected failure.

## Phase 10: Rust MCP adapter

Goal: remove FastMCP/Python while preserving the agent contract.

Ticket-sized outcomes:

1. select/pin a Rust MCP implementation and mount one authenticated loopback
   listener inside the Tauri process, preferably on an OS-assigned port passed
   to provider launches rather than a collision-prone fixed port;
2. project the frozen 30 tools directly onto Rust application services;
3. preserve tool descriptions, JSON schemas, structured errors, result wrappers,
   ping, run identity, and zero-argument termination;
4. compare tool-list and scenario transcripts with current FastMCP fixtures;
5. switch provider launch configuration to the Rust endpoint; and
6. delete the generated Python SDK and FastMCP runtime from packaged artifacts
   only after parity.

The larger prior attempt's 33-tool fixture is useful historical evidence, but
current Ticketry's 30-tool registry is authoritative; reconcile the difference
explicitly ([prior-attempts-postmortem.md](prior-attempts-postmortem.md),
[`../surfaces/worktracker-agent/`](../surfaces/worktracker-agent/)).

Exit: real agent runs complete, report lifecycle, call tools, and terminate with
no Python process. The MCP port is the only production loopback listener unless
another external compatibility decision says otherwise.

## Phase 11: cutover and sidecar retirement

Goal: transfer production ownership and remove the operational liability.

Ticket-sized outcomes:

1. produce signed/checksummed cutover evidence for schemas, consumers,
   performance, crash recovery, and real packaged builds;
2. run the data preflight/snapshot/adoption process and publish Rust readiness;
3. switch all Studio calls/subscriptions and provider MCP launch configuration;
4. remove Python sidecar launch, readiness, health, port, auth-secret, and
   orphan-supervision paths;
5. remove Django/FastMCP/Python packaging and generated OpenAPI SDKs;
6. retain/refactor ownership, discovery, native terminal, tmux viewer, and
   approved executable policy;
7. update logs/diagnostics to report in-process task and MCP-listener health; and
8. run packaged macOS restart/crash/update/data-upgrade acceptance.

Exit: process inspection shows only the Ticketry Tauri process plus intentional
provider/tmux child processes; Studio does not need a localhost backend port;
all existing installations either adopt successfully or fail before mutation
with recovery instructions.

## Verification matrix

Every behavior slice should be tested at four layers:

| Layer | Required evidence |
| --- | --- |
| Domain/application | Pure rule tests, transaction tests, idempotency and property cases |
| Persistence/effects | Both clean migrations and adopted fixtures; injected crash windows and reconciliation |
| Interface | GraphQL schema/error/subscription and MCP transcript compatibility; native command authorization |
| Product | Existing/new Studio acceptance cases, Tauri mock composition, and packaged desktop smoke/restart cases |

For differential tests, normalize only intentional wire differences such as
GraphQL envelope shape. Compare semantic data and effects exactly. A fixture
manifest without an executable driver is an inventory, not a passing gate.
