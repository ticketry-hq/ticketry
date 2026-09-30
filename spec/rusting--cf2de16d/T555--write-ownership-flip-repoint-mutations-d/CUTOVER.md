# CODING-555 WorkTracker write cutover

## Ownership

The checked Rust manifest in
`studio/src-tauri/src/work_management/ownership_manifest.rs` is authoritative.
Rust owns Workspace onboarding, Projects, States, Issue Types, workflow edges,
launch bindings, WorkItems, blocker edges, attachments, and transition
occurrences. Provider/model/reasoning catalogues remain with the Django-owned
Settings capability until that capability's migration slice.

Studio desktop mutations execute authored GraphQL commands in process. Agent
WorkTracker mutations execute the same commands through the in-process Rust MCP
listener. Django returns `410 django_worktracker_write_disabled` from legacy
WorkTracker mutation routes, and the packaged Python MCP entry point refuses to
start when Rust ownership is enabled. Django-owned graph-run and launch effects
remain available through their narrow compatibility routes.

## Startup gate

Before either Rust transport is advertised, startup:

1. rejects PostgreSQL destinations, symlinked paths, unknown ownership ledgers,
   unknown owned-table shapes, failed integrity/foreign-key checks, and invalid
   cross-project relationships;
2. classifies the current Django leaf or an already Rust-owned database;
3. completes a truncating WAL checkpoint and rotates three private snapshots;
4. hashes and reopens the snapshot, then copies it to a restore candidate and
   verifies the same stable digest;
5. installs the transition-occurrence and ownership ledgers; and
6. rechecks schema, semantics, and the stable digest before enabling commands.

Evidence is written beside the database as `worktracker-cutover.json`. It names
the snapshot and SHA-256 digest without logging credentials.

## Recovery

Before the ownership ledger exists, a failed adoption may be recovered by
replacing `state.db` with the verified generation-one snapshot while Ticketry
is stopped. Preserve the failed database separately for diagnosis and remove
stale `state.db-wal`/`state.db-shm` sidecars before reopening the restored copy.

The ownership ledger's `write_enabled_at` is the point of no automatic return.
After that point, do **not** restore the pre-cutover snapshot or reopen the
installation with Django writes: either action can discard Rust-authored facts.
Retain the database, cutover evidence, snapshots, media root, and logs for
manual salvage. A Rust-to-Django downgrade/export is not supported by this
slice.

PostgreSQL installations are left untouched with an explicit compatibility
error. They require a separately acceptance-tested consistent import into the
canonical SQLite schema.
