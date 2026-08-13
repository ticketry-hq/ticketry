# Ticketry: Django/DRF to Rust, SeaORM, Tauri, and TauRPC

**Status:** implementation blueprint for a hard parallel rewrite

**Decision:** locked for the overnight rewrite, except where this document explicitly labels an item as an implementation-time verification or an open choice.

## 1. Executive decision record

Ticketry will be rewritten in a new, isolated worktree as a complete Rust-native desktop backend. The existing Django/DRF application remains untouched as a runnable behavioral oracle and rollback/reference application. It is not a service, fallback, compatibility proxy, or runtime dependency of the Rust application.

The target desktop runtime is:

```text
React + TanStack Query
        |
        | generated typed TauRPC client
        v
Tauri / TauRPC procedures and events
        |
        v
Ticketry controllers (application operations)
        |
        +---- SeaORM canonical persisted models + transaction helpers
        +---- local execution services (tmux, terminals, worktrees, documents, agents)
        |
        v
Existing compatible SQLite database

External MCP client
        |
        v
Rust MCP adapter ---> same controllers and model operations
```

The rewrite is one-shot in product intent: the Rust worktree must be capable of running the complete normal Ticketry experience with exact behavior parity. It is **not** an incremental dual-transport migration. The old and new applications can coexist as two independently runnable versions while the Rust version is evaluated; React in the Rust worktree talks only to TauRPC.

### Locked decisions

| Area | Decision |
| --- | --- |
| Scope | Whole-app parity, not a vertical slice or a partial feature rollout. |
| Isolation | Create a new worktree. Do not modify the Django worktree during the rewrite. |
| Django | Keep as behavioral reference, regression oracle, and rollback version only. Never start it from the Rust desktop runtime. |
| Data | Start from a consistent copy of an existing real SQLite database. Existing schema and stored data are the canonical compatibility contract. |
| ORM | Use **SeaORM** (not “CORM”) as the Rust object-relational mapper. Its persisted entities and relations are Ticketry’s canonical models. |
| Models | Do not introduce a second, duplicate “pure domain” entity graph. Transport contracts are transient; SeaORM models are trusted persisted truth. |
| Rules | Put workflow, hierarchy, ranking, revision, and deletion invariants in model-level, transaction-safe operations. Controllers coordinate; they do not reimplement policy. |
| Concurrency | The Rust runtime serializes SQLite write transactions through a single owned writer path with an explicit `busy_timeout` and bounded retry on `SQLITE_BUSY` at transaction start only. See §7.5. Controllers never assume multi-writer parallelism. |
| Desktop transport | TauRPC replaces REST, OpenAPI, generated HTTP SDK usage, and the normal desktop WebSocket server. |
| Frontend | Preserve React, routes, components, TanStack Query hooks, query keys, cache semantics, and optimistic-update behavior. Swap the client transport only. |
| Realtime | Typed Tauri/TauRPC events carry state notifications; snapshot procedures repair gaps. Ordered terminal bytes use a dedicated Tauri IPC channel. |
| MCP | Keep MCP as an external protocol. Its Rust adapter invokes shared controllers/model operations directly; it never proxies through TauRPC. |
| Prior Rust work | Treat it as untrusted reference material. Selectively reuse only code proven against this blueprint and parity tests. Do not carry forward GPUI or HTTP/OpenAPI/WebSocket adapters. |

### Definition of success

The Rust worktree passes the same normal-use flows as the Django/Tauri version against an equivalent copy of real data: work management, workflows, execution, terminals, worktrees, documents, settings, agents, realtime state, and MCP. It launches without a DRF server and its React UI makes no REST/WebSocket calls to the old backend.

## 2. The crucial architectural choice: a small Ticketry kernel, not DRF-in-Rust

The target is **not** a line-for-line Django/DRF clone, a new “Rust DRF,” or a Loco application with the same framework-shaped layers. It is a small reusable application kernel built around the already-proven persisted model schema.

DRF contains several valuable responsibilities: request parsing, serializer validation, error shaping, views, transactions, permission hooks, and rendering. Ticketry needs those *capabilities*, but they are not a reason to retain DRF’s architecture or to reproduce every framework abstraction.

### Capability mapping and recommendation

| Current Django/DRF capability | Rust/TauRPC counterpart | Recommendation |
| --- | --- | --- |
| Django model and relation definitions | SeaORM entities, relations, active models, migrations | Preserve schema behavior exactly; make these canonical Ticketry models. |
| `Model.clean()`, service checks, signal-triggered invariants | Model operation modules and controller-owned transactions | Centralize each rule once; never duplicate it in a TauRPC resolver or frontend hook. |
| DRF serializers | `#[taurpc::ipc_type]` input/view/error structures plus conversion helpers | Keep deliberately small. Validate wire shape and map types; no persistence or business policy. |
| DRF views/viewsets/router | TauRPC namespaces and thin procedure implementations | Keep model-shaped procedures; route to one controller operation. |
| DRF exception handling | A typed `AppError` taxonomy plus `AppErrorView` projection | One stable error projector for TauRPC and one MCP mapping. |
| `transaction.atomic()` | Explicit SeaORM transaction closure/guard | Transactions belong around model operations coordinated by a controller. |
| Django signals / Channels broadcast | Commit-aware event helper/outbox + typed Tauri events | Emit after commit; events are notifications, never the only record of truth. |
| OpenAPI and generated TypeScript HTTP client | TauRPC-generated TypeScript proxy and shared IPC types | Remove the HTTP contract generation path from the new runtime. |
| Django Channels WebSockets | TauRPC/Tauri event listeners, snapshot reads, terminal IPC channel | Do not recreate a general WebSocket server locally. |
| Django management commands / app startup | Tauri composition root and explicit Rust runtime services | One owned startup/recovery/shutdown lifecycle. |
| FastMCP adapter | Rust MCP adapter over the same controllers | Keep protocol-specific request/result mapping at the outer edge. |

### Why not clone/wipe-fork DRF?

- A framework clone preserves HTTP assumptions that do not exist in the desktop runtime: route ownership, request middleware, URL-based auth, serializers as a primary application layer, and a separate server process.
- It encourages rules to drift across “serializer validation,” “view validation,” and model/service code. The new target has one canonical model representation and one model-operation path.
- It makes the desktop API harder to evolve because React and the native backend live in the same application and can use generated IPC types directly.
- It would recreate the old transport before replacing it, adding risk without increasing parity.

### Why not adopt Loco as the architecture?

Loco is useful for a conventional HTTP application, but Ticketry’s target is a Tauri-hosted desktop runtime with TauRPC as its primary local boundary. Loco would make controllers, routing, migrations, and lifecycle look HTTP-first, then require an additional bridge back to Tauri. That is the wrong center of gravity. SeaORM may still be used directly, and small local conventions can supply the useful parts of a framework without inheriting an HTTP server architecture.

### Kernel contents

The kernel should be small, explicit, and reusable by both Tauri and MCP:

