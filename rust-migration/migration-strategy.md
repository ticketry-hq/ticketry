# Ratified Rust migration strategy

## Strategy in one sentence

Port Ticketry **as is, in place, one vertical slice at a time** inside the
existing Tauri application on the `rust-migration` branch; keep exactly one
writer for each table, dogfood each slice in the real product, and decide
whether to continue the migration after Rust owns WorkTracker writes.

This is deliberately not a redesign. During migration, Rust mirrors the Django
domains, GraphQL types reproduce the current DRF serializer semantics, and
existing service functions become authored commands. Schema cleanup, richer
nested GraphQL queries, subscription-driven rendering, and other GraphQL-native
improvements wait for a final post-migration optimization phase.

## Work location and integration rule

All implementation happens in a git worktree of this repository on branch
`rust-migration`. The application core is added to
[`../studio/src-tauri/`](../studio/src-tauri/) and integrated into the existing
desktop shell from the first slice. A separate repository or freshly generated
application is explicitly rejected: integration-last is how the prior
`ticketry-rust` attempt died
([prior-attempts-postmortem.md](prior-attempts-postmortem.md)).

The frontend never moves. Within each existing
`studio/src/features/<domain>/` feature, its `queries/` and `mutations/` code is
re-pointed from the REST client to generated GraphQL operations. Migrated and
unmigrated features therefore coexist in one Studio build over different
transports; a feature has one server-state authority at a time.

## Non-negotiable seams

- The migrated backend is managed state in the Tauri process, never another
  sidecar or standalone server.
- Studio uses generated GraphQL operations over TauRPC for migrated features;
  unmigrated features continue to use the Django sidecar.
- Domain writes call authored application commands. Generated CRUD mutations
  cannot bypass workflow, hierarchy, ranking, revision, or effect invariants.
- GraphQL, the eventual Rust MCP listener, and native commands call the same
  application services.
- Every table has exactly one production writer. There is no production
  dual-write and no shadow-write path.
- Existing IDs, human sequence IDs, fractional ranks, revisions, relationships,
  paths, tmux names, and run identities are preserved by in-place adoption.
- Durable outbox/transition/effect facts are committed before realtime
  publication or local automation.
- Existing native libghostty, tmux viewer, ownership, discovery, and supervised
  sidecar behavior remain until the slice that deliberately replaces them
  ([`../studio/src-tauri/src/`](../studio/src-tauri/src/)).

## Slice 0: in-process GraphQL foundation

Goal: prove the template machinery in Ticketry's real shell without opening or
changing Django's `state.db`.

Deliver:

1. the pinned Rust/SeaORM/Seaography/GraphQL/TauRPC transport and deterministic
   generation chain under [`../studio/src-tauri/`](../studio/src-tauri/);
2. one small Rust-owned SQLite database beside `state.db`, with a trivial
   migration/entity, generated SDL, and an authored command;
3. a GraphQL query over TauRPC that coexists with all current Tauri commands;
4. structured unavailable and initialization failures, safe restart/reopen,
   deterministic drift checks, and typed Rust -> GraphQL -> TypeScript domain
   errors; and
5. test-only or development-only frontend coverage, with no shipping UI change.

Exit: the slice's focused Rust and TypeScript tests pass in the existing shell.
The database is disposable foundation state, not an early copy of `state.db`.

Once this exit passes, apply a **Django feature freeze**: only critical fixes
land in Python, and every such fix is explicitly flagged for re-porting to the
corresponding Rust slice. Freezing earlier would slow foundation work without
reducing meaningful drift.

## Slice 1a: WorkTracker reads in production

Goal: make real Studio planning reads use in-process GraphQL while Django still
owns every product write.

Rust opens the same SQLite `state.db` read-only alongside the sidecar. Django's
WAL configuration permits concurrent readers; Rust must not run migrations,
write a ledger, repair rows, or otherwise mutate this database in slice 1a.

Port the current read semantics for projects, modules/work items, issue types,
states, transitions, launch bindings, hierarchy, ranks, revisions, and workflow
views. GraphQL types initially reproduce the current DRF serializer outputs,
including nullability, identifiers, field naming, filtering, and ordering
([`../backend/worktracker/rest/`](../backend/worktracker/rest/),
[`../backend/worktracker/models/`](../backend/worktracker/models/)).

Re-point the existing projects/work-items/workflow feature query folders to
generated GraphQL operations one feature at a time. Each converted feature
removes or disables its old REST/React Query holding so Apollo or the chosen
minimal GraphQL client is its sole server-state authority.

Exit: the production Studio read views use TauRPC GraphQL against the live
read-only database, existing acceptance cases pass, and all writes still route
only to Django.

## Slice 1b: WorkTracker writes and the go/no-go gate

Goal: transfer ownership of WorkTracker tables and prove that the migration is
worth continuing.

Port [`../backend/worktracker/services/`](../backend/worktracker/services/) as
authored Rust commands, preserving the functions' current semantics rather than
redesigning the model. Cover project/catalogue creation, work-item lifecycle,
hierarchy/reparenting, fractional ranking, blocker graphs, workflow transitions,
revision compare-and-set, attachments, and deletion/archive rules.

The cutover for this slice is one explicit writer handoff:

1. run the complete data-adoption preflight, snapshot, classification, bridge,
   validation, and recovery process from [data-migration.md](data-migration.md);
