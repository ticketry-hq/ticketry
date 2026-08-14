# Prior Rust attempts: salvage guide and structural post-mortem

## Scope and reading note

This review covers two local repositories as they exist on 2026-08-12:

- `/Users/karthik/merge_conflicts/coding/Rusty/ticketry-rust`
- `/Users/karthik/merge_conflicts/coding/worktracker-rust`

Neither is a clean, released baseline. `ticketry-rust` is on branch
`rust-gpui-migration` with both tracked modifications and substantial untracked
migration work. `worktracker-rust` reports `No commits yet on main`; its entire
tree is untracked. Conclusions therefore describe the current filesystem, not a
stable historical release. The source repositories were inspected read-only.

The most important conclusion is that these attempts did not fail for lack of
good Rust code. They failed to establish a destination that matched the desired
product boundary and could be merged incrementally. The larger attempt contains
valuable implementation and parity assets, but still builds a separately
supervised backend process and postpones the switch until a very large one-shot
cutover. The smaller attempt has the cleaner WorkTracker boundary, but creates a
new standalone HTTP product and incompatible schema rather than replacing
Ticketry in place.

Ticketry's own earlier [`../WORKTRACKER_RUST_LLD.md`](../WORKTRACKER_RUST_LLD.md)
explains the appeal of a standalone, agent-neutral tracker and maps many of the
same WorkTracker rules. Its deliberate exclusion of launch bindings and coding
agent concerns is useful for a domain library, but is also why that shape cannot
be the whole Ticketry migration destination. Where that design or either Rust
attempt differs from the current Django models/services, current Ticketry is
the compatibility source of truth.

## At-a-glance comparison

| Dimension | `ticketry-rust` | `worktracker-rust` |
| --- | --- | --- |
| Intended shape | Eight-crate ports-and-adapters workspace: domain, application, SQLite/local/HTTP/MCP adapters, runtime, and parity harness (`Cargo.toml`; `tests/architecture/dependency_graph.rs`) | Standalone Loco/SeaORM WorkTracker backend with pure domain, services, controllers, events, and one migration (`README.md`; `src/lib.rs`) |
| Size found | 251 Rust files and about 50,147 Rust lines under `crates/`; 48 of those files are under crate test directories | About 10,861 production/migration Rust lines, 4,586 integration-test Rust lines, 63 source Rust files, 14 integration-test files, and 3,439 TypeScript/TSX lines under `studio/src/` |
| Product breadth | WorkTracker, runs, terminals/tmux, execution, automation, documents, profiles/settings, worktrees/Git, HTTP, two WebSockets, and MCP (`crates/`) | WorkTracker catalogue, workflow, hierarchy, ranking, blockers, state revisions, and event outbox; no agent/run/terminal/execution/MCP vertical (`README.md`; `src/`) |
| Persistence direction | Adopt current Django SQLite tables in place, bridge historical generations, then apply SQLx migrations (`docs/adr/0018-rust-adopts-the-existing-product-schema-in-place.md`; `crates/muxed-adapter-sqlite/src/bridge/`) | Fresh singular, unprefixed schema with UUID v7 IDs in one SeaORM migration (`DECISIONS.md`; `migration/src/m20240101_000001_worktracker.rs`) |
| Runtime/transport | One Rust executable, but one **supervised child process** serving distinct loopback HTTP and MCP listeners (`docs/adr/0025-one-supervised-rust-process-hosts-both-local-protocols.md`; `crates/muxed-runtime/src/composition.rs`) | Standalone Loco/Axum listener on port 5150, static API key, optional in-process service calls (`config/development.yaml`; `src/app.rs`; `src/controllers/mod.rs`) |
| GraphQL/Tauri-native path | None: no GraphQL, TauRPC, or Tauri dependency in the migration workspace; HTTP/WebSocket remain the React path | None: no GraphQL, TauRPC, or Tauri dependency; frontend proxies `/api` to the standalone server (`studio/README.md`; `studio/vite.config.ts`) |
| Strongest asset | Database adoption/rollback corpus and broad protocol/domain implementation | Focused WorkTracker domain algorithms and transactional service tests |
| Fundamental mismatch | Replaces Python with another supervised sidecar and makes integration wait on total parity | Rewrites WorkTracker as a separate product with a new schema and incomplete Ticketry scope |

