# Risks, unknowns, and required decisions

## Decisions required before implementation tickets are finalized

### 1. Is PostgreSQL still a supported destination?

**Recommendation:** make Rust-owned desktop storage SQLite-only and support
PostgreSQL as an import source. The template's database, migration, and test
proof is SQLite-specific, and Ticketry is a single-owner desktop application
([`../backend/studio_server/database.py`](../backend/studio_server/database.py),
[template-architecture.md](template-architecture.md)).

**If PostgreSQL stays:** every repository and transaction path, schema migration,
advisory-lock/startup rule, differential test, and release fixture must be
dual-engine. This materially increases Phase 2 and every persistence phase.

### 2. Must browser-only Studio remain fully functional?

**Recommendation:** keep it as a supporting development/test adapter only, in
line with [`../AGENTS.md`](../AGENTS.md). Production Studio should use TauRPC.

**If full browser parity is required:** host GraphQL and subscriptions through a
Rust development server over the same schema/application services. Do not
preserve Django REST as the browser backend. Browser terminal rendering also
needs an explicit replacement for `/ws/terminal`.

### 3. Is HTTP/OpenAPI an external compatibility contract?

**Recommendation:** retain only operations with a proven non-Studio/non-MCP
consumer. GraphQL replaces the internal Studio surface and MCP calls the
application core directly. The 81 OpenAPI operations remain migration evidence,
not the target architecture ([`../openapi.json`](../openapi.json)).

If users/scripts consume REST, identify them in Phase 0 and provide a thin Rust
compatibility adapter with a removal/support policy.

### 4. May MCP remain a loopback listener?

**Recommendation:** yes, but in the Tauri process and only for external agents.
External MCP clients cannot use webview TauRPC. Bind narrowly, retain run-scoped
credentials and termination, prefer an OS-assigned port advertised to launched
providers, avoid a second data/application runtime, and make listener failure
visible without taking down Studio. If independently configured MCP clients
require a fixed endpoint, that compatibility requirement must be recorded
([`../surfaces/worktracker-agent/mcp/`](../surfaces/worktracker-agent/mcp/)).

### 5. Is post-write downgrade to Django required?

**Recommendation:** no automatic downgrade. Snapshot rollback is lossless only
before Rust accepts writes. Requiring post-write downgrade adds a reverse data
converter and constrains future Rust schema changes; see
[data-migration.md](data-migration.md).

### 6. How strictly must current MCP/REST behavior be preserved?

**Recommendation:** preserve actual consumer-visible semantics by default, with
an explicit correction ledger for known bugs or stale surfaces. Current MCP has
30 tools while the larger prior attempt froze 33; the discrepancy must be
explained, not silently resolved
([`../surfaces/worktracker-agent/api/tools.py`](../surfaces/worktracker-agent/api/tools.py),
[prior-attempts-postmortem.md](prior-attempts-postmortem.md)).

## High risks and mitigations

| Risk | Why it is real | Mitigation / gate |
| --- | --- | --- |
| Generated CRUD bypasses domain rules | The template optimizes for generated model CRUD; Ticketry writes enforce workflow, rank, hierarchy, dependency, lifecycle, and effect rules. | Hide unsafe mutators; expose authored commands; prove field hiding/custom errors first. [`../backend/worktracker/services/`](../backend/worktracker/services/) |
| Template gaps appear late | The template does not yet prove relations, auth, lifecycle hooks, custom operations/errors, or production subscription behavior. | Phase 1 composition spike must prove every gap in the real shell before broad porting. The `tauri-graphql-template` repository's `docs/stability-boundary.md` |
| Source keeps moving during a long migration | The working tree already has extensive changes in execution, terminals, WorkTracker, generated contracts, Tauri, and acceptance tests. External forks drifted for the same reason. | Work in this repo, keep slices small, regenerate manifests per merge base, and assign a parity owner to every changed source behavior. |
| Existing Tauri composition becomes a new monolith | `lib.rs` is already about 1,648 lines and supervisor code about 3,262; adding database/schema/application tasks directly would violate repository structure. | Split composition before feature work; enforce feature ownership and dependency tests. [`../studio/src-tauri/src/lib.rs`](../studio/src-tauri/src/lib.rs), [`../studio/src-tauri/src/supervisor.rs`](../studio/src-tauri/src/supervisor.rs) |
| Apollo duplicates React Query state | Current decisions require one entity holding and revision-based invalidation; an unplanned Apollo introduction creates two caches. | Pick one authority per migrated feature and delete/disable the other holding at cutover. [`../docs/decisions/2026-08-04-frontend-state-and-api-contract.md`](../docs/decisions/2026-08-04-frontend-state-and-api-contract.md) |
| Subscription loses events or reorders snapshot/live | Current status reconnect depends on cursor replay and membership-aware revision facts. Tauri channels alone are not durable. | Database outbox; register/snapshot/replay/live protocol; bounded lag tests and forced resnapshot. [`../backend/apps/runs/consumers.py`](../backend/apps/runs/consumers.py) |
| Automation fires twice across crash windows | A state transition, run record, terminal launch, provider hook, and graph ledger cross database/process boundaries. | Predetermined IDs, transactional durable effect records, idempotent adapters, startup reconciliation, and duplicate-fact tests. [`../backend/apps/execution/signals.py`](../backend/apps/execution/signals.py), [`../backend/apps/terminals/reconciliation.py`](../backend/apps/terminals/reconciliation.py) |
| tmux/database/provider disagree | tmux is live authority while the database owns durable intent/history and provider hooks may arrive late. | Write an authority table for every state; preserve tmux names/IDs; inject crashes at each launch/cleanup boundary. [`../backend/apps/terminals/CONTEXT.md`](../backend/apps/terminals/CONTEXT.md) |
| Native viewer work is accidentally rewritten | The existing shell already embeds pinned libghostty and native/tmux viewer state. Replacing it adds unrelated platform risk. | Keep the native modules and narrow their application-service seam; remove only Python-backed lifecycle pieces. [`../studio/src-tauri/src/native_terminal/`](../studio/src-tauri/src/native_terminal/) |
| Filesystem/Git effects commit only halfway | Documents and worktrees have SQL plus external authority; a process crash can separate them. | Durable operation journal, authorized roots, idempotent operations, per-repo locks, startup rescan/reconciliation. [`../backend/apps/documents/`](../backend/apps/documents/), [`../backend/apps/worktrees/`](../backend/apps/worktrees/) |
| Existing data is mutated before incompatibility is known | There are 70 product migrations, historical installations, WAL state, and optional PostgreSQL. | Exact schema classifier, semantic read-only preflight, verified snapshot, known bridges only, unknown-schema refusal. [data-migration.md](data-migration.md) |
| Removing Python breaks MCP composition | The current 1,287-line Python service adds high-level behavior around generated SDK calls, not just transport. | Move composition into Rust application services first; make GraphQL/MCP thin projections; compare tool transcripts. [`../surfaces/worktracker-agent/api/service.py`](../surfaces/worktracker-agent/api/service.py) |
| Performance/regression in large trees | GraphQL relation loading and generated resolvers can create N+1 queries; status snapshots and execution graph reads can be large. | Query-count budgets, realistic tree fixtures, batched loaders, bounded page sizes, and startup/snapshot latency gates. |
| Dependency/toolchain instability | The reference uses release-candidate Seaography and tightly pinned versions. | Copy pins and generated drift checks; isolate transport/generator adaptations; schedule upgrades separately. The `tauri-graphql-template` repository's `Cargo.toml` |
| Sidecar gets removed before external behavior moves | Studio can work via TauRPC while provider-launched MCP/hooks still depend on Python and loopback auth. | Sidecar deletion is Phase 11, gated on real agent/MCP/hook packaged runs, not frontend completion. |

