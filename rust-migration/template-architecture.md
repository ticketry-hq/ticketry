# Template assessment and target architecture

## What was inspected

The reference template is
`/Users/karthik/merge_conflicts/general/tauri-graphql-template`. The review read
its root guidance, README, architecture/stability/model-addition documents,
Cargo and package manifests, database composition and migrations, generated
entities and schema, GraphQL/TauRPC transport, Apollo link/client/codegen,
drift-verification scripts, and Rust/TypeScript tests. Principal sources are:

- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/README.md`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/docs/architecture.md`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/docs/adding-a-model.md`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/docs/stability-boundary.md`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/src-tauri/src/db/`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/crates/tauri-graphql/`
- `/Users/karthik/merge_conflicts/general/tauri-graphql-template/src/graphql/`

## The template's useful architecture

The template implements a migration-first generation chain:

```text
SeaORM migration
  -> clean migrated SQLite database
  -> generated SeaORM entities
  -> generated Seaography CRUD schema and SDL
  -> authored frontend .graphql operations
  -> generated TypedDocumentNode operations
  -> Apollo link
  -> one typed TauRPC GraphQL endpoint in the Tauri process
```

At runtime it opens `application.sqlite3` under Tauri's application-data
directory, enables foreign keys, limits the SQLite pool to four connections,
runs forward migrations, builds the schema, and installs the TauRPC endpoint
(`/Users/karthik/merge_conflicts/general/tauri-graphql-template/src-tauri/src/db/`;
`/Users/karthik/merge_conflicts/general/tauri-graphql-template/src-tauri/src/app.rs`).
Calls made before initialization receive a
structured service-unavailable error rather than racing partially composed
state.

The transport supports unary GraphQL execution and subscription IDs backed by
Tauri channels. Subscription buffers are bounded at 256, and unsubscribe aborts
and removes the task
(`/Users/karthik/merge_conflicts/general/tauri-graphql-template/crates/tauri-graphql/src/endpoint.rs`).
Studio therefore needs no HTTP server, port allocation, CORS, per-launch API
secret, or WebSocket just to call its own backend.

Generated artifacts are committed and checked for drift by rebuilding a clean
scratch database and byte-comparing entities, SDL, TauRPC bindings, and frontend
GraphQL output. The template pins its toolchain and framework versions in
`rust-toolchain.toml`, `Cargo.toml`, `src-tauri/Cargo.toml`, and `package.json`.
At the time inspected these include Rust 1.95, SeaORM 2.0.1, Seaography
2.0.0-rc.9, async-graphql 7.0.19, Tauri 2.11.5, and Rust `taurpc` 0.8.2.
Ticketry should copy the pinning and drift discipline, then upgrade only through
explicit compatibility work.

## Testing conventions worth adopting

The template tests multiple boundaries instead of relying on one happy path:

- migrations move forward/backward and reject incompatible existing schemas;
- database path and restart tests prove persistence;
- generated CRUD tests cover filtering, ordering, pagination, updates,
  deletes, constraints, and batch atomicity;
- Tauri mock tests exercise the real composition;
- transport tests cover malformed input, bounds, readiness, and subscription
  lifecycle;
- frontend tests exercise Apollo cache/list convergence; and
- a single verification command checks drift, type generation, frontend tests,
  build, format, Clippy, and Cargo tests.

Relevant locations are the template's `src-tauri/tests/`,
`crates/tauri-graphql/tests/`, `src/graphql/*.test.ts`, and
`scripts/verify-generated.mjs`, all under
`/Users/karthik/merge_conflicts/general/tauri-graphql-template/`.

Ticketry should add a second testing dimension: characterization/differential
cases against current Django. The template proves its own mechanics, not
Ticketry's domain parity.

## What the template explicitly does not prove

Its stability boundary says it has not established production behavior for
foreign-key relations, field hiding, authorization, lifecycle hooks, custom
model operations, custom GraphQL error mapping, production subscriptions, or
updater/signing integration
(`/Users/karthik/merge_conflicts/general/tauri-graphql-template/docs/stability-boundary.md`).
Those are not peripheral gaps for Ticketry:

- nearly all important data is relational;
- workflow and run mutations must hide raw storage writes;
- MCP has run-scoped authorization and termination;
- startup hooks reconcile tmux, worktrees, documents, and providers;
- status delivery needs cursor/snapshot/replay semantics; and
- desktop packaging already bundles native ghostty and a multicall sidecar.

The first migration phase must therefore prove these extensions in Ticketry's
real Tauri shell. Calling the template “bulletproof” is reasonable for its
tested CRUD/codegen/IPC boundary; it is not yet evidence for Ticketry's custom
application behavior.

## Deliberate Ticketry deviations

### Authored command services, generated query shape

Seaography-generated queries are valuable for catalogue reads, filtering, and
stable schema generation. Unrestricted generated mutations are unsafe for
`Issue`, `State`, `IssueTypeTransition`, `LaunchBinding`, `AgentRun`,
`GraphRun`, terminal sessions, and worktrees. Those records have invariants and
effects currently implemented in services, workflows, signals, and
reconciliation
([`../backend/worktracker/services/`](../backend/worktracker/services/),
[`../backend/apps/execution/`](../backend/apps/execution/),
[`../backend/apps/terminals/`](../backend/apps/terminals/)).