Counts above were produced from the current trees (`find ... -name '*.rs'` and
`wc -l`) and deliberately exclude copied Django/React Ticketry source and build
output.

## Attempt 1: `ticketry-rust`

### What it built

The current Rust workspace is real and broad, not a sketch. Its crate graph is:

- `muxed-domain`: transport-independent WorkTracker, execution, run, terminal,
  and worktree types and rules (`crates/muxed-domain/src/`).
- `muxed-application`: use cases and ports (`crates/muxed-application/src/`).
- `muxed-adapter-sqlite`: current-database adoption, historical bridges,
  SQLx migrations, repositories, snapshots, and restore
  (`crates/muxed-adapter-sqlite/src/`).
- `muxed-adapter-local`: filesystem, profiles, providers, processes, PTY/tmux,
  watchers, and Git worktrees (`crates/muxed-adapter-local/src/`).
- `muxed-adapter-http` and `muxed-adapter-mcp`: external projections
  (`crates/muxed-adapter-http/src/`; `crates/muxed-adapter-mcp/src/`).
- `muxed-runtime`: resource composition, data-directory ownership, startup
  reconciliation, listeners, and task supervision
  (`crates/muxed-runtime/src/`).
- `muxed-parity`: a test-only transcript comparison harness
  (`crates/muxed-parity/src/lib.rs`).

That direction is enforced, not merely documented. Each crate declares a layer
and dependency allow-list in its `Cargo.toml`; the architecture test rejects
domain-to-workspace, application-to-adapter, adapter-to-adapter, and concrete
runtime dependencies in the inner layers
(`tests/architecture/dependency_graph.rs`). `unsafe_code = "forbid"` and
workspace-wide Clippy denial are configured in the root `Cargo.toml`.

The persistence work is especially extensive. Seven SQLx migrations cover a
Django-compatible baseline plus transition facts, application events,
runs/terminals/launch effects, local-state journaling, worktree operations, and
execution facts (`crates/muxed-adapter-sqlite/migrations/0001_baseline.sql`
through `0007_execution_facts.sql`). Adoption does not guess from table names:
it compares a checked schema manifest, performs semantic preflight, snapshots
before mutation, and has explicit current/historical paths
(`crates/muxed-adapter-sqlite/src/schema_manifest.rs`;
`src/preflight/`; `src/snapshot.rs`; `src/adopt.rs`; `src/bridge/`). The parity
database manifest names 47 fixtures, including 27 WorkTracker generations plus
historical runs, terminals, execution, settings, worktrees, and current/WAL
shapes (`tests/parity/databases/manifest.v1.json`;
`tests/parity/databases/historical/`).

Protocol inventory is also concrete. The frozen HTTP route manifest contains
88 operations, the FastMCP registry fixture contains 33 tools, and the scenario
manifest declares 16 scenarios (`tests/fixtures/http/route-manifest.v1.json`;
`tests/fixtures/mcp/tools-list.fastmcp-2.14.5.json`;
`tests/parity/scenarios/manifest.v1.json`). Fixtures cover authentication,
origin policy, response/error shapes, run bearer compatibility, status
WebSocket frames, terminal HTTP behavior, profiles, providers, and runtime
control (`tests/fixtures/`). Runtime tests exercise direct, HTTP, MCP, adopted
database, historical bridge, event/status, terminal, execution, worktree, and
startup-fault paths (`crates/muxed-runtime/tests/`).

The accompanying design work is unusually thorough. ADRs 0017–0026 settle the
application boundary, in-place schema adoption, aggregate strategy, durable
launch effects, authorized local effects, durable realtime events, HTTP/MCP
contract projections, one-process/two-listener packaging, and evidence-gated
cutover (`docs/adr/0017-one-embeddable-application-runtime-behind-local-adapters.md`
through `0026-evidence-gates-one-shot-rust-cutover.md`). The Wayfinder folder
contains 12 investigations and a 14-slice implementation plan
(`docs/wayfinder/rust-backend-migration/`; especially
`implementation/README.md`).

### What is directly reusable

Reuse should be selective and validated against current Ticketry, because this
tree is an external fork and is dirty.