1. **Canonical model crate:** SeaORM entities, relations, relation-aware queries, active-model mutation helpers, model errors, and transaction-safe invariant operations.
2. **Controller crate:** named application operations that open/accept transactions, compose model operations and local effects, determine committed result views, and publish events after commit.
3. **View-contract crate:** TauRPC IPC inputs, views, event payloads, transport errors, conversion functions, validation helpers, and checked integer/string boundary codecs.
4. **Shared support modules:** transaction runner, application error taxonomy, field validation utilities, event publisher/outbox, clock/ID abstractions only where testing requires them, and local-effect/recovery interfaces.

The kernel is not a generic internal framework. It exists to make Ticketry’s own rules, data, and adapters consistent. Use Seaography's generated model CRUD as the baseline contract instead of rebuilding it, but avoid a hand-built “base controller,” generic CRUD engine, reflection-based model registry, or abstract repository layer that hides SeaORM without adding a real Ticketry boundary. When unrestricted generated CRUD would expose protected fields or bypass an invariant, the smallest acceptable deviation is one restricted model-shaped create/update/delete seam with a written reason and a drift-prevention test.

## 3. Canonical vocabulary and boundaries

Use these terms consistently in code, tests, and handoffs.

| Term | Meaning |
| --- | --- |
| **Canonical model** | A SeaORM persisted entity/relationship backed by the compatible SQLite schema. This is the trusted durable representation. |
| **Model-shaped write** | A create, update, or delete of one canonical model, including its mutable relationships, through an explicit writable-field allowlist. Internal invariant work does not make it a separate public operation. |
| **Model operation** | A transaction-safe function or method operating on canonical models that enforces an invariant or performs a meaningful mutation. |
| **Controller** | An application operation that coordinates model operations, transaction scope, external-effect planning, result projection, and event publication. |
| **View contract** | An IPC/MCP-facing input, output, event, or error type. It is transient and may not be used as a persistence entity. |
| **Resolver** | A TauRPC procedure implementation. It authenticates/normalizes the IPC call if needed, delegates once to a controller, and projects the result. |
| **Snapshot** | An authoritative query result used to establish or repair UI state. |
| **Notification event** | A committed-change signal that lets a client update/invalidate cache. It is not a durable source of state by itself. |
| **Terminal frame** | Ordered output bytes/frames on the dedicated terminal IPC stream. It is intentionally not a general application event. |
| **Parity** | The current observable Django application behavior against compatible data, including error behavior and lifecycle edge cases—not merely matching a written design. |

### Boundary rules

1. React imports generated TauRPC types/proxy and local UI adapters; it never imports Rust database concepts or makes a REST request in the desktop runtime.
2. TauRPC input/view structs carry wire shapes only. They do not query SeaORM, mutate models, execute commands, or decide workflow policy.
3. A resolver delegates to a named controller operation. It cannot contain a second implementation of workflow, hierarchy, rank, revision, or deletion rules.
4. Public model writes are create/update/delete shaped and allowlist caller-writable fields. Parent, blocker, classification, archive, and state requests use the WorkItem update contract; focused hierarchy, dependency, transition, and cascade helpers remain internal.
5. A custom public mutation is permitted only for behavior that cannot be represented as model CRUD. Its written exception names the missing generated/database behavior, the smallest custom seam, and its preventing test, and the mutation registry records the reason.
6. Controllers own use-case sequencing and transaction scope. They may call models and execution services; they may not encode a second schema or bypass model operations with ad hoc SQL.
7. SeaORM entities are the canonical stored model. They may be used in model and controller layers, but never serialized directly to React or MCP clients.
8. Persistence helpers own database opening, schema inspection, migrations/adoption checks, reusable query scopes, and transaction primitives. They do not own UI or TauRPC semantics and do not form a repository layer that mirrors SeaORM.
9. External local effects—tmux, PTY, Git, filesystem, agents, document watchers—never run while a SQLite write transaction is open.
10. An event is published only after its associated durable transaction commits. A failed transaction publishes nothing.
11. MCP and TauRPC both invoke controllers. Neither invokes the other.
12. The Tauri composition root is the only module that constructs concrete database, event, terminal, worktree, filesystem, and MCP runtime dependencies.

## 4. Target workspace and dependency layout

The initial workspace is deliberately shaped around Ticketry’s durable model and desktop runtime. Names can be adjusted before creation, but responsibilities and dependency direction are fixed.

```text
ticketry-rust-worktree/
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  crates/
    ticketry-model/                 SeaORM canonical entities, relations, operations
    ticketry-persistence-sqlite/    DB open/adoption/migrations/query and transaction support
    ticketry-execution/             tmux/PTYS, agents, Git/worktrees, docs, watchers
    ticketry-controller/            Ticketry application operations and event planning
    ticketry-view-contract/         TauRPC/MCP transport inputs, views, events, errors
    ticketry-mcp/                   external MCP adapter over controllers
    ticketry-parity/                test-only differential fixtures and scenario runner
  studio/
    src/                            Existing React UI, query hooks/keys preserved
    src-tauri/
      src/
        lib.rs                      Tauri composition root
        rpc/                        Thin TauRPC procedure namespaces
        events.rs                   Tauri event bridge
        terminal_channel.rs         ordered terminal stream bridge
        runtime.rs                  lifecycle/recovery wiring
        native_terminal.rs          retain/port existing Ghostty bridge as appropriate
        viewer_commands.rs          native terminal controls
  tests/
    architecture/
    schema/
    parity/
    integration/
    fixtures/
```

### Dependency direction

```text
ticketry-view-contract ──┐
                         v
ticketry-controller ─────┼──> ticketry-model <── ticketry-persistence-sqlite
                         |             ^
                         v             |
                  ticketry-execution ──┘

ticketry-mcp --------------------> ticketry-controller + ticketry-view-contract
studio/src-tauri/src/rpc --------> ticketry-controller + ticketry-view-contract
studio/src-tauri/src/lib.rs ------> all concrete runtime crates (composition only)
ticketry-parity (test-only) ------> public controllers/contracts plus reference harness
```

This is not a purity diagram. `ticketry-model` intentionally knows SeaORM because the persisted representation is canonical. The non-negotiable distinction is **model versus transport contract**, not ORM versus domain entity.

### Per-crate responsibility

| Crate | Owns | Must not own |
| --- | --- | --- |
| `ticketry-model` | SeaORM entity definitions, relations, schema-aligned enums/codecs, model operation modules, model errors, rank/workflow/hierarchy/revision logic coupled to persisted facts | TauRPC types, React views, Tauri APIs, MCP transport, terminal I/O |
| `ticketry-persistence-sqlite` | database configuration, connection ownership, compatible schema inspection, adoption ledger, migration execution, SQLite transaction/query helpers | business-policy copies, UI event names, external processes |
| `ticketry-execution` | effect plans and drivers for terminal/tmux, agents, worktrees/Git, documents/filesystem, watcher reconciliation | direct TauRPC/MCP calls, workflow validation duplicates |
| `ticketry-controller` | named use cases, transaction orchestration, post-commit effects/events, view-independent result structs | raw IPC serialization, direct UI cache operations, duplicate model rules |
| `ticketry-view-contract` | stable input/view/error/event structures, conversion/projection, wire validation and numeric representation rules | SeaORM queries, transactions, process/filesystem operations |
| `ticketry-mcp` | MCP tool registry and request/result translation | separate Ticketry business logic or TauRPC forwarding |
| Tauri `rpc/` | TauRPC namespace registrations and one-hop resolver methods | SeaORM queries, direct terminal implementation, business decisions |

