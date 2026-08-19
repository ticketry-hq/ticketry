# Desktop Shell

The Rust shell that packages Studio as a desktop application. It owns the
local data directory, starts and supervises the local services Studio depends
on, and publishes a single health signal to the webview.

## Rust migration recovery handoff (2026-08-13)

The `rust-migration` branch is recovering from an implementation drift in the
SeaORM/Seaography migration. The ratified architecture called for migrations to
produce generated SeaORM entities and generated Seaography model CRUD, with
custom code limited to Ticketry invariants. The first implementation proved
that chain only with `migration_probes`, then hand-authored the real Ticketry
entities, GraphQL output types, ordinary read resolvers, repositories, and
mutations. Do not extend those handwritten layers.

The recovery decisions are:

1. Generated SeaORM entities and Seaography queries, filtering, ordering,
   pagination, inputs, outputs, and ordinary CRUD are the default.
2. Public writes bind a concrete identity and allowlist caller-writable fields.
   If raw generated CRUD would bypass an invariant, keep it private and expose
   one restricted model-shaped create/update/delete seam. Do not replace model
   CRUD with per-field or per-relationship RPCs.
3. While Django owns a table, generate its entity cohort from a clean database
   at the current Django migration leaf. After Rust becomes sole writer, future
   schema changes and entity generation start from SeaORM migrations.
4. Replace mutually-referential entities as cohorts after mechanical parity
   comparison. Delete the matching handwritten types, ordinary resolvers, and
   pass-through repositories after their parity tests pass.
5. DRF-shaped GraphQL projections are temporary caller-compatibility adapters,
   not the permanent model/query architecture.

Current recovery state:

- The Rust source has been mechanically reorganized to the Seaography-style
  `src/entities/`, `src/query_root.rs`, and
  `src/query_root/{queries,mutations,types}` boundaries. Generation and drift
  scripts point at the new foundation-entity location.
- A clean SQLite database created by the current Django migration chain was
  successfully introspected with `sea-orm-cli generate entity --seaography`.
- Generated and handwritten WorkTracker entities describe broadly the same
  physical schema, so salvage is viable. They are not safe for blind
  replacement yet: Django SQLite `bool`, `datetime`, and JSON declarations
  generate as ignored `String` fields; integer widths differ; generated
  relationship names are database-derived rather than semantic; and generated
  metadata includes keys/actions omitted by some handwritten mappings.
- `app_settings` was a byte-for-byte match and has been replaced by the
  generated entity at `src/entities/settings/app_settings.rs`.
- The remaining WorkTracker cohort is still the compatibility mapping pending
  deterministic generation normalization. Rust-owned tables such as transition
  occurrences and launch-policy decisions/rejections are absent from the
  Django-generated cohort and must be generated from their Rust-owned schema.
- `cargo check --locked`, formatting, generated-artifact drift, and focused
  GraphQL/database parity tests passed after the structural move. The broad
  library suite passed 149/150; the remaining
  `append_description_serializes_read_modify_write` case fails with SQLite
  `database is locked` and is not evidence of a module-move failure.
- Preserve the pre-existing uncommitted edit in
  `tests/agent_run_lifecycle.rs`; it is not part of this recovery cleanup.

The next task is to make entity generation type-correct and reproducible, not
to port another feature. Build one deterministic, schema-driven normalization
step for the generated Django-owned cohort; prove every boolean, datetime,
JSON, integer-width, key, and relationship correction; reject unknown custom
SQLite types; and byte-compare the result in the drift check. Generate into
scratch and compare before replacing any current WorkTracker entity. Never
hand-edit a generated entity as the solution.

The governing documents are
[`../../rust-migration/migration-strategy.md`](../../rust-migration/migration-strategy.md),
[`../../rust-migration/template-architecture.md`](../../rust-migration/template-architecture.md),
[`../../rust-migration/data-migration.md`](../../rust-migration/data-migration.md),
and
[`../../rust-migration/risks-open-questions.md`](../../rust-migration/risks-open-questions.md).

## Language

**Sidecar**:
A local service process the desktop shell spawns and reaps by owned `Child`
handle. There are exactly two: the backend and the MCP service, both modes of
one packaged multi-call executable.
_Avoid_: Server, subprocess, daemon, child

**Supervised pair**:
The backend and MCP sidecars taken as one unit. They start together, stop
together, and recover together; neither is meaningful to the desktop shell
alone.
_Avoid_: Services, the stack, backend and friends

**Owned backend**:
A sidecar the desktop shell spawned itself, holding the data-directory lock
for the application's lifetime. Only an owned backend may be supervised.
_Avoid_: Local backend, our backend

**Development stack**:
An already-running `pnpm dev` backend that the desktop shell deliberately
attaches to instead of spawning its own. The shell holds no lock, owns no
process, and performs no supervision against it.
_Avoid_: Attached backend, dev mode, connect backend

**Pinned port**:
The loopback port a sidecar was first assigned, remembered and rebound on
every subsequent spawn so that URLs already handed out stay valid.
_Avoid_: Fixed port, static port, reserved port

**Recovery**:
The shell's unattended replacement of the supervised pair after one of them is
found dead, ending either in a healthy pair on its pinned ports or in a
give-up. Distinct from a launch, which happens once at startup.
_Avoid_: Restart, respawn, auto-heal, repair

**Wedged**:
A sidecar whose process is alive but no longer serving — the condition that
process-exit detection cannot see and only a liveness probe reveals.
_Avoid_: Hung, stuck, unresponsive, zombie

**Restart budget**:
The bounded number of recovery attempts available before the shell gives up,
and the healthy interval after which that allowance is restored.
_Avoid_: Retry limit, restart count

**Give-up**:
The terminal outcome of an exhausted restart budget: the pair is left stopped
and the failure is published to the webview with a log pointer. Only an
explicit user action rearms the shell.
_Avoid_: Fatal error, crash, dead state

**Readiness line**:
The structured line a sidecar writes to stdout to declare itself serving on a
port. It is the sole readiness signal; a running process is not a ready one.
_Avoid_: Startup log, ready signal, health line

**Packaged posture**:
The configuration a sidecar runs under when launched from a bundled
application: debug off, a persisted per-install secret, loopback-only allowed
hosts, and no administrative surface. Deliberately not the development
posture, and asserted by the packaged entry point rather than inherited from
settings.
_Avoid_: Production mode, release config, prod settings

**Migration failure**:
A terminal startup outcome in which the sidecar could not bring the state
database to the schema it needs. It is distinct from a crash because it is
deterministic, so it consumes no restart budget and goes straight to a
give-up.
_Avoid_: Migration error, schema crash, bad database

**Pre-migration snapshot**:
The checkpointed copy of the state database taken before a schema-changing
migration runs, retained for a bounded number of generations. It is the only
artefact a forward migration can be recovered from.
_Avoid_: Backup, dump, database copy

**Sidecar log**:
The size-capped, rotating, secret-redacted file under the data directory that
captured sidecar output is written to. It is what a give-up's log pointer
names, and it outlives the process that produced it.
_Avoid_: Log buffer, output capture, stderr file

**Service health**:
The small, stable state the shell publishes to the webview — starting,
migrating, ready, recovering, degraded, or failed. It deliberately carries no
process names, ports, exit codes, or credentials.
_Avoid_: Supervisor state, status event, process status