1. **Adopt the persistence evidence and strategy almost wholesale.** The
   schema classifier, Django-compatible codecs, snapshot/restore flow,
   historical bridge transforms, manifest, and fixture recipes solve the
   highest-risk data problem
   (`crates/muxed-adapter-sqlite/src/{preflight,bridge,schema_manifest.rs,snapshot.rs,restore.rs}`;
   `tests/parity/databases/`). The architectural decision to adopt existing
   product tables in place and keep Django bookkeeping inert for rollback is
   sound (`docs/adr/0018-rust-adopts-the-existing-product-schema-in-place.md`).
   These should be ported into the new destination shape, not copied blindly.

2. **Reuse pure domain rules and focused tests.** Work-item graphs, ranking,
   workflow aggregates, execution reduction, run lifecycle, viewer leases,
   launch effects, and worktree operation types are already separated from
   transports (`crates/muxed-domain/src/`; `crates/muxed-domain/tests/`). The
   WorkTracker coverage audit finds the pure WorkTracker module has no imports
   from runs, execution, worktrees, terminals, or providers
   (`docs/research/rust-worktracker-coverage-audit.md`).

3. **Reuse durable-effect and reconciliation designs.** Predetermined run IDs,
   idempotent launch effects, tmux-as-live-authority, and startup reconciliation
   directly address crash windows (`docs/adr/0020-agent-launches-are-durable-idempotent-effects.md`;
   `crates/muxed-domain/src/runs/launch_effect.rs`;
   `crates/muxed-application/src/runs/reconcile.rs`). The same applies to
   worktree operation journals (`crates/muxed-application/src/worktrees/`;
   `crates/muxed-adapter-sqlite/src/worktrees/`).

4. **Reuse realtime invariants, not necessarily the transport.** The durable
   outbox plus register/snapshot/replay/live handshake and explicit lag repair
   are the important correctness properties
   (`docs/adr/0022-durable-application-events-feed-gated-realtime-projections.md`;
   `crates/muxed-application/src/events/`;
   `crates/muxed-adapter-http/src/ws/status.rs`). A GraphQL subscription or
   Tauri event adapter can project the same application stream.

5. **Reuse MCP contract fixtures and projection behavior.** The historical
   33-tool registry must first be diffed against current Ticketry's 30 tools;
   its result wrapping, per-request run credential handling, and direct
   application-adapter principle remain applicable even if the Studio transport
   becomes GraphQL-over-Tauri
   (`docs/adr/0024-mcp-is-a-contract-frozen-direct-application-adapter.md`;
   `tests/fixtures/mcp/`; `crates/muxed-adapter-mcp/src/`).

6. **Reuse the parity and cutover ledgers as acceptance inputs.** The HTTP,
   WebSocket, MCP, auth, fault, performance, and intentional-correction manifests
   enumerate compatibility work that a new plan should not rediscover
   (`tests/parity/`; `tests/fixtures/`). The evidence bundler's G0–G10 reports,
   artifact hashes, redaction checks, and explicit rollback evidence are useful
   release disciplines (`scripts/cutover-evidence.mjs`;
   `scripts/cutover-target-verify.mjs`).

7. **Carry forward the local-authority rules.** Canonical authorized roots, no
   shell, durable Git/filesystem operations, and watcher-as-hint/rescan-as-truth
   are product safety rules, not framework choices
   (`docs/adr/0021-local-effects-use-authorized-roots-and-durable-operations.md`;
   `crates/muxed-adapter-local/src/roots.rs`;
   `crates/muxed-adapter-local/src/git/`).

### Why it did not land structurally

The repository solved many hard pieces but optimized for a replacement backend
artifact, not for an in-process Ticketry destination.

- **The target preserves the operational problem being removed.** ADR-0025
  explicitly ships one Rust executable as a supervised child with two loopback
  listeners; the Tauri shell owns the child, listener descriptors, health
  probes, recovery, and readiness protocol
  (`docs/adr/0025-one-supervised-rust-process-hosts-both-local-protocols.md`).
  `RuntimeBuilder` still binds HTTP/MCP listeners and acquires a data-directory
  ownership lock (`crates/muxed-runtime/src/composition.rs`). This reduces two
  Python processes to one Rust process, but it does not achieve the requested
  in-process Tauri pattern or remove ports, child supervision, or orphan-process
  reasoning.