## 5. Mapping current Django artifacts to their Rust roles

The following is a migration map, not an instruction to mechanically translate files. The behavior in these locations remains the primary oracle until parity evidence proves the replacement.

| Current area | Rust destination | Parity obligation |
| --- | --- | --- |
| `backend/worktracker/models` | `ticketry-model` canonical SeaORM entities/relations | all schema fields, FK behavior, uniqueness, defaults, ordering, and derived key behavior |
| `backend/worktracker/services/*` | model operations plus controller operations | workflow, state impact, rank, sequence, hierarchy, blocks, lifecycle, attachments, configuration semantics |
| `backend/worktracker/rest/*`, `apps/*/api.py` | TauRPC namespace procedures + contract projections | every supported read/write operation has an equivalent typed procedure and matching error/result semantics |
| DRF serializers / OpenAPI models | `ticketry-view-contract` IPC structures | camel/snake naming choice must be centralized; preserve frontend semantics, not ORM serialization accidents |
| Django transactions | SeaORM transaction scopes in controllers/model operations | all-or-nothing durable state and exact conflict behavior |
| Django signals and `apps.runs.bus` | post-commit application event publisher | no event before committed data; state/agent/document semantics retained |
| `apps/runs` | run/attempt canonical entities and controllers | run lifecycle, retries, automation attempts, status projections |
| `apps/execution` | graph/execution models/controllers and execution driver | dependency graph readiness, launch/retry/termination, recovery |
| `apps/terminals` and Channels consumer | execution terminal service, native terminal adapter, terminal IPC channel | tmux durability, viewer leases, input/resize/attach/detach, stream ordering/backpressure |
| `apps/worktrees` | execution worktree/Git service | ownership derivation, create/status/integrate/discard behavior |
| `apps/documents` | execution document registry/file service | scope, roots, discovery/watch, read/write/open behavior |
| `apps/settings_store` | canonical settings persistence/model operations | settings values, provider catalog/default behavior, scope rules |
| `surfaces/worktracker-agent` FastMCP | `ticketry-mcp` | external tool names, input/output/error behavior unless a deliberate external contract decision is recorded |
| TypeScript OpenAPI SDK client | generated TauRPC proxy plus a compatibility-shaped frontend API façade | existing React hooks retain their public shape and query keys |
| `studio/src-tauri` sidecar supervisor | in-process Rust composition/runtime | no Python sidecar startup; preserve lifecycle, data ownership, terminal renderer requirements |

## 6. Data, schema, and SeaORM adoption strategy

### 6.1 Canonical schema policy

The existing SQLite schema is not a draft. Treat it as an external compatibility contract with real user data behind it.

- Preserve table names, columns, nullability, defaults, indexes, foreign keys, check constraints, unique constraints, trigger behavior, enum encodings, timestamp formats, ID encodings, and persisted JSON/text formats unless a parity-tested migration explicitly changes them.
- Do not generate a fresh “Rust schema” and import data into it for the first viable version.
- Do not switch identifier format, ranking encoding, date/time representation, or revision type merely because Rust makes a different representation convenient.
- Do not delete unused Django tables in the rewrite. They may be retained inertly until an explicit post-cutover data migration decision.
- SeaORM entity generation/manual definitions must match the database exactly. Use explicit conversion types for legacy SQLite representations rather than silently coercing them.

### 6.2 Safe database copy protocol

“Copy the SQLite database” means a consistent snapshot, not a blind copy of one file while a writer is active.

1. Identify the active database and its SQLite journal mode.
2. Create the reference fixture with SQLite’s online backup capability, or stop/quiesce the source application and copy the database plus any required WAL/SHM state atomically.
3. Record source schema version, table/index/trigger manifest, foreign-key check output, integrity check output, row counts, and content digests for durable tables.
4. Open the copied database read-only first. Run schema classification before any Rust migration or write.
5. Preserve an immutable pristine copy. Run Rust tests and experiments against disposable working copies.
6. Never point an unproven overnight implementation at the only live application database.

### 6.3 SeaORM model implementation

- Generate or hand-maintain entities from the copied schema, then check them against a committed schema manifest.
- Represent legacy primary keys, nullable relations, timestamps, JSON fields, and enum text values with explicit codecs and tests. Avoid an unchecked `String`/`i64` conversion scattered through controllers.
- Provide relation helpers and query scopes close to entities: project ownership, issue ancestry, module membership, workflow graph, blocker graph, agent/run ownership, terminal/session lookup, worktree ownership, and document scope.
- Use `ActiveModel` updates only through named model operations when a rule-bearing field changes. Read-only query code may use entities/query builders directly.
- Preserve current database-level referential behavior. A Rust pre-check may improve error clarity, but it may not weaken or replace the database constraint.

### 6.4 Migrations after adoption

For the rewrite’s first viable run, migrations are **adoption and verification**, not schema redesign:

1. recognize approved existing database shapes;
2. reject unknown or inconsistent shapes before mutation;
3. install an immutable baseline record only when it exactly describes the copied schema;
4. create any new Rust-only bookkeeping table only if it is essential and does not modify canonical user model semantics;
5. apply future Rust migrations only after a separate compatibility decision and reversible test evidence.

If SeaORM requires a migration-history table, treat it as runtime metadata, not proof that the historical Django migrations were replayed. The migration tool must be able to adopt the current schema without recreating it.

### 6.5 Numeric and revision compatibility

TauRPC currently requires careful treatment of wide Rust integers in TypeScript. The contract rules are:

- values guaranteed within JavaScript’s safe integer range may be exposed as `number` only after checked conversion;
- `u64` revisions, cursors, sequence values, or IDs that can exceed that range use a decimal string wire representation, parsed and range-checked at the boundary;
- SQLite `INTEGER` remains SQLite-compatible; never silently truncate to fit TypeScript;
- optimistic concurrency errors include the relevant current revision/view so the UI can recover predictably.

## 7. Model operations, controllers, and transaction rules

### 7.1 Where every rule belongs

| Rule family | Owner | Controller role |
| --- | --- | --- |
| workflow start state, allowed transitions, protected-state rules, workflow revision | state/type/transition model operations | select operation, open transaction, return projected impact/result |
| issue/module/subtask ancestry, module derivation, cross-project restrictions, cycle rejection | work-item model operations | coordinate mutations that affect several rows |
| blocker graph and cycle prevention | work-item/blocker operation | choose transaction/isolation and publish committed change |
| fractional ranking and reorder neighbor validation | work-item ranking operation | load ordered scope, apply atomic update, publish membership/change event |
| project sequence allocation and key derivation | project/work-item operation | own the allocation transaction and retry/return conflict as parity requires |
| optimistic revision checks | the mutated model operation | translate mismatch to `Conflict` transport error |
| deletion restrictions/cascades | model operation plus database constraint | preflight view if needed, execute one mutation boundary |
| launch defaults, provider capability validation, execution eligibility | settings/launch/execution operations | initiate external effect only after durable plan commits |