## Domain questions to settle while characterizing behavior

These are code-visible ambiguities where older documents or prior attempts do
not match current behavior:

1. **Revision meaning:** current `Issue.state_revision` advances for meaningful
   published field changes, despite its name and older state-only documents.
   Rename in GraphQL/Rust or preserve the name for compatibility?
   ([`../backend/worktracker/models/issue.py`](../backend/worktracker/models/issue.py))
2. **Event retention:** how long must cursors remain replayable, and what exact
   signal tells Studio/MCP to resnapshot after compaction?
3. **Automation identity:** is a transition occurrence permanently identified
   by work item + revision, a dedicated occurrence UUID, or another durable
   fact? Prior implementations differ.
4. **Terminal history:** which terminal/session states are user-visible history
   versus reconstructable runtime state? Are viewer leases always disposable?
5. **Graph-run resume:** after app restart, which run modes resume launching,
   which only reconcile, and which require user confirmation?
6. **Attachments/documents:** are all paths portable within one data directory,
   or must absolute paths survive machine/data-directory moves?
7. **Provider catalogue:** which parts are user state, seeded application data,
   or dynamically discovered host capability?
8. **Workspace singleton:** both prior designs assume one workspace, while the
   schema retains a model. Is this a durable product invariant or only current UI
   scope? ([`../backend/worktracker/models/workspace.py`](../backend/worktracker/models/workspace.py))

Resolve these in ADRs before their migration phase. Do not let generated schema
names settle domain meaning accidentally.

## Unknowns that require prototypes or measurements

- Whether Seaography can hide unsafe relations/mutators and still produce stable
  generated SDL for Ticketry's full schema.
- Whether TauRPC subscription cancellation/backpressure behaves correctly under
  app suspend, window reload, and long-running status bursts.
- Whether one SQLite connection budget handles UI reads, event replay, terminal
  reconciliation, and graph scheduling without busy-timeout regressions.
- How much of the prior `ticketry-rust` adoption code can be transplanted without
  bringing its omnibus SQL repository shape.
- Whether a maintained Rust MCP library matches the exact FastMCP transport and
  tool-schema expectations of the providers Ticketry launches.
- Packaged macOS behavior when in-process async tasks, MCP listener, tmux, native
  libghostty, updater/signing, and app termination interact.

Each unknown has a bounded proof in Phases 0–2 or 8–10. None requires committing
to another standalone backend.

## Explicitly rejected approaches

- **Resume `ticketry-rust` as-is:** it preserves child supervision and makes the
  final seam integration-last.
- **Resume `worktracker-rust` as-is:** it is a separate Loco product with a fresh
  incompatible schema and intentionally changed semantics.
- **Big-bang greenfield schema import:** it combines domain rewrite, schema
  transformation, transport change, and cutover in one untestable event.
- **Production dual-write:** failure reconciliation is harder than the migration
  and can trigger duplicate automation/local effects.
- **Keep Python only for MCP:** this retains Python packaging, process supervision,
  port/readiness/orphan behavior, and the generated Python SDK.
- **Expose every table through generated mutation CRUD:** it erases the service
  boundaries that protect Ticketry's invariants.