- **The migration is integration-last.** ADR-0026 forbids a production selector
  and commits to a one-shot switch only after total evidence
  (`docs/adr/0026-evidence-gates-one-shot-rust-cutover.md`). Slice 12 waits for
  behavior slices 04–11, slice 13 then packages the desktop, and slice 14 finally
  changes supported commands (`docs/wayfinder/rust-backend-migration/implementation/README.md`).
  That makes roughly 50,000 lines of Rust, every protocol, persistence ownership,
  desktop packaging, and rollback one merge/cutover horizon. The plan is careful,
  but it cannot earn confidence through small production-shaped increments.

- **The application boundary became an omnibus.** `ApplicationInner` owns
  installation persistence, provider catalogue, attachments, documents,
  profiles, host settings, events, execution, runs, agent host, terminal viewer,
  worktrees, repository locks, and all subscribers in one handle
  (`crates/muxed-application/src/application.rs`). The WorkTracker facade wraps
  that common object, workflow mutation reaches the provider catalogue, and the
  common dispatcher invokes execution handlers
  (`crates/muxed-application/src/worktracker/service.rs`;
  `crates/muxed-application/src/application.rs`). This is better than Django
  signal coupling, but makes domains difficult to transplant or complete one at
  a time.

- **The persistence adapter regrew a monolith.** The governing source project
  had oversized, mixed-responsibility backend files; the Rust destination
  recreated the same pressure in different syntax. Current hotspots include
  `crates/muxed-adapter-sqlite/src/repositories.rs` (2,515 lines),
  `src/execution/mod.rs` (1,639), and `src/worktracker/items.rs` (1,395).
  `muxed-adapter-sqlite` alone is about 18,224 Rust lines. Its own coverage audit
  notes most catalogue/workflow persistence lives in `repositories.rs`, while
  nominal `worktracker/catalog.rs`, `project.rs`, and `workflow.rs` contain only
  shared SQL constants (`docs/research/rust-worktracker-coverage-audit.md`).

- **Parity infrastructure outpaced executable parity.** `muxed-parity` can copy
  fixtures and compare normalized transcripts, but the coverage audit states
  that its current runner uses synthetic health/event transcripts and does not
  execute a concrete Python-versus-Rust WorkTracker scenario driver
  (`crates/muxed-parity/src/lib.rs`; `tests/parity/runner.rs`;
  `docs/research/rust-worktracker-coverage-audit.md`). Manifests are valuable,
  but declared scenarios are not proof until wired to both real implementations.

- **It drifted into a long-lived external product fork.** The repo contains a
  copied `ticketry/` application alongside the new root Rust workspace, and its
  root README still describes the Django backend and supervised HTTP/MCP stack
  (`README.md`; `ticketry/`). Current status includes changes in both the Rust
  workspace and copied Ticketry integration files. This topology makes ongoing
  source changes expensive to reconcile and obscures which repository owns the
  final architecture.

- **It does not exercise the chosen new seam.** There is no GraphQL, TauRPC, or
  Tauri dependency in the migration crates. HTTP/WebSocket DTO preservation is
  the organizing transport choice (`crates/muxed-adapter-http/`;
  `docs/adr/0023-http-contracts-are-thin-route-specific-projections.md`). Thus it
  cannot validate the template's codegen, resolver/module structure, or
  GraphQL-over-Tauri integration that now motivates the migration.

## Attempt 2: `worktracker-rust`

### What it built

This repository is a narrower, cleaner domain rewrite. Its README states the
boundary plainly: a standalone WorkTracker with no coding-agent dependency,
organized as pure domain logic, services, controllers, SeaORM entities, durable
events, and migrations (`README.md`). The current code reflects that intent:

- Pure algorithms cover address parsing, blocker-cycle validation, workflow
  reachability/pruning, parent-tree validation, impact tokens, fractional
  ranking with rebalance, seeded catalogues, and transition rules
  (`src/domain/`).
- Services own transactions, sequence allocation, state compare-and-set,
  catalogue/workflow operations, hierarchy repair, lifecycle, and queries
  (`src/services/`).
- One controller layer mounts 23 route patterns containing 41 method handlers
  under `/api/work-tracker`, all behind a static API key
  (`src/controllers/`; `src/controllers/mod.rs`).
- The schema comprises workspace, project, state, issue type, per-type
  transition, issue, blocker join, attachment, and event outbox tables
  (`migration/src/m20240101_000001_worktracker.rs`;
  `src/models/_entities/`).
