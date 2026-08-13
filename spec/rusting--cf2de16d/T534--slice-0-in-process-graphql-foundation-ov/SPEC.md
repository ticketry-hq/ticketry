# Spec — Slice 0: In-process GraphQL foundation over TauRPC

This specification records the agreed foundation slice for CODING-534. It is
the composition proof for the ratified vertical-slice Rust migration, not a
production domain migration or a replacement for the supervised Python
sidecar.

## Problem Statement

Ticketry intends to move backend capabilities from Django to Rust one vertical
slice at a time, but the useful machinery from the reference Tauri GraphQL
template had not yet been proven inside Ticketry's real desktop shell. Without
that proof, later migration estimates would rest on assumptions about whether
SeaORM, Seaography, GraphQL, generated TypeScript operations, and TauRPC can
coexist with Ticketry's native commands, data-directory ownership, tmux, and
libghostty integration.

The foundation also needs safe failure semantics. A startup race or failed
database migration must not expose partially initialized application state,
generated artifacts must not drift according to the machine that produced
them, and domain failures must remain machine-readable across the complete
Rust-to-TypeScript boundary.

The proof must not put existing user data at risk. Django remains the sole owner
of `state.db`, and Slice 0 must not introduce a production UI or imply that any
Ticketry domain has moved to Rust.

## Solution

Add a small Rust-owned GraphQL runtime directly to the existing Tauri process.
It owns a disposable probe database named `rust-core.sqlite3`, runs one trivial
migration, exposes generated read shape plus one authored command, and carries
GraphQL requests through a typed TauRPC service without HTTP, ports, CORS,
WebSockets, or another sidecar.

Compose the TauRPC handler with Ticketry's existing native Tauri command
handler. Initialize the GraphQL endpoint atomically after data-directory
ownership is established; until installation succeeds, requests receive a
structured unavailable response. A failed initialization is logged and leaves
the native desktop shell usable without a partially installed endpoint.

Commit the generated Rust entities, GraphQL SDL, TauRPC TypeScript bindings, and
typed frontend operations. Generate them from a clean migrated database under a
pinned toolchain, and verify both repeatability and byte-for-byte repository
drift. Exercise the frontend only through a test-only probe; Slice 0 makes no
shipping Studio UI behavior change.

## User Stories

1. As a migration maintainer, I want the GraphQL foundation integrated into Ticketry's real Tauri shell, so that later Rust slices build on proven composition rather than a separate demonstration app.
2. As a desktop user, I want all existing native terminal, viewer, discovery, ownership, and supervised-sidecar behavior to remain available, so that the migration foundation does not disrupt the current product.
3. As a data owner, I want Slice 0 to use a separate Rust-owned database, so that Django's `state.db` is neither opened nor changed by the proof.
4. As a migration maintainer, I want the probe database stored in Ticketry's owned application-data directory, so that it follows the desktop lifecycle without introducing a second storage location.
5. As a migration maintainer, I want the Rust database to migrate forward during initialization, so that later slices have a proven migration-first startup path.
6. As a migration maintainer, I want foreign-key enforcement and a bounded SQLite connection pool enabled, so that the foundation starts with production-shaped database settings.
7. As a frontend developer, I want a GraphQL query to execute through generated TypeScript operation types over TauRPC, so that the intended end-to-end read path is proven.
8. As a domain maintainer, I want writes to use an authored command while generated entity mutations are hidden, so that future domain invariants cannot be bypassed by generic CRUD.
9. As a frontend developer, I want authored-command failures to arrive as typed error codes, so that clients can react without parsing human-readable messages.
10. As a migration maintainer, I want the same domain error identity to survive Rust, GraphQL serialization, TauRPC, and TypeScript mapping, so that transport layers do not erase application meaning.
11. As a desktop user, I want the probe value to survive an application restart, so that reopening the Rust-owned database is proven safe.
12. As a desktop user, I want GraphQL calls made before successful initialization to return a structured service-unavailable error, so that startup timing never produces an ambiguous transport failure.
13. As a desktop user, I want initialization failure to leave no partial endpoint or database state, so that retry and diagnosis begin from a coherent condition.
14. As a desktop user, I want native commands to remain usable when GraphQL initialization fails, so that an optional migration foundation cannot prevent access to the existing desktop application.
15. As a security maintainer, I want malformed, blank, oversized, and otherwise invalid transport requests bounded and rejected with structured errors, so that the in-process boundary has explicit input limits.
16. As a transport maintainer, I want subscription registration and teardown primitives to avoid duplicate or stale registrations, so that the copied transport machinery has a safe lifecycle even though durable product subscriptions are deferred.
17. As a build maintainer, I want framework and toolchain versions pinned, so that generated output and compilation do not move implicitly.
18. As a build maintainer, I want entities, schema, transport bindings, and frontend operation types generated from one clean migration chain, so that committed artifacts share one source of truth.
19. As a reviewer, I want generation run twice from scratch and compared, so that nondeterminism is detected independently of repository drift.
20. As a reviewer, I want clean generation compared byte-for-byte with committed artifacts, so that stale generated code cannot be merged silently.
21. As a frontend maintainer, I want Slice 0 coverage to remain test-only, so that proving infrastructure does not create a user-visible feature or a new server-state authority.
22. As a migration planner, I want the foundation explicitly separated from WorkTracker reads and writes, so that passing Slice 0 cannot be mistaken for a production ownership handoff.
23. As an MCP maintainer, I want Slice 0 to leave the current MCP service unchanged, so that an external Rust MCP listener is introduced only alongside an owned domain slice.
24. As a release maintainer, I want the existing Rust and frontend suites to remain green, so that the foundation demonstrates coexistence with the current shell rather than isolated correctness.