### 7.2 Transaction pattern

Each command follows this sequence:

1. Parse and structurally validate the transport input.
2. Controller starts a SeaORM transaction.
3. Controller loads canonical models/query scopes needed by the operation.
4. Model operations enforce invariants and persist all durable changes.
5. Controller writes any durable operation/outbox records needed for later external effects.
6. Transaction commits.
7. Controller projects the committed result and publishes typed events.
8. Controller runs or schedules external effects, then records/reconciles their outcome according to current behavior.

No terminal spawn, tmux command, Git mutation, document write, watcher callback, IPC emit, or MCP reply-side effect may occur inside a database write transaction. If the current behavior needs a durable effect before returning, record an idempotent intent during the transaction and execute/reconcile it after commit.

### 7.3 Standard controller shape

```rust
pub async fn update_work_item(
    app: &TicketryServices,
    command: UpdateWorkItemCommand,
) -> Result<WorkItemResult, AppError> {
    let committed = app.db.transaction(|txn| async move {
        let item = work_item_ops::load_for_update(txn, command.work_item_id).await?;
        let changed = item.apply_update(txn, command).await?; // checks revision/invariants
        event_outbox::record(txn, changed.event()).await?;
        Ok(changed)
    }).await?;

    app.events.publish_committed(&committed.event).await;
    Ok(committed.into_result())
}
```

The exact SeaORM transaction API may differ; the shape is normative. A resolver maps `UpdateWorkItemInput` to `UpdateWorkItemCommand`, calls this controller, and maps `WorkItemResult` to `WorkItemView`.

### 7.4 Error taxonomy

Use a single internal error taxonomy, projected separately for TauRPC and MCP. Suggested stable categories:

- `NotFound` — requested canonical object/scope does not exist.
- `Validation` — malformed input or a rule the caller can correct.
- `Conflict` — stale revision, uniqueness race, occupied lease, or concurrent state change.
- `Forbidden` — caller/scope is not authorized where the existing behavior has an authorization boundary.
- `Precondition` — valid request but required runtime state is absent, such as a missing worktree or terminal session.
- `Unavailable` — local executable/service/stream unavailable or busy.
- `Internal` — unexpected failure, with safe public message and structured local diagnostic context.

Do not make frontend components interpret raw SQLite, SeaORM, serde, or process errors. Map database constraint errors at the controller/model boundary to the parity-appropriate category.

### 7.5 Concurrency and write-contention policy

Django mediated every write through one server process with per-request isolation and a single well-understood SQLite locking profile. The Rust runtime is in-process and multi-tasked: webview TauRPC calls, the MCP server, document watchers, and execution reconciliation can all reach the database concurrently. This difference cannot be discovered by sequential differential tests, so the policy is locked rather than left to implementation taste:

- One component owns the SQLite connection(s). All write transactions are serialized through a single writer path — a dedicated writer task or an async mutex around the transaction runner — regardless of which adapter (TauRPC, MCP, watcher, recovery) initiated the operation.
- Set an explicit `busy_timeout`. Apply a bounded, jittered retry on `SQLITE_BUSY` only when beginning a transaction, never mid-transaction; a mid-transaction busy/locked failure aborts and surfaces as the parity-appropriate error.
- Read-only queries and snapshots may run concurrently where the journal mode permits, but no transaction — read or write — may be held across an await that waits on an external effect (rule 7 in §3 applies to reads too).
- `SQLITE_BUSY` handling is infrastructure and must never masquerade as an application `Conflict`. Optimistic revision checks remain the only application-level concurrency mechanism the UI sees.
- The differential parity suite must run at least one scenario per rule family concurrently (e.g., MCP mutation racing a TauRPC mutation) to exercise this policy, not only sequentially.

## 8. TauRPC contract conventions

TauRPC is the desktop transport and TypeScript-generation mechanism. It is not the place to put application services.

### 8.1 Namespace design

Keep the frontend’s existing model-shaped mental model. Each namespace is a coherent capability, not a mirror of an HTTP path.

```text
workspace
projects
states
issue_types
workflows
work_items
attachments
settings
providers
models
reasoning_levels
launch_bindings
runs
execution
terminals
worktrees
documents
system
events
```

The overnight implementation must derive exact procedures from the current public API/SDK inventory and frontend callers. It must not omit a capability merely because the initial React screen does not exercise it.

### 8.2 Procedure naming and contracts

- Use verbs that express the existing behavior: `read`, `list`, `create`, `update`, `delete`, `reorder`, `transition`, `preview_impact`, `launch`, `retry`, `attach`, `resize`, `terminate`, `open`, `save`, `integrate`, `discard`.
- Inputs are explicit structs, not positional parameter lists or exposed ActiveModels.
- Views are explicit structs. They may combine fields from multiple canonical models when that is the current client contract.
- Mutations that update a mutable record include an expected revision when the current behavior uses/needs optimistic concurrency.
- List operations return explicit page/list envelope types if the current frontend expects metadata, filters, totals, or cursors.
- Destructive operations return a receipt or current impact representation rather than a bare boolean when that is needed for existing UI behavior.
- Contract type names use Ticketry language, never framework language: `UpdateWorkItemInput`, `WorkItemView`, `WorkflowImpactView`, `TerminalAttachView`.

Example:

```rust
#[taurpc::ipc_type]
pub struct UpdateWorkItemInput {
    pub work_item_id: WorkItemIdWire,
    pub name: Option<String>,
    pub description: Option<String>,
    pub expected_revision: RevisionWire,
}

#[taurpc::ipc_type]
pub struct WorkItemView {
    pub id: WorkItemIdWire,
    pub key: String,
    pub name: String,
    pub state_id: Option<StateIdWire>,
    pub revision: RevisionWire,
}
```

The field spelling convention must be selected once based on generated client ergonomics and existing TypeScript usage. The client-facing façade may preserve current camelCase independently of Rust field spelling; do not force a broad React component rewrite.

### 8.3 Resolver rules

Every resolver is mechanically reviewable:

1. receive generated input;
2. validate transport-level constraints (required/nonempty/range/format, safe numeric conversion);
3. convert to a controller command;
4. invoke exactly one named controller operation;
5. project a result/error to a contract type.

Resolvers must not open ad hoc database connections, make SeaORM queries, execute terminal/Git commands, spawn agents, or publish a different event family.

### 8.4 Contract generation and version discipline

