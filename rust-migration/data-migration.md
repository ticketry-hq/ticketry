# Data migration and persistence ownership

## Recommendation

Adopt Ticketry's existing product schema **in place** for the default SQLite
installation, preserving table names, columns, IDs, ranks, revisions, and
relationships. Rust should become the next migration owner after it proves it
can classify and open every supported Django schema generation. Do not start
with a clean greenfield schema and attempt a late semantic import.

This recommendation is supported by the strongest artifact in the larger prior
attempt: its Django-schema manifest, 47 database fixtures, historical bridges,
semantic preflight, snapshots, restore tests, and in-place adoption flow
(in that attempt's local `ticketry-rust` checkout: `crates/muxed-adapter-sqlite/src/`,
`tests/parity/databases/`, and
`docs/adr/0018-rust-adopts-the-existing-product-schema-in-place.md`).
Port and revalidate those artifacts rather than redesigning this part.

The production migration strategy must still obey a hard rule: at any given app
version, each table/capability has one writer. Differential testing uses copied,
isolated databases; it is never production dual-write.

## Current storage behavior

Ticketry defaults to SQLite at the configured data directory's `state.db`. The
connection enables foreign keys, WAL, and a five-second busy timeout
([`../backend/studio_server/database.py`](../backend/studio_server/database.py),
[`../backend/studio_server/settings.py`](../backend/studio_server/settings.py)).
An explicit marker/gate can instead select PostgreSQL. The README describes the
PostgreSQL option as shared local development while keeping packaged and
development state isolated by default ([`../README.md`](../README.md)).

The Python multicall sidecar currently performs important safety work before
serving:

- configures one owned data directory and state database;
- checkpoints SQLite WAL and rotates three pre-migration snapshots;
- performs SQLite integrity checks;
- obtains a PostgreSQL advisory lock when applicable;
- applies Django migrations and provisions required data; and
- configures hook-spool, media, authentication, and MCP state.

Those behaviors live in
[`../backend/sidecar_packaging/sidecar.py`](../backend/sidecar_packaging/sidecar.py) and are
product requirements, not Python implementation details. Tauri already owns the
data-directory lease/marker and must remain the outer authority
([`../studio/src-tauri/src/ownership.rs`](../studio/src-tauri/src/ownership.rs)).

Not all state is in SQL. Attachments/media, design documents, profiles and
feature JSON, logs, the hook spool, worktree directories, and tmux sessions live
in or beside the data directory
([`../backend/apps/settings_store/config.py`](../backend/apps/settings_store/config.py),
[`../backend/apps/documents/`](../backend/apps/documents/),
[`../backend/apps/terminals/`](../backend/apps/terminals/)). Migration must treat
their paths and durable IDs as part of the same installation.

## Ownership model during implementation

Use three distinct environments:

1. **Current production path:** Django remains the only writer until a feature
   is explicitly switched. Rust may inspect a copied database but does not
   shadow-write live state.
2. **Differential path:** a fixture or snapshot is cloned into two isolated
   stores. The same characterized operation runs through Django and Rust, then
   normalized output, rows, revisions, events, and effects are compared.
3. **Cutover path:** after preflight and a recoverable snapshot, the release
   starts with Rust as sole writer. Python never opens that installation again
   unless an explicit rollback/import procedure is used.

A limited vertical strangler may transfer whole low-coupling tables before the
final cutover, but only if Django has no remaining write path or migration that
touches them. The safer default is to land migrated Rust slices behind test or
developer gates, keep Django authoritative in shipping builds, and perform one
database-writer handoff after complete schema/effect parity. This is a single
persistence handoff, not a big-bang implementation.

## Schema adoption sequence

Entity recovery and migration ownership are separate steps. Before cutover,
build a clean database from the current Django migration chain and generate the
Django-owned entity cohort from it; this prevents handwritten Rust structure
from becoming a competing schema source. After parity and the writer handoff,
establish the equivalent SeaORM migration baseline below and generate all
future entity changes from SeaORM migrations. Both paths must produce the same
accepted entity and schema artifacts at the handoff boundary.

### 1. Freeze and classify supported inputs

Create a checked manifest for every product table, column, index, foreign key,
and relevant Django migration generation. Include WorkTracker and all six
capability apps; the current tree has 70 product migration files
([`../backend/worktracker/migrations/`](../backend/worktracker/migrations/),
[`../backend/apps/`](../backend/apps/)).

Classify an installation as exactly one of:

- current and directly adoptable;
- known historical and bridgeable;
- already Rust-owned;
- empty and provisionable; or
- unknown/incompatible, which must fail without mutation.

Seed these tests with the prior attempt's 47 fixtures, then add any Django
generations and dirty working-tree migrations absent from that fork. The source
of truth is current Ticketry migrations and model metadata, not the old fixture
manifest.

### 2. Establish a Rust migration baseline