## Implementation Decisions

* The foundation runs as managed state inside the existing Tauri process. It is
  not an HTTP service, standalone executable, replacement sidecar, or separate
  application.
* The Tauri invoke surface composes one TauRPC GraphQL service with the existing
  native command handler. The existing native handler and its permissions stay
  intact; GraphQL execution, subscription, and unsubscription receive explicit
  Tauri capabilities.
* Initialization starts only after Ticketry has established data-directory
  ownership. The database and schema are fully composed before the endpoint is
  installed. Installation is one-way for the process lifetime, preventing a
  caller from observing half-initialized state.
* Initialization failures carry stable snake-case codes for database-directory,
  database-open, migration, schema, and endpoint-install phases. Startup reports
  the code and message while allowing the existing shell to continue. Calls to
  an uninstalled endpoint return a GraphQL error with the
  `service_unavailable` code.
* Slice 0 owns a SQLite file named `rust-core.sqlite3` beside, but independent
  from, Django's `state.db`. It creates the parent directory as needed, opens a
  pool with one minimum and four maximum connections, enables SQLite foreign
  keys, and runs forward migrations before schema construction.
* The sole model is a disposable migration probe with a stable numeric identity
  and string value. It exists only to prove migration, generated read shape,
  authored write behavior, and restart persistence; it is not copied product
  data.
* Seaography provides generated query shape. Generated entity mutation
  registration is deliberately disabled. The write surface is one authored
  command that validates the probe and either inserts or updates its stable row.
  This establishes the governing migration rule that domain writes enter
  authored application commands.
* Rejected probe input produces the stable GraphQL domain code
  `migration_probe_rejected`; storage failure produces
  `foundation_storage_failed`. The frontend wrapper maps GraphQL error
  extensions to a typed TypeScript error and retains the original code.
* The transport accepts JSON GraphQL request envelopes for unary execution and
  Tauri-channel subscriptions. It imposes a one-megabyte request limit,
  validates subscription identifiers, rejects duplicate identifiers, and
  removes and aborts subscription tasks on unsubscribe. These are transport
  guarantees only, not Ticketry's future durable cursor protocol.
* The Rust toolchain and the SeaORM, Seaography, async-graphql, Tauri, TauRPC,
  Tokio, Serde, Specta, and test-support versions are pinned at the workspace
  boundary. Upgrades are explicit compatibility work.