- Pin a compatible TauRPC/Tauri version in the Rust workspace and lockfile before generating application contracts.
- Check generated TypeScript output into the appropriate build-generated location only if the project’s chosen TauRPC workflow requires it; otherwise generate deterministically during typecheck/build. Do not hand-edit generated proxy code.
- Add a CI/local contract check that fails if Rust contract changes are not reflected in TypeScript typechecking.
- Replace current OpenAPI export and TypeScript SDK generation steps only in the Rust worktree. Keep them untouched in the Django reference worktree.
- Browser-only development is not a full runtime mode because it cannot invoke Tauri IPC. Provide a deliberate mock adapter for UI-only testing, not a hidden HTTP backdoor.

## 9. Replacing WebSockets: events, snapshots, and terminal channels

### 9.1 What changes

The normal Rust desktop runtime does not start Django Channels or a WebSocket server. The current status feed becomes typed Tauri/TauRPC events. React subscribes through the generated event API rather than constructing a socket URL.

### 9.2 Reliability model

Events are best-effort notifications for a currently connected local webview. The authoritative state remains SQLite and controller read procedures.

For each event family:

1. Subscribe/attach to the event listener.
2. Fetch a scope snapshot immediately after listener registration, or use a subscription handshake that returns snapshot plus cursor.
3. Maintain a monotonic project/event cursor where the current behavior already does so.
4. On reconnect, window focus/resume, cursor gap, event decode failure, listener loss, or any ambiguity, call the relevant snapshot procedure and reconcile TanStack Query/Zustand state.
5. Events emitted for a different active project/scope must be ignored as today.

This preserves the existing principle that a stale client can always recover from persisted truth. It also addresses a current limitation noted in the context map: non-state edits and deletions must have an explicit invalidation/snapshot path, not depend on a state-move event.

### 9.3 Typed event families

Define a small stable event envelope and specific payloads. Initial families should cover all current status feed responsibilities:

| Event | Payload minimum | React action |
| --- | --- | --- |
| `work_item.changed` | project ID, work item ID, revision/cursor, change kind, membership flag | invalidate detail; invalidate task membership/tree when needed |
| `work_item.deleted` | project ID, item ID, cursor, parent/module impact | remove/invalidate detail and affected lists/tree |
| `workflow.state_changed` | project ID, state view, workflow/catalog revision | update state catalog and workflow queries |
| `workflow.changed` | project/type ID, workflow revision, impact kind | invalidate workflow scopes/impact views |
| `agent.lifecycle_changed` | run view and scope | update agent status store and run queries |
| `automation_attempt.changed` | attempt view and project | update attempts/status UI |
| `terminal.session_changed` | run/session ID, lifecycle state, timestamp | update terminal lifecycle presentation |
| `document.changed` | owner/scope IDs, document view, created/updated/deleted | update/invalidate document registry and open tabs |
| `worktree.changed` | task/worktree IDs, status | invalidate worktree status |
| `settings.changed` / `provider_catalog.changed` | affected scope/revision | invalidate configuration/provider queries |
| `runtime.recovered` | runtime generation/affected scopes | force snapshots for active screens |

Use committed canonical identifiers and views, not frontend-only inferred state. If an event payload grows too large, send the minimal invalidation information and let the UI fetch the snapshot.

### 9.4 Event publication mechanics

- A controller records a durable event/outbox fact in the same transaction when reliable recovery/order is required.
- After commit, the event bridge projects and emits the typed event.
- Event delivery failure must not roll back committed user work.
- On runtime startup, reconcile durable state and publish a recovery/reconciliation signal; do not replay unbounded old event history into the UI.
- For simple local-only notifications where current parity does not require durable replay, a post-commit in-memory publisher is sufficient. Document which class each event belongs to.

### 9.5 Terminal output is intentionally different

Terminal output can be high-volume, ordered, binary-ish, and subject to backpressure. It must not travel through the application event/outbox path or TanStack Query.

Use a dedicated ordered Tauri IPC channel per terminal viewer/attachment:

- TauRPC procedures: `terminals.create`, `attach`, `input`, `resize`, `detach`, `terminate`, `resume`, `release_viewer_lease`, and status reads.
- Channel payload: session/viewer identity, monotonically increasing frame sequence, output bytes/text encoding, lifecycle/end/error markers.
- Client: existing terminal client abstraction consumes the channel and writes to xterm/native renderer. Preserve its foreground ownership and viewer-lease rules.
- Backpressure: bounded channel queues; an overwhelmed viewer may detach/recover without stalling tmux, controller operations, or database writes.
- Recovery: attach/resume asks the terminal service for current session state and any supported scrollback/replay, then continues at a known sequence. tmux remains the durable session owner.

## 10. React and TanStack Query migration

The desired frontend shape is preserved. React does not need to become a Rust-aware application.

### 10.1 Preserve as compatibility contracts

- `queryKeys` hierarchy and all existing key semantics;
- existing query/mutation hook names and public parameters where practical;
- cache update and invalidation rules;
- optimistic updates, rollback, retry, and mutation-in-flight protections;
- status store, terminal foreground store, workflow editor store, document tab state, and route/component ownership;
- acceptance tests for visible Studio behavior.

The current `queryKeys` registry already provides a strong migration seam. Keep it central and make the new event adapter use it rather than inventing cache invalidation keys in each listener.

**The hidden contract surface is larger than the hook signatures.** The OpenAPI SDK's concrete error shapes, pagination/list envelopes, field-absence-versus-null behavior, and other serialization accidents are almost certainly load-bearing in React code even where they were never intentional. Before replacing the transport, inventory what the frontend actually consumes from SDK responses and errors (not just what the OpenAPI schema declares). The façade must reproduce each observed dependency or explicitly adapt it, with every adaptation recorded — "swap the transport only" is the goal, but each place it erodes into frontend surgery must be a visible, listed decision rather than a silent drive-by edit.

### 10.2 Replace the transport beneath hooks

Create one frontend Ticketry client façade that wraps the generated TauRPC proxy. Each existing query function/mutation invokes the matching façade method; no component imports TauRPC directly unless it is a deliberately low-level terminal/event adapter.

```ts
// The hook shape stays recognizable.
useMutation({
  mutationFn: (input: UpdateWorkItemInput) => ticketryClient.workItems.update(input),
  onMutate: optimisticWorkItemUpdate,
  onError: rollbackOptimisticUpdate,
  onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.workItems.detail(id) }),
});
```

The façade is the right place for generated-type adaptation and `AppErrorView` normalization. It is not a second business layer.

### 10.3 Event-to-cache adapter

Port `statusFeed` into a typed event subscription module while retaining its useful protections:

- scope every handler to the active project/workspace;
- batch short bursts of work-item invalidations;
- do not overwrite an optimistic mutation with a stale event/refetch;
- update small catalog payloads in place when safe;
- invalidate lists/tree membership after hierarchy/reorder/delete changes;
- snapshot after attach/recovery/gap rather than assuming event completeness;
- retain terminal-specific state outside query cache.

### 10.4 Development and tests

- Tauri desktop development is the authoritative full-stack mode.
- Browser Vite mode may use an explicit mock transport with fixture data for component work. It must never silently start/use Django/DRF.
- Unit tests inject a fake Ticketry client façade; they do not depend on a running IPC host.
- Contract/integration tests run the real Tauri/TauRPC host and typecheck generated clients.

