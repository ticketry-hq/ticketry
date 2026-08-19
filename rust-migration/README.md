# Ticketry Rust migration research

## Recommendation

Move Ticketry's backend into the existing Tauri process, using the
`tauri-graphql-template` transport and generation chain as the starting point,
with generated SeaORM entities and generated Seaography model CRUD as the
default. Keep only the validation, locking, derived-field repair, cascades, and
effects required by Ticketry invariants behind restricted model-shaped write
seams.

The target is one Rust application core with three adapters:

1. GraphQL over TauRPC for Studio;
2. Tauri commands for native window, terminal, and host-only operations; and
3. an in-process Rust MCP listener for external agents.

This is a **vertical, in-process strangler**, not a rewrite deployed as another
sidecar. Work in a git worktree of this repository on branch `rust-migration`,
build and dogfood one feature-owned Rust slice at a time inside
`studio/src-tauri`, and give each table or capability exactly one production
writer. A separate repository or fresh application is explicitly rejected;
that integration-last shape is how the prior `ticketry-rust` attempt died.
Retire Python only after every remaining Studio, MCP, and execution path moves.

The current shell is already about 10,340 lines of Rust and owns data-directory
locking, sidecar supervision, tmux viewing, and native libghostty rendering
([`../studio/src-tauri/src/`](../studio/src-tauri/src/)). The migration keeps the
native terminal/runtime work and replaces the supervised Django/FastMCP child,
HTTP API, and Studio WebSockets with in-process services. This directly removes
the port, orphan-process, and readiness problems motivating the work
([`../studio/src-tauri/src/supervisor.rs`](../studio/src-tauri/src/supervisor.rs),
[`../backend/packaging/sidecar.py`](../backend/packaging/sidecar.py)).

## Target at a glance

```text
React Studio
    | generated GraphQL operations over one TauRPC endpoint
    v
Tauri process
    +-- feature-owned Rust application services
    |     +-- work management
    |     +-- settings and launch policy
    |     +-- events and run lifecycle
    |     +-- documents, worktrees, and terminals
    |     `-- dependency-graph execution
    +-- SeaORM/SQLite persistence and durable event/effect journals
    +-- existing tmux/libghostty native runtime
    `-- Rust MCP listener --> the same application services
```

GraphQL is an internal Studio projection, not the domain layer. MCP remains a
network-facing projection because external agent processes cannot invoke Tauri
IPC. The MCP listener lives in the Tauri process; it is not a separately
supervised executable.

## Recovery status (2026-08-13)

The first implementation proved database-driven generation only with a probe
table, then hand-authored the real Ticketry entities and much of the read/CRUD
surface. That broadened a legitimate custom-write exception into the default
architecture. Further feature migration is paused while that is corrected.

The Rust source now follows Seaography's top-level `entities` and `query_root`
shape. A clean database at the current Django migration leaf successfully
generates the real WorkTracker and settings entities. The comparison found that
the database model is broadly aligned, but Django's SQLite declarations require
deterministic correction of generated boolean, datetime, JSON, integer-width,
and relationship metadata before the WorkTracker cohort can be replaced safely.
The generated `app_settings` entity was a byte-for-byte match and is the first
replacement. See the recovery gate in
[migration-strategy.md](migration-strategy.md) and the pinned framework audit in
[seaography-hooks-audit.md](seaography-hooks-audit.md).

## Why neither prior attempt is the destination

`ticketry-rust` contains roughly 50,147 lines of Rust, strong database-adoption
fixtures, domain logic, reconciliation work, and frozen protocol inventories.
Its runtime nevertheless remains a supervised Rust child with HTTP and MCP
ports and defers integration until a one-shot total cutover. `worktracker-rust`
contains a cleaner pure WorkTracker core and transactional/outbox patterns, but
is a new standalone Loco HTTP product with an incompatible fresh schema and no
Ticketry execution/terminal/MCP control planes. The correct move is to transplant
verified artifacts from both into the in-process destination, not resume either
repository. See [prior-attempts-postmortem.md](prior-attempts-postmortem.md).

## How to read this folder

- [current-backend-inventory.md](current-backend-inventory.md) describes what
  exists and what Studio and MCP actually consume.