Write reversible SeaORM migrations that reproduce the adopted physical schema,
including existing Django table names and join tables. Generate entities from a
clean application of those migrations, following the template's deterministic
chain
(the `tauri-graphql-template` repository's `docs/adding-a-model.md`).

When opening an adopted installation, record a Rust schema ledger without
renaming or recreating product rows. Keep `django_migrations` inert as provenance;
Rust must never ask Django to migrate the same database after ownership changes.
Future schema changes are Rust migrations only.

### 3. Run semantic preflight

Before any mutation, verify at least:

- SQLite integrity and foreign-key checks;
- exact known schema generation and migration-ledger consistency;
- unique project identifiers and valid `seq_counter` bounds;
- valid issue project/type/state/parent/module relationships;
- issue-type level versus module/task hierarchy;
- blocker endpoints and self/cycle policy;
- transition/start-state/launch-binding relationships;
- project and issue revision monotonicity;
- graph-run, launch-ledger, run, attempt, and terminal references;
- authorized attachment/document/worktree paths; and
- tmux names/runtime namespaces are syntactically safe.

The preflight reports actionable counts/IDs and performs no repair implicitly.
Known historical defects need named, tested bridge transforms. Unknown defects
stop the migration.

### 4. Snapshot before mutation

For SQLite, acquire the installation lease, stop all writers, checkpoint WAL,
copy the database and sidecars consistently, hash the snapshot, and verify the
copy opens and passes integrity checks. Keep a rotation at least as strong as
the current three-generation policy
([`../backend/sidecar_packaging/sidecar.py`](../backend/sidecar_packaging/sidecar.py)).

Do not duplicate bulk attachments, worktrees, or tmux state. Instead, record a
cutover manifest of their root paths and relevant identifiers, and leave them in
place. Profiles/features JSON should be snapshotted because they are small and
affect startup behavior.

### 5. Apply known bridges and Rust ledger transactionally

Apply bridge transforms and the Rust baseline in one controlled startup phase.
Record source schema fingerprint, application version, backup path/hash,
transform IDs, row counts, and completion state. A crash before commit must
leave the source database reusable; a crash after commit must be recognized as
Rust-owned and continue idempotently.

Do not regenerate UUIDs. Preserve:

- workspace/project/work-item/catalogue IDs and human sequence IDs;
- parent/module/blocker/type/state relationships;
- fractional rank strings and manual module order;
- project and item revisions;
- graph/run/attempt/terminal/worktree/document IDs;
- tmux session names and runtime namespaces; and
- timestamps where they affect ordering or audit behavior.

### 6. Provision derived Rust state

Some new Rust tables are not direct Django copies: durable application event
outbox, launch/effect journal, reconciliation journal, and migration manifest.
Create them without replaying historical side effects. The first Rust session
publishes an authoritative snapshot at a new event boundary; it must not emit
automation triggers for historical transitions.

Viewer leases are ephemeral and may be expired at cutover. Durable terminal
session/run rows and tmux names are preserved, then startup reconciliation asks
tmux what is actually live. Missing sessions are marked through normal
reconciliation, not bulk migration assumptions
([`../backend/apps/terminals/reconciliation.py`](../backend/apps/terminals/reconciliation.py)).

### 7. Validate after adoption

Compare pre/post row counts and stable field digests for every product table,
then rerun foreign-key and semantic checks. Execute read-only golden queries for
representative project trees, workflows, dependency graphs, graph runs,
terminal resumability, documents, and worktrees. Only after all gates pass may
the application publish readiness and allow mutations.

## PostgreSQL decision

The template proves SQLite, while current Ticketry can opt into PostgreSQL. The
recommended product direction is:

- make SQLite the sole Rust-owned desktop database;
- treat PostgreSQL as a supported **import source** for existing installations;
- stream a consistent PostgreSQL snapshot into a new SQLite database in the
  same canonical schema;
- run the same logical digest and invariant checks; and
- leave PostgreSQL untouched as the rollback source.

This removes a concurrency/deployment mode that is at odds with a single-user,
in-process desktop store and keeps the first Rust release inside the template's
tested boundary. It is a product compatibility decision, not an engineering
fait accompli. If shared PostgreSQL remains required, every repository,
migration, transaction/isolation rule, lock, and differential suite must run
against both engines; SeaORM support alone is not sufficient evidence. The
larger prior attempt chose SQLite-only in-place adoption, while the smaller
`worktracker-rust` demonstrates SeaORM on both SQLite and PostgreSQL but not
Ticketry schema compatibility
([prior-attempts-postmortem.md](prior-attempts-postmortem.md)).

## Rollback policy

There are two safe rollback windows:

1. **Before Rust readiness:** restore/use the verified source snapshot because
   no Rust mutation was accepted.
2. **After Rust mutations begin:** automatic rollback to Django is unsafe. The
   old snapshot would discard new work, and the new Rust schema may contain
   facts Django cannot understand.

Therefore the migration UI must state the point of no automatic return. A true
post-write rollback requires a separately designed and tested Rust-to-Django
export or accepting loss of post-cutover changes. Do not promise downgrade
compatibility implicitly. Retain the source snapshot and manifest for manual
recovery, with sensitive paths/secrets excluded from logs.

## Acceptance evidence

Data ownership can cut over only when CI/release fixtures prove:

- every supported current/historical SQLite generation classifies correctly;
- unknown schemas fail before mutation;
- interrupted adoption resumes or restores deterministically;
- WAL-backed snapshots are consistent;
- IDs, ranks, revisions, and cross-feature relationships survive;
- no historical automation or launch effect is replayed;
- active/missing tmux sessions reconcile correctly;
- PostgreSQL import works, or PostgreSQL is explicitly declared unsupported;
- a migrated database reopens across restart; and
- backup discovery and manual recovery instructions are tested.

Use the larger prior attempt's fixture corpus and evidence scripts as inputs,
but wire scenarios to the actual Django and in-process Rust implementations;
its documented parity runner did not yet execute full concrete Python-versus-Rust
WorkTracker transcripts ([prior-attempts-postmortem.md](prior-attempts-postmortem.md)).