## 11. MCP design

MCP remains necessary because external agents cannot call a Tauri IPC endpoint. It is a protocol adapter around the same Ticketry kernel.

```text
MCP request -> MCP schema/auth adapter -> controller -> model operations / execution
                                             |
                                      shared AppError/result
                                             v
MCP response
```

Rules:

- Maintain the current tool inventory and semantics until an external MCP contract change is explicitly approved.
- Tool input/output schemas are MCP-specific contracts; they may be shaped differently from TauRPC views but map into the same controller commands/results.
- Do not call TauRPC from MCP, do not start a webview to use it, and do not duplicate rule logic in tool handlers.
- Preserve required authentication/identity semantics for external callers even though desktop TauRPC is local IPC.
- The Tauri composition root may host/manage the MCP server lifecycle if that matches the installed product, but it must remain externally reachable through its supported MCP transport rather than becoming a TauRPC feature.
- Add direct controller-versus-MCP parity tests for every tool that mutates or reads canonical Ticketry state.

## 12. Legacy Rust reuse: evidence first

The previous `ticketry-rust` work contains useful evidence of exploration, but it has not earned trust as a direct dependency or bulk-copy source. Its workspace currently includes domain/application/SQLite/local/MCP/runtime/parity concepts, plus an HTTP and WebSocket adapter and a GPUI frontend. That is informative, not proof of correctness.

### Explicit rejection list

- GPUI frontend and its application shell;
- Axum HTTP/OpenAPI routing and generated HTTP SDK assumptions;
- WebSocket status and terminal transport adapters;
- any Loco/HTTP-first architecture proposed by earlier design documents;
- any fresh-schema assumptions that conflict with the current copied SQLite database;
- any “pure domain” object graph that duplicates canonical SeaORM entities;
- tests that assert only legacy Rust code agrees with itself.

### Candidates for selective reuse

| Candidate | Reuse condition |
| --- | --- |
| schema inventory/adoption classifier | it validates the actual current Ticketry database and preserves it byte/semantically as required |
| parity fixture/scenario harness | it can run the Django oracle and new TauRPC/controller seam on equivalent copied databases |
| rank, graph, workflow algorithms | property tests and differential tests match Django behavior including edge cases |
| local execution abstractions | exercise real tmux/worktree/document/agent flows in the Tauri runtime without HTTP coupling |
| MCP mapping concepts | preserve current external tool behavior while calling shared controllers directly |
| architecture dependency tests | updated to enforce the new SeaORM/TauRPC layout rather than prior “pure domain” rules |

### Reuse gate for each candidate

Before copying or depending on a legacy module, record:

1. source location and responsibility;
2. dependency audit (no GPUI/HTTP/WS/Loco leakage into the new layer);
3. current-schema compatibility result;
4. behavior scenario(s) it implements;
5. differential test result against Django;
6. ownership destination in the new workspace;
7. reason for accepting, adapting, or rejecting it.

No module passes solely because it compiles or has pre-existing tests.

## 13. Exhaustive parity inventory and acceptance criteria

Parity means every current supported capability is represented by a testable inventory entry. Build the inventory from four sources: Django routes/services/models, generated TypeScript SDK, MCP tool registry, and actual React call sites/acceptance tests. The initial inventory must include at least the following domains.

| Capability area | Required parity evidence |
| --- | --- |
| application lifecycle | app opens, owns one runtime/data directory, recovers/shuts down cleanly, no Python sidecar/DRF listener |
| workspace/project catalog | read/create/update/list behavior, slugs/keys, onboarding/configuration behavior |
| states and issue types | groups, ordering, protection, starts, revisions, deletion impact/errors |
| workflows | transition configuration, permissions/automation flags, impact previews, concurrency, workflow revisions |
| work items | create/read/list/detail/update/delete/archive, derived key, project scoping, state changes, descriptions |
| hierarchy/modules | root/module/task membership, parent changes, module derivation, descendant impacts, cycle rejection |
| ordering/ranking | reorder within every supported scope, boundary cases, stable list order, rank allocation/rebalancing if current behavior uses it |
| blocker graph | create/remove/list both directions, cycle prevention, deletion effects |
| attachments | upload/list/read/delete/storage path behavior and errors where currently supported |
| settings/configuration | scoped settings, provider catalog, models, reasoning levels, defaults and validations |
| launch bindings | all current binding/default/auto-start/subtree semantics if the live product exposes them |
| agent runs | creation, state/status projection, resume/retry/error/exit lifecycle, persistence/recovery |
| automation/execution | graph execution, readiness/dependencies, idempotency, retry attempts, durable outcomes |
| terminals | create/attach/input/resize/detach/terminate/resume, tmux ownership, viewer lease, output ordering/loss/recovery |
| worktrees/Git | status/create/integrate/discard, ownership and branch/base metadata, safe path handling |
| documents | list/open/save/discover/watch, scratch/task scope, root authorization, tab/event behavior |
| realtime | snapshots, all event families, cursor/gap recovery, no stale UI after non-state edits/deletes |
| MCP | complete tool registry, schemas, auth where applicable, output/error semantics, direct controller path |
| frontend | existing query keys/hooks/cache updates, major routes, optimistic mutation safety, Studio acceptance suite |
| packaging/operations | dev, desktop, installed build, logs, data ownership, no Django runtime process |

### Hard acceptance gates

The overnight run is not complete unless all gates below pass or report a concrete blocking defect with an owner and reproduction.

1. **Architecture gate:** no production Rust desktop path imports Django/Python, GPUI, HTTP/OpenAPI/WS adapters, or a duplicate persistent domain model.
2. **Schema gate:** a copied real database opens; integrity, foreign-key, schema manifest, row-count, and selected content-digest checks pass before and after Rust operations.
3. **Transport gate:** desktop React uses generated TauRPC proxy/facade only; no REST base URL, OpenAPI SDK runtime import, or status WebSocket creation remains in the Rust worktree.
4. **Controller gate:** every mutating resolver/tool maps to a named controller; architecture tests reject SeaORM query/mutation use from `rpc/` and MCP tool files.
5. **Model-rule gate:** workflow, hierarchy, rank, revision, and deletion test matrices run through model/controller operations and match Django outcomes.
6. **Realtime gate:** every event has a snapshot recovery path; tests cover reconnect/gap/deletion/non-state edit; terminal stream tests cover order and bounded-client failure.
7. **Execution gate:** real safe test fixtures prove terminal, worktree, document, agent/run and recovery loops—not only mocked calls.
8. **MCP gate:** all supported external tools work against the Rust runtime without calling TauRPC.
9. **Frontend gate:** TypeScript typecheck, unit suite, current Studio acceptance suite, and desktop smoke tests pass with TauRPC.
10. **Operational gate:** installed/dev launch proves no DRF server is started and no local Python backend is needed for normal desktop use.

## 14. Test strategy

### 14.1 Test layers