For those aggregates, expose authored GraphQL commands that call one application
service and return the updated entity/revision plus typed domain errors. Hide or
omit generated mutators. Record the exception in the generated-schema policy so
drift verification knows it is intentional.

### One application core, several adapters

GraphQL is appropriate for Studio, but it cannot replace MCP or all native
commands. The application core must be callable without a transport:

```text
interfaces/graphql ----\
interfaces/mcp ---------+--> feature application service --> repository/effect ports
interfaces/tauri -------/
```

This prevents the current MCP service from reimplementing workflow and scope
composition around an SDK
([`../surfaces/worktracker-agent/api/service.py`](../surfaces/worktracker-agent/api/service.py)).
It also lets native terminal commands call the same authorization and lifecycle
logic without routing through GraphQL.

### Durable subscription source

The template's bounded Tauri channel is transport plumbing, not an event log.
Ticketry needs a database-backed monotonic cursor/outbox. A subscription
registers, captures an authoritative snapshot boundary, replays durable events,
then streams live facts; lag closes with a resumable cursor or forces a new
snapshot. This preserves the current status protocol's correctness through a
new transport
([`../backend/apps/runs/consumers.py`](../backend/apps/runs/consumers.py),
[`../studio/src/features/agents/status/statusFeed.ts`](../studio/src/features/agents/status/statusFeed.ts)).

### SQLite as desktop target, explicit PostgreSQL policy

The template is SQLite-only. Ticketry's default is also isolated SQLite, but it
has an explicit opt-in PostgreSQL mode
([`../backend/studio_server/database.py`](../backend/studio_server/database.py),
[`../README.md`](../README.md)). The target should optimize for one
application-owned SQLite store. PostgreSQL needs a conscious compatibility or
import-source decision; it cannot be assumed from template coverage. See
[data-migration.md](data-migration.md).

### Development-only browser bridge

TauRPC is available only inside Tauri. Ticketry permits browser-only services as
supporting development tools, not as a second product ([`../AGENTS.md`](../AGENTS.md)).
If browser test/dev workflows remain necessary, build a thin development-only
GraphQL adapter over the same schema/application state. Do not keep the Django
REST server or make an HTTP server a production requirement.

## Proposed Rust source shape

Do not add backend logic to the existing 1,648-line `src-tauri/src/lib.rs` or
create another omnibus application crate. A practical starting structure is:

```text
studio/src-tauri/
  src/
    app/                       # Tauri composition and managed state
    db/                        # pool, schema classifier, migrations, snapshots
    interfaces/
      graphql/                 # schema and resolver modules
      mcp/                     # external MCP projection/listener
      tauri/                   # native-only commands
    features/
      work_management/
      launch_policy/
      events/
      runs/
      documents/
      worktrees/
      terminals/
      execution/
    native_terminal/           # current implementation retained
    tmux_viewer.rs              # retained, split when responsibilities demand
```

Each feature owns its domain rules, application commands/queries, repository
contract, persistence implementation, GraphQL projection, and focused tests.
Cross-feature behavior travels through narrow typed interfaces or durable facts,
not imports into another feature's database implementation. A small shared
transport crate copied from the template is reasonable; a crate per trivial
layer is not required. The root code-structure rules favor small,
single-purpose files and capability ownership
([`../CLAUDE.md`](../CLAUDE.md), [`../AGENTS.md`](../AGENTS.md)).

## Frontend contract and cache

Adopt the template's authored `.graphql` operations and generated
`TypedDocumentNode` clients. Define scalar mappings for UUIDs, timestamps,
JSON, paths, and fractional ranks before broad generation. Keep one naming
convention for IDs and errors.

Choose one server-state authority during each frontend slice. The recommended
path is to make Apollo the GraphQL entity/list authority for migrated features
and delete their React Query holdings at cutover. If React Query must remain
temporarily, use GraphQL as a typed fetch function and disable Apollo
normalization for that slice; do not let both caches independently merge the
same entity. Preserve identity/revision invalidation until returned mutation
payloads and subscriptions prove equivalent collection convergence.

## Composition proof required before domain migration

The foundation is ready only when a small Ticketry-owned model proves all of the
following in the actual shell:

1. existing native terminal/Tauri commands coexist with TauRPC GraphQL;
2. initialization failure is structured and does not leave partial state;
3. relations and foreign-key constraint errors are generated and mapped;
4. a generated mutator can be hidden and replaced by an authored command;
5. typed domain errors survive Rust -> GraphQL -> TypeScript;
6. a durable cursor subscription reconnects and recovers from lag;
7. Tauri restart reopens the existing app-data location safely; and
8. the generated drift check is deterministic on Ticketry's supported toolchain.

Until this proof passes, estimates for the later migration phases should carry
high uncertainty.