2. stop Django writes to the WorkTracker tables and make Rust their sole writer;
3. re-point Studio mutations to authored GraphQL commands;
4. re-point the WorkTracker MCP tools to an in-process Rust MCP listener and the
   same authored commands; the current Python FastMCP -> Django REST write path
   cannot remain because it would violate one-writer; and
5. commit a durable transition-to-automation fact in the Rust transaction so
   Django-owned execution can continue reacting to status transitions until its
   own later slice. Delivery is resumable and idempotent; realtime notification
   is never the source of truth.

Exit and decision: run the adoption, curated acceptance, and dogfood gates
below. This is the explicit **go/no-go for the entire migration**. If the
WorkTracker write slice is not reliable or materially simpler to operate, stop
here with evidence rather than funding the remaining rewrite.

## Later dogfoodable slices

After the 1b go decision, port these in order. Each slice mirrors the current
Django app/service shape, re-points only its existing frontend and MCP callers,
has one writer, and is independently usable as a daily-driver build.

### Settings and launch policy

Port app settings, keybindings, profiles/features, provider/model/reasoning
catalogues, launch bindings, required skills, prompt, auto-start, and subtree
policy. Rust decides launch policy; Django execution may still perform effects.
Sources are [`../backend/apps/settings_store/`](../backend/apps/settings_store/)
and the provider/launch models under
[`../backend/worktracker/models/`](../backend/worktracker/models/).

### Runs and events

Port `AgentRun`, automation-attempt identity, run-scoped authorization,
termination, and the durable event/outbox protocol. Subscriptions use a
snapshot/replay/live cursor and force resnapshot after bounded lag; an in-memory
Tauri channel is transport, not history
([`../backend/apps/runs/`](../backend/apps/runs/)).

### Documents and worktrees

Port document metadata/watchers and worktree lookup/create/discard with
authorized roots, durable operation IDs, per-repository locks, and startup
reconciliation ([`../backend/apps/documents/`](../backend/apps/documents/),
[`../backend/apps/worktrees/`](../backend/apps/worktrees/)).

### Terminals

Port terminal-session persistence, approved provider command construction,
tmux lifecycle, hook ingestion, durable launch/cleanup facts, and reconciliation.
Keep tmux as live authority and join the lifecycle to the existing native
libghostty/tmux viewer code rather than rewriting it
([`../backend/apps/terminals/`](../backend/apps/terminals/),
[`../studio/src-tauri/src/native_terminal/`](../studio/src-tauri/src/native_terminal/)).

### Execution

Port dependency scope, graph-run creation, launch ledger, serial/parallel
scheduling, retry, event-driven advancement, and startup reconciliation only
after its dependencies are Rust-owned
([`../backend/apps/execution/`](../backend/apps/execution/)).

## Final cutover and Python retirement

Because each preceding slice already runs in production-shaped dogfood builds,
the final cutover contains only whatever Python-owned behavior remains. Switch
the remaining Studio/MCP consumers, remove the supervised Django/FastMCP
processes and their REST/WebSocket/port/auth-secret plumbing, retain the native
shell/runtime capabilities, and validate packaged restart, crash, update, and
data-upgrade behavior.

Only after every external MCP/provider hook path uses the in-process Rust core
may Python packaging and generated OpenAPI SDKs be removed. The Rust MCP
listener remains a narrow loopback projection for external agents; it is not a
second application runtime.

## Gates for every production slice

The migration uses three understandable gates, not a signed-evidence or broad
Django-versus-Rust differential-comparison ceremony.

1. **Data adoption.** Retain the full rigor of
   [data-migration.md](data-migration.md): exact schema classification,
   read-only semantic preflight, WAL-safe verified snapshots, known bridges,
   preservation of IDs/ranks/revisions, post-adoption digests, restart, salvage,
   and unknown-schema refusal. Corrupting or stranding existing data is the one
   unrecoverable migration failure.
2. **Curated acceptance.** Run the existing Studio acceptance suite plus
   targeted cases for the slice's commands, transport, failure mapping,
   persistence/effect boundaries, and MCP behavior. Add cases where current
   coverage does not protect a consumer-visible behavior; do not build a second
   universal parity framework.
3. **Dogfood.** Snapshot the real data directory, run the Rust build as the
   daily driver for a couple of days, and inspect real projects, workflows,
   agent launches, restart, and recovery before merging or releasing the slice.
   `MUXED_DATA_DIR` permits the first dogfood pass against a copied data
   directory before touching the ordinary installation.

There is no post-write downgrade tooling. Before Rust accepts writes, a failed
adoption restores the verified snapshot. After writes begin, returning to
Django would discard new facts or require a separately designed reverse
converter, so it is outside this migration. Keep snapshots and salvage guidance
for manual recovery; never imply automatic downgrade compatibility.

## Post-migration optimization phase

Only after Python retirement may the port be redesigned as a GraphQL-native
application. Candidate work includes nested query shapes, subscription-driven
rendering, schema/name cleanup, resolver batching, cache simplification, and
domain restructuring. Those changes receive their own product and migration
review; they are not smuggled into behavior-porting slices.

## Open product decisions

PostgreSQL destination/import policy, browser-only Studio scope, external HTTP
compatibility, fixed versus assigned MCP endpoints, exact compatibility for
legacy MCP/REST behavior, event retention, automation occurrence identity,
terminal history, graph-run resume, path portability, provider catalogue
ownership, and workspace cardinality remain explicit decisions. Track them in
[risks-open-questions.md](risks-open-questions.md) and settle each before its
owning slice; generated schema names must not decide product meaning by accident.