| Layer | Focus | Example |
| --- | --- | --- |
| model unit/property | ranking, ancestry, transition and revision rules | random valid/invalid rank neighbors; cycle inputs; stale revision |
| SQLite integration | exact SeaORM mapping/relations/constraints | copied DB open, FK/delete behavior, timestamp/JSON codecs |
| controller integration | transaction, result/error, outbox/effect planning | transition commits state + attempt record or leaves neither |
| TauRPC contract | generated types/procedure projection | malformed input, error mapping, checked revision strings |
| event/channel | commit order, reconnect/snapshot, stream ordering/backpressure | mutation then event; dropped listener triggers snapshot repair |
| MCP adapter | tool registry/contracts and direct-controller route | same controller scenario through MCP schema |
| frontend | hooks/query keys/optimism/event cache routing | non-state edit invalidates detail; delete removes tree membership |
| desktop E2E | real Tauri/UI/runtime behaviors | create/move/reorder/run/attach terminal/save doc/worktree flow |
| differential parity | Django versus Rust on equivalent DB copies | request/controller scenario produces same durable and observable result |

### 14.2 Differential parity harness

For each scenario:

1. start from the same pristine copied database fixture;
2. run the scenario through Django’s public behavior/reference service;
3. run the equivalent scenario through Rust controller/TauRPC/MCP seam as appropriate;
4. compare durable rows, relevant filesystem effects, result/error category and meaningful fields, emitted status semantics, and read-back views;
5. reject unexplained differences.

If an observed Django behavior seems wrong, do not silently “fix” it. Record it as a candidate correction, obtain an explicit decision, and keep it out of the overnight parity target unless approved.

### 14.3 Architecture tests

Add cheap, deterministic checks that inspect Cargo dependencies/source imports:

- `ticketry-view-contract` has no SeaORM database query/migration dependency;
- TauRPC resolver files do not import SeaORM entity/query APIs except contract ID conversion types if unavoidable;
- MCP crate does not depend on the Tauri RPC crate;
- GPUI, Axum, OpenAPI generator, WebSocket server, Django/Python sidecar modules are absent from normal desktop runtime dependencies;
- frontend desktop client has no legacy HTTP SDK runtime import or `new WebSocket` for status/terminal paths;
- terminal output bridge is separated from general event emission;
- controller/model mutation code has tested transaction wrappers.

## 15. Overnight execution plan

This plan is sequenced for a high-autonomy implementation run but includes stop conditions to prevent false completion.

**Checkpoint discipline.** Because the product intent is one-shot but the run may halt at any point, every phase must leave a durable, independently verifiable artifact: a proven harness, an adopted schema, a green model-parity suite. Two consequences are binding: (1) the riskiest and most load-bearing work — the parity harness and the least-proven stack elements — is front-loaded so a failure surfaces in the first hours, not the last; (2) if the run halts, the handoff report names the last fully green phase and the exact failing scenario, and claims nothing beyond it. A partially complete run whose completed phases are all verifiably green is a valid checkpoint for the next run to resume from; a run that raced ahead of its evidence is not.

### Phase 0 — Create safe rewrite ground

- Create a dedicated Rust rewrite worktree from the chosen Ticketry baseline.
- Do not change the Django reference worktree.
- Record exact source revision, data fixture provenance, and current behavior/test baseline.
- Make a consistent copied SQLite fixture and immutable manifest.
- Read repository instructions and inventory current application surfaces before edits.
- Build and prove the differential parity harness against the Django oracle **alone**: fixture reset, scenario runner, durable-row/result/error normalization, and diffing. Running the same scenario twice against Django on identical fixture copies must diff clean before any Rust behavior work begins. The harness is the load-bearing verification mechanism for the whole rewrite; it must not be trusted for Django-versus-Rust comparison until it has proven itself on Django-versus-Django.

**Exit:** clean isolated worktree, reproducible fixture, source behavior baseline captured, parity harness green on Django-versus-Django.

### Phase 1 — Establish the kernel skeleton and guardrails

- Create the Rust workspace and crate boundaries in this document.
- Add pinned Tauri, TauRPC, SeaORM, Tokio, serialization, MCP, terminal/PTy, watcher, and test dependencies only after version compatibility is checked.
- Add architecture tests before filling implementation.
- Wire `studio/src-tauri/src/lib.rs` as the only composition root; remove normal-sidecar startup from this worktree without breaking the native terminal renderer contract.
- **De-risk spike (mandatory, before any CRUD porting):** prove the least-proven stack elements end to end on the pinned versions — (a) a TauRPC procedure round trip webview → resolver → controller → SeaORM read against the copied database, with TypeScript generation feeding the frontend typecheck; (b) typed Tauri/TauRPC event emission received by a React listener; (c) a dedicated ordered Tauri channel streaming sustained high-volume bytes to the terminal renderer path without stalling the runtime. TauRPC is the least battle-tested dependency in the stack; if any spike fails on the pinned versions, that is a Phase 1 blocker to report immediately, not a problem to discover in Phase 5. Spike code enters the real implementation only through the normal review/reuse standards.

**Exit:** Rust/Tauri app builds; dependency checks show the intended direction; no DRF process is needed to launch the shell; all three spike proofs pass on pinned versions.

### Phase 2 — Adopt and verify the existing SQLite database

- Implement connection ownership, schema classifier, baseline/adoption ledger, SeaORM entities/relations, and codec tests.
- Compare entity metadata and read projections against the copied database.
- Implement read-only snapshots for workspace/project/work item/workflow/run/runtime state first so the UI can interrogate real data.

**Exit:** copied database is read and projected by Rust without mutation or schema drift.

### Phase 3 — Implement canonical model operations

- Port/model each invariant family in a parity-first order: catalog/workflow; work items/hierarchy/ranking/blockers; configuration; then execution-linked model state.
- Add transaction tests and direct Django differential scenarios as each operation is implemented.
- Preserve database constraints as final authority.

**Exit:** core durable mutations pass model/controller parity suite.

### Phase 4 — Controllers, contracts, and TauRPC namespaces

- Add controller operations for every inventory capability.
- Define TauRPC IPC inputs/views/errors/events, generated proxy, and thin resolver namespaces.
- Replace TypeScript API client implementation underneath existing hooks; preserve query keys and hook behavior.
- Remove or isolate legacy OpenAPI SDK/HTTP client calls from the Rust worktree’s runtime path.

**Exit:** React reads/mutates core Ticketry data through TauRPC only; typecheck and core UI tests pass.

### Phase 5 — Realtime and terminal transport

- Replace status socket implementation with typed event listeners plus snapshots/cursor recovery.
- Port cache invalidation/update semantics from the current status feed, including non-state edit/delete repair.
- Implement dedicated terminal channel and control procedures; retain tmux durability, viewer lease, and native Ghostty/xterm integration behavior.

**Exit:** reconnect/gap/terminal ordering tests pass; no WebSocket server is used by desktop runtime.

### Phase 6 — Local execution capabilities

- Port settings/providers/launch bindings, agent runs/automation, execution graph, terminals, worktrees/Git, documents/watchers, and recovery reconciliation.
- Use safe disposable repositories and terminal fixtures for tests.
- Make every external effect idempotent/reconcilable enough to match existing restart behavior.