* Generation begins with a clean migrated SQLite database, generates SeaORM
  entities, applies the deliberate read-only entity-registration policy,
  exports GraphQL SDL and TauRPC TypeScript bindings, and generates typed
  operations from authored GraphQL documents.
* Generated entities, SDL, TauRPC bindings, and frontend operations are
  committed. Drift verification generates two independent scratch trees,
  compares them for determinism, and then compares them byte-for-byte with the
  committed tree.
* The frontend probe uses generated typed documents and the TauRPC proxy but is
  imported only by tests. No production component, route, cache, or visible
  interaction is added, so no new Studio acceptance case is required for this
  slice.
* Slice 0 lands in the existing desktop shell and retains the fallback and
  native terminal architecture. It does not move a production reader or writer
  away from Django.

## Testing Decisions

A good Slice 0 test observes a contract at the highest available seam: the
GraphQL response envelope across the real TauRPC endpoint, durable contents
after closing and reopening the database, generated bytes produced by the
public generation command, or the composed desktop command/capability surface.
Tests should not assert private helper structure or reproduce framework
internals.

* The primary Rust integration seam initializes the real foundation against an
  isolated temporary database and calls the endpoint through the transport. It
  proves an empty generated query, an authored write followed by restart and
  read, typed domain-error extensions, and a failed initialization that installs
  no partial endpoint.
* The transport crate seam exercises GraphQL response envelopes, pre-init
  unavailability, malformed/blank/oversized requests, subscription identifier
  validation, duplicate rejection, event delivery, unsubscribe, and registry
  cleanup.
* The frontend unit seam uses generated operation documents and a TauRPC-shaped
  proxy. It proves the serialized operation name and variables, typed query
  results, and mapping of `migration_probe_rejected` to the typed frontend
  error.
* The generation seam runs from clean migrated databases twice, compares both
  output trees, and compares the resulting entities, SDL, bindings, and
  operations with committed artifacts.
* The desktop shell contract seam proves that TauRPC capabilities are present
  alongside the complete existing native command surface. The full Rust suite
  remains the regression gate for native coexistence.
* Because Slice 0 has no user-visible Studio behavior, it adds no acceptance
  scenario. Existing numbered overhaul acceptance coverage remains unchanged
  and must continue to pass when broader handoff validation is run.

Prior art is the reference template's database, transport, generation, and
frontend contract tests, adapted to Ticketry's existing Tauri composition. The
Ticketry-specific addition is regression coverage for coexistence with the
native desktop shell.

## Out of Scope

* Reading, migrating, copying, repairing, or writing Django's `state.db`.
* Moving WorkTracker reads or writes from Django to Rust.
* Applying the Django feature freeze; that follows the accepted Slice 0 exit.
* Shipping a Studio UI, adding a production GraphQL cache, or changing any
  user-visible workflow.
* Replacing the supervised Python backend, REST API, generated SDKs, or current
  MCP service.
* Introducing an external Rust MCP listener.
* Proving foreign-key relations and constraint mapping for real Ticketry
  aggregates.
* Providing generated mutations for product entities.
* Implementing a durable outbox, monotonic cursor, replay, lag recovery, or
  production subscription semantics.
* Opening a production HTTP or WebSocket GraphQL endpoint, including a
  browser-only production mode.
* Resolving PostgreSQL compatibility, data adoption, downgrade conversion, or
  any later-slice ownership decision.
* Creating implementation tickets; ticket decomposition belongs to the
  `Tickets` workflow stage.

## Further Notes

This specification is governed by the ratified vertical-slice strategy and its
one-writer rule. Slice 0 is intentionally disposable foundation state. Its
successful exit reduces composition uncertainty, but it does not satisfy the
data-adoption, curated-acceptance, or dogfood gates required when a production
domain changes ownership.

The implementation and verification are recorded on branch `rust-migration` in
commits `d204d05` (ratified strategy documents) and `547b1ba` (foundation).
The verified proof points are structured initialization failure without partial
state, structured pre-initialization unavailability, restart persistence,
deterministic drift-free generation, coexistence with the native command suite,
and a typed domain error surviving Rust through GraphQL to TypeScript.

*Triage: ready-for-agent*