- The current tree has 232 Rust `#[test]`/`#[tokio::test]`/`#[rstest]`
  attributes across source and integration tests. Request tests cover auth,
  addressing, blockers, catalogue, hierarchy, ranking, regressions, revisions,
  scoped workflows, state deletion, and workflows (`tests/requests/`).
- Its small Studio explicitly keeps server data in TanStack Query and only IDs
  and client state in Redux (`AGENTS.md`; `studio/src/server-state/`;
  `studio/src/client-state/`).

The repository also records real learning. `DECISIONS.md` pins attachment
scope, durable outbox delivery, singleton workspace, module/task shape,
transition authority, key format, schema naming, UUID/timestamp format, auth,
and seed data. A two-axis review found 12 spec problems and seven
standards/smell findings in the then-reviewed tree
(`spec/review-findings/README.md`). Several critical findings have since been
addressed in the current source: transition validation and conditional write
are inside one transaction (`src/services/work_items/transition.rs`;
`src/services/state_writer.rs`), parent validation checks project/cycles
(`src/services/work_items/mod.rs`; `src/domain/hierarchy.rs`), ranking
rebalances before exceeding 64 characters (`src/services/work_items/rank.rs`),
transition IDs identify occurrences (`src/events/mod.rs`), and events are
recorded to an outbox in the mutation transaction (`src/events/outbox.rs`). The
review files remain useful history, but should not be treated as an exact report
of the current tree.

### What is directly reusable

1. **Prefer this WorkTracker decomposition over the larger attempt's omnibus
   facade.** The pure functions in `src/domain/{transition,graph,hierarchy,blockers,ranking,impact_token}.rs`
   express difficult rules as snapshots-to-decisions. Their tests can be moved
   with little framework dependency.

2. **Reuse transactional patterns.** `src/services/work_items/transition.rs`
   re-reads under lock, validates against a fresh graph, and uses the conditional
   state writer; `src/services/work_items/edit.rs` updates descendants when a
   parent changes; `src/services/work_items/rank.rs` handles rank exhaustion.
   These are useful reference implementations even if SQLx replaces SeaORM.

3. **Reuse the event vocabulary and outbox semantics.** `DomainEvent`, typed
   `ChangedField`, occurrence-based `transition_id`, ordered `Recorded` cursor,
   transaction-local append, and replay API are well-scoped
   (`src/events/mod.rs`; `src/events/outbox.rs`).

4. **Reuse tests as behavior specifications.** The 14 request-test files and
   domain property tests are more portable than the Loco controllers. They
   isolate many WorkTracker invariants that should be replayed through the new
   application and GraphQL/Tauri seams (`tests/`; `src/domain/`).

5. **Reuse the decision record as a question checklist, not as settled Ticketry
   policy.** `DECISIONS.md` clearly exposes where this attempt intentionally
   diverged, which prevents accidental adoption of those choices.

### Why it did not land structurally

- **It chose greenfield persistence instead of migration.** The sole migration
  says it is a fresh schema with no data to adopt and pins singular unprefixed
  tables plus UUID v7 IDs (`migration/src/m20240101_000001_worktracker.rs`).
  `DECISIONS.md` repeats those choices. Ticketry's existing Django-prefixed
  tables and identifiers therefore require a separate migration/conversion
  system; this code cannot take ownership of the live database in place.

- **It defined a separate deployable product.** Loco owns boot, migrations,
  initializers, tasks, and Axum routes (`src/app.rs`); development listens on
  port 5150 (`config/development.yaml`); Studio talks to it through a Vite HTTP
  proxy (`studio/README.md`). That shape neither embeds in Ticketry's existing
  Tauri process nor tests GraphQL-over-Tauri.

- **Its boundary is too narrow for Ticketry cutover.** The README deliberately
  excludes launch bindings, providers, and prompts (`README.md`). There are no
  runs, tmux terminals, execution graph, automation attempts, documents,
  settings/profiles, worktrees, MCP, or WebSockets in the source tree. The
  separation is intellectually useful, but there is no integration seam proven
  with Ticketry's control planes.

- **It intentionally changed product contracts.** Examples include
  `automation_allowed` and `human | automation` in place of Django's
  `agent_allowed` and `human | agent`, a neutral seed catalogue rather than
  Ticketry's SDLC, mandatory auth, and a deferred attachment upload endpoint
  (`DECISIONS.md`; `config/seed_template.json`). Each may be defensible in a new
  tracker, but together they turn migration into product redesign and break
  drop-in frontend/MCP compatibility.