**Exit:** normal end-to-end “ticket to execution to terminal/doc/worktree” flows work in real desktop tests.

### Phase 7 — MCP and full contract closure

- Implement Rust MCP tool adapter over controllers.
- Compare MCP registry and representative tool result/error behavior to the existing service.
- Close remaining capability inventory entries, including infrequently used configuration and maintenance operations.

**Exit:** MCP works independently of TauRPC; inventory has no unowned capability.

### Phase 8 — Proof and handoff

- Run full Rust tests, TypeScript typecheck/unit/acceptance tests, Tauri smoke tests, desktop E2E, parity suite, and data integrity checks.
- Execute manual normal-use smoke on a disposable copy of real data.
- Produce a concise implementation report: completed inventory, tests run, known differences, rejected/reused legacy modules, and exact blockers if any.

**Exit:** every hard acceptance gate passes. Otherwise, report the precise failed gate; do not claim full parity.

## 16. Risks and explicit non-goals

### Principal risks and mitigations

| Risk | Mitigation |
| --- | --- |
| earlier Rust code looks complete but is untested | candidate-by-candidate evidence gate and differential scenarios |
| “copy DB” captures an inconsistent WAL state | SQLite backup/quiesced snapshot protocol and immutable manifests |
| SeaORM mapping subtly changes legacy codecs/relations | schema/entity tests and real-database read/write comparisons |
| resolvers become mini-controllers | source/dependency checks plus one-hop resolver review rule |
| no pure domain layer leads to unstructured ORM calls | named model operations, controller boundaries, and transaction tests—not a duplicate entity graph |
| wide revisions lose precision in TypeScript | checked safe numbers or decimal-string wire types |
| events cause stale screens | snapshot-on-subscribe/recovery and explicit delete/non-state invalidation tests |
| terminal streaming blocks the app | dedicated bounded channel, not event bus/query cache |
| worktree/Git/process operations damage real data | typed authorized roots, argv invocation without shell, disposable integration fixtures, recovery tests |
| frontend transport replacement changes UX | preserve hooks/query keys/acceptance tests and make proxy change behind façade |
| overnight run reports compilation as completion | hard acceptance gate checklist and explicit capability inventory |
| in-process concurrency differs from Django's request serialization | locked single-writer policy (§7.5) and concurrent differential scenarios per rule family |
| parity harness itself is wrong, silently blessing divergent behavior | harness proven Django-versus-Django in Phase 0 before any Rust comparison |
| TauRPC event/channel/generation APIs fail late at real scale | mandatory Phase 1 de-risk spike on pinned versions before behavior porting |
| run halts mid-way with unverifiable progress | checkpoint discipline: every phase leaves a green, independently verifiable artifact |

### Non-goals for this rewrite

- redesigning the established SQLite schema or data model;
- changing Ticketry behavior opportunistically;
- retaining a DRF server, OpenAPI server, REST client, or status WebSocket in the normal Rust desktop runtime;
- reviving GPUI or replacing the React Studio frontend;
- building a generic ORM/framework/repository abstraction unrelated to a Ticketry need;
- adding browser-only full-runtime support via a hidden HTTP fallback;
- deleting Django source/data/migrations during the rewrite;
- treating the old Rust worktree as production-ready absent parity evidence.

## 17. Agent handoff instructions for the overnight run

Use this as the execution brief for the implementation agent.

> Build Ticketry’s Rust-native desktop backend in a new isolated worktree. The target is a complete, normal-use replacement: React remains, but calls only the generated TauRPC proxy in Tauri; DRF, REST/OpenAPI SDK use, and desktop WebSockets do not run in the new runtime. Django remains untouched and is the behavioral oracle only.
>
> Start from a consistent copied existing SQLite database. Its schema and persisted data shape are canonical. Use SeaORM entities/relations as the canonical Ticketry models; do not create a duplicate pure-domain entity graph. Place workflow, hierarchy, ranking, revision, deletion, and related invariants in named model-level transaction-safe operations. Controllers coordinate use cases and external effects; TauRPC resolvers are thin input/result adapters.
>
> Build the reusable Ticketry kernel described here: SeaORM model operations, controllers, typed TauRPC view contracts/errors/events, transaction/event helpers, and local execution integration. Do not clone/wipe-fork DRF and do not adopt Loco/HTTP-first architecture. Do not copy GPUI, HTTP/OpenAPI, or WebSocket transport from the old Rust attempt. MCP remains external and calls controllers directly.
>
> Preserve the React/TanStack Query hooks, query keys, cache behavior, and optimistic updates. Replace the status socket with typed TauRPC/Tauri events plus snapshot recovery. Use a separate ordered Tauri channel for terminal output and TauRPC procedures for terminal control.
>
> Sequence for early failure: first prove the differential parity harness on Django-versus-Django, then pass the Phase 1 TauRPC event/channel/terminal spikes on pinned versions, and only then begin porting behavior. Serialize all SQLite writes through the single-writer policy in §7.5.
>
> Before reusing any old Rust module, audit dependencies and prove schema/behavior parity against the Django reference. Implement every capability listed in the parity inventory. Add tests as behavior is ported, and do not claim completion until all hard acceptance gates pass. If a gate fails — or the run halts early — report the last fully green phase, the exact scenario, current result, expected Django behavior, affected data scope, and smallest next action. A run whose completed phases are all verifiably green is a valid checkpoint; claim nothing beyond it.

### Required final handoff report

The implementation agent must return:

1. worktree location and a concise change summary;
2. completed capability inventory with any unimplemented entries called out explicitly;
3. schema adoption proof and data fixture provenance (no secrets);
4. list of legacy Rust modules accepted, adapted, or rejected with evidence;
5. tests run and result by layer;
6. confirmation that the Rust desktop runtime starts without DRF/Python and React uses TauRPC;
7. known parity differences—expected to be empty—or explicit blockers with repro steps;
8. recommended next action only if all hard gates are not green.

## 18. Open implementation-time checks

The product decisions are locked. These are technical verifications to perform before/during implementation, not invitations to change the architecture:

1. Pin the exact TauRPC version and confirm its current Tauri event/channel and TypeScript generation APIs; adapt syntax, not boundaries.
2. Inventory the exact live SQLite file(s), journal mode, Django migration state, and all existing tables/constraints/triggers before generating SeaORM entities.
3. Freeze the complete current REST/SDK/MCP/React operation manifest so “whole app” is objectively testable.
4. Confirm all current terminal rendering paths—native Ghostty and browser/xterm fallbacks—and preserve the agreed durable tmux ownership model.
5. Decide whether the Rust-owned MCP listener is embedded in the Tauri process or launched as a tightly managed companion process, while preserving direct controller access in either case.
6. Decide the checked wire representation for each current `u64`/SQLite integer field after measuring real ranges and frontend needs.

These checks must result in documented implementation facts. They do not permit adding a Django fallback, HTTP adapter, GPUI port, or schema redesign.