- [template-architecture.md](template-architecture.md) evaluates the template
  and defines the target Rust shape, including deliberate deviations.
- [prior-attempts-postmortem.md](prior-attempts-postmortem.md) is the salvage
  guide and failure analysis for both Rust repositories.
- [data-migration.md](data-migration.md) specifies adoption, validation,
  PostgreSQL handling, cutover, and rollback.
- [migration-strategy.md](migration-strategy.md) is the ratified vertical-slice
  sequence, its WorkTracker go/no-go point, and the gates for each cutover.
- [risks-open-questions.md](risks-open-questions.md) separates real risks from
  decisions that require product or compatibility policy.

## Governing principles

1. **Generate structure; port behavior.** While Django owns a table, build a
   clean database at the current Django migration leaf and generate its SeaORM
   entities from that database. After Rust takes ownership, generate from
   SeaORM migrations. Port only the domain behavior the database and Seaography
   cannot express; do not hand-author parallel models, ordinary CRUD resolvers,
   mirrored DTOs, or repository wrappers around generated SeaORM operations.
2. **Migrate behavior, not routes.** The 81 current OpenAPI operations and 30
   current MCP tools are evidence and compatibility inputs, not a mandate to
   reproduce HTTP internally ([`../openapi.json`](../openapi.json),
   [`../surfaces/worktracker-agent/api/tools.py`](../surfaces/worktracker-agent/api/tools.py),
   [`../surfaces/worktracker-agent/mcp/server.py`](../surfaces/worktracker-agent/mcp/server.py)).
3. **One holding place and one write authority.** Preserve the existing
   per-entity cache/revision model and never let Django and Rust concurrently
   own the same mutation path
   ([`../docs/decisions/2026-08-04-frontend-state-and-api-contract.md`](../docs/decisions/2026-08-04-frontend-state-and-api-contract.md),
   [`../docs/decisions/2026-08-06-one-holding-per-thing.md`](../docs/decisions/2026-08-06-one-holding-per-thing.md)).
4. **Generated CRUD is the default, not an authorization policy.** Begin with
   the generated model surface. Bind concrete identities and allowlist writable
   fields at the public boundary. Put ranking, transition gates, hierarchy,
   launch effects, and graph-run lifecycle behind the corresponding restricted
   model-shaped create/update/delete seam; generated mutators must not bypass
   them
   ([`../backend/worktracker/services/`](../backend/worktracker/services/),
   [`../backend/apps/execution/driver.py`](../backend/apps/execution/driver.py)).
5. **Durability precedes realtime.** Persist the event/effect fact before
   notifying GraphQL subscribers or launching local effects. Reconnect must be
   snapshot/replay/live, not best effort
   ([`../backend/apps/runs/consumers.py`](../backend/apps/runs/consumers.py),
   [`../backend/apps/runs/bus.py`](../backend/apps/runs/bus.py)).
6. **Preserve IDs and live authorities.** Existing UUIDs, sequence IDs, ranks,
   revisions, filesystem paths, tmux session names, and run relationships cross
   UI, database, filesystem, and process boundaries.
7. **Integrate continuously without moving the frontend.** Each existing
   feature's query/mutation folder is re-pointed from REST to generated GraphQL
   in the real Tauri composition, so both transports coexist during migration.
8. **Freeze Django after the foundation.** Once slice 0 passes, Python accepts
   critical fixes only, and each fix is flagged for re-porting.
9. **Gate on adoption, acceptance, and dogfood.** Preserve the complete
   [data-migration.md](data-migration.md) safety process, run the curated Studio
   acceptance suite plus targeted cases, then daily-drive a snapshot/copy of the
   real data directory for a couple of days before merge or release. There is
   no post-write downgrade promise.
10. **Replace generated cohorts, then delete duplication.** Generate into
    scratch space, compare columns, types, keys, and relations, and replace a
    mutually-referential entity cohort only when parity is proved. Remove its
    handwritten entities, ordinary read resolvers, mirrored types, and
    pass-through repositories in the same or immediately following change.

## Evidence and scope

The inventory was measured against the working tree on 2026-08-12. That tree
contains extensive pre-existing uncommitted work, so counts describe the files
read, not a release tag. All external repositories were inspected read-only.
No existing Ticketry file was changed as part of this research.