- **The backend framework leaks into the destination choice.** Although the
  domain is pure, persistence is modeled around SeaORM entities and one 788-line
  migration, while the application boot shape is Loco-specific
  (`src/models/_entities/`; `migration/src/m20240101_000001_worktracker.rs`;
  `src/app.rs`). The current target template's GraphQL modules and in-process
  Tauri state would require reshaping controllers, context, migrations, and
  composition rather than mounting this server unchanged.

- **The repository never established a merge base.** With no commits, no branch
  history, and the entire tree untracked, there is no reviewable sequence or
  clean provenance for integrating it. The dated review documents demonstrate
  useful iteration, but also show that the implementation and its audit drifted
  after review (`spec/review-findings/`; current `src/services/work_items/`).

## Recommended salvage policy

Do not resume either repository as the migration destination. Build the target
inside Ticketry, using the new template's in-process module/composition shape,
and import only artifacts that pass a current-source parity check.

| Artifact | Source to prefer | Treatment |
| --- | --- | --- |
| Existing SQLite adoption, historical migrations, snapshots/rollback | `ticketry-rust/crates/muxed-adapter-sqlite/` and `tests/parity/databases/` | Port early and preserve fixture identities; adapt composition to the in-process store |
| Core WorkTracker algorithms | `worktracker-rust/src/domain/`, cross-checked with `ticketry-rust/crates/muxed-domain/src/worktracker/` and current Django | Port rule-by-rule with existing tests; do not import the greenfield schema or changed wire vocabulary |
| Runs/execution/tmux/worktrees | `ticketry-rust/crates/{muxed-domain,muxed-application,muxed-adapter-local,muxed-adapter-sqlite}/` | Reuse domain/effect/reconciliation logic behind smaller feature-owned application modules |
| Status/realtime correctness | `ticketry-rust` ADR-0022 and event tests; `worktracker-rust/src/events/` | Keep durable cursor/snapshot/replay invariants; project through GraphQL/Tauri instead of preserving WebSocket code by default |
| MCP compatibility | `ticketry-rust/tests/fixtures/mcp/` and `muxed-adapter-mcp/` | Diff the historical 33-tool fixture against the current 30-tool registry, preserve current behavior, and keep direct application calls behind the external MCP adapter |
| HTTP/OpenAPI compatibility | `ticketry-rust/tests/fixtures/http/` | Treat as a temporary compatibility inventory for actual consumers, not as the internal architecture |
| Differential/cutover evidence | `ticketry-rust/tests/parity/` and `scripts/cutover-*.mjs` | Turn declared cases into executable Django-vs-Rust scenarios before relying on the gate |
| Loco server, SeaORM greenfield migration, standalone mini-Studio | `worktracker-rust/src/app.rs`, `migration/`, `studio/` | Do not transplant; retain only tests, domain rules, and client-state lessons |

The structural correction is to make each migrated Ticketry feature a small
vertical slice with its own domain/application/persistence/GraphQL module,
composed into the existing Tauri process. Keep the external MCP adapter only as
an external listener. This uses the prior work where it is strongest while
avoiding both earlier traps: a second standalone product and an all-or-nothing
replacement sidecar.

## Paths inspected and access notes

For `ticketry-rust`, inspection included the root `CLAUDE.md`, nested
`ticketry/AGENTS.md` and `ticketry/CLAUDE.md`, relevant nested `CONTEXT.md`
files, root/workspace manifests, all crate file maps and size counts, crate
dependency declarations, architecture tests, ADRs 0017–0026, Wayfinder handoff
and implementation index, the WorkTracker coverage and library-delegation
research notes, SQL migrations and parity/fixture manifests, representative
domain/application/runtime source, current Git log, and read-only status. A
top-level `AGENTS.md` was returned by the initial filesystem search but was no
longer present when opened; the nested project guidance remained readable.

For `worktracker-rust`, inspection included `AGENTS.md`, `CLAUDE.md`, `README.md`,
`DECISIONS.md`, Cargo/config/seed files, the complete source and test file maps,
the migration and SeaORM entity shape, domain/service/event/controller
implementations, Studio architecture and package files, review findings,
counts, and read-only status. No requested repository path other than the
transient top-level `ticketry-rust/AGENTS.md` was inaccessible.
