# CODING-1555 native viewer selection failure evidence

Investigation: 2026-09-07
Story: CODING-1513
Log: `~/.config/ticketry/ticketry.log` (313,219 lines, 2026-08-30 to 2026-09-06)

## Result

The native viewer never failed to render. Every native render recovery the log
contains (3 of 3) was the viewer lease create losing a SQLite write race on
`state.db` with `database is locked`, after `native_terminal_attach` had already
succeeded. The recovery campaign then reloaded Studio. The fault owner is the
deferred `BEGIN` every mutation transaction starts with; the fix is
`BEGIN IMMEDIATE` for write transactions on the WAL command pool.

## Captured incidents

| | Incident A | Incident B |
| --- | --- | --- |
| App started | 2026-09-05 18:28:35Z (runtime `627d4a0e…`) | 2026-09-05 21:34:20Z (runtime `2fbe97c0…`) |
| Case | Later switch: runs `dba980d7…` and `0552e302…` were already rendered at 18:29:29; a third terminal was selected at 18:30:12 | First selection of a newly launched run, 7 min after launch; other live runs (`aedee6d2…`, `54539ca4…`) were emitting activity |
| Terminal session ID | `tmp_mtopuvn1_5` | `tmp_mtowi1pk_6` |
| Agent run ID | `dd3db669fdad92568436f24583a5bf41` | `15a1f73a5db9b4dfece92aadc014842f` |
| Native attach | 18:30:12.174 `terminal-viewer-attached` handle `viewer-a0c81fbf…`, 131×51 | 21:41:18.839 `terminal-viewer-attached` handle `viewer-57641b7d…`, 114×42 |
| Failure origin | `attach` (lifecycle catch after `viewerLease.acquire()`) | `attach` (same) |
| Reason | `Query Error: error returned from database: (code: 517) database is locked` | `Query Error: error returned from database: (code: 5) database is locked` |
| Concurrent writer | terminal_activity commits for the two rendered runs (18:29:29–18:29:30) | `agent_run.terminal_activity` and `agent_run.lifecycle` commits for `15a1f73a…` and `aedee6d2…` at 21:41:18.6–18.9 |
| Reload | `native render recovery refreshing studio {"attempt":0}` after 500 ms | Same; attempt 1 scheduled after reload, then cancelled by native presentation |
| Run / tmux after reload | Same run re-attached natively (`viewer-7348bdd4…`) | Same run re-attached natively |

A third recovery entry is incident B's post-reload attempt 1 for the same run.
No other reason string appears in the log, so no incident involved libghostty,
the PTY, geometry, or the lease storage wrapper.

Reproduction cases requested by the story, as observed in the log rather than in
a new interactive capture: first selection after launch (B), later switch with
two live runs (A), reopened terminal (both incidents re-attached the same run
after the reload with no new run or tmux session). No new desktop session was
driven during this investigation; the two production captures above already
carry the origin, error, handle, run ID, session ID and reload cause.

## Trace to the shared owner

1. `nativeViewerLifecycle.ts` attach: `native_terminal_attach` succeeds, then
   `viewerLease.acquire()` runs the `create_viewer_lease` GraphQL mutation.
2. seaolim `register_restricted_model_mutation` opens `database.begin()` — a
   deferred `BEGIN` — then calls `prepare_create_write`, which reads the agent
   run, terminal session, project and current lease through that transaction,
   then inserts or updates the lease row.
3. `state.db` runs in WAL mode with an 8-connection pool. Another pooled
   connection commits an activity or lifecycle event between the read and the
   write. SQLite refuses the read-to-write upgrade at once: 517
   (`SQLITE_BUSY_SNAPSHOT`) when the snapshot is stale, 5 (`SQLITE_BUSY`) when
   the writer is still active. The busy handler is skipped on upgrade, so the
   pool's 5 s busy timeout never applies.
4. The bare `DbErr` escapes with `?`. It carries no `viewer_lease_storage_failed`
   code and not the `viewer ownership storage failed:` prefix, so
   `nativeFailureIsViewerOwnershipStorage` does not match and
   `reportNativeRenderFailure` schedules the reload.

The reason string is the discriminator: Ticketry's own lease service wraps every
database error, so an unwrapped `Query Error:` can only come from the library
transaction.

## Fix

`ticketry_work_management::begin_write` starts write transactions on the command
pool with `BEGIN IMMEDIATE`. The viewer ownership service uses it for its three
lease transactions (Tauri xterm and development adapter paths). The GraphQL
path's transaction is opened inside seaolim; the same helper and its seven call
sites are handed to that repository on CODING-1513, followed by a `rev` bump
here. No timing delay, first-terminal case, new run, or replacement tmux session
is involved.

Regression check:

```sh
cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-work-management --lib database::tests
```

`write_transaction_that_reads_first_commits_after_a_concurrent_write` fails with
code 517 when `begin_write` is replaced by `begin()` and passes with the fix.

### GraphQL path (CODING-1564)

Upstream seaolim `main` is still at `29f2417`, so the deferred `begin()` in
`register_restricted_model_mutation` remains. The three Viewer Lease views
(`terminal/viewer_lease/views/write_lock.rs`) now reserve SQLite's write lock as
the first statement of `prepare`, before any read, which lets the busy handler
queue behind a concurrent writer exactly as `BEGIN IMMEDIATE` does. When seaolim
opens the transaction immediately, this reservation becomes a no-op and can be
removed with the `rev` bump.

Regression check for the product path:

```sh
cargo test --manifest-path studio/src-tauri/Cargo.toml --test viewer_ownership graphql_create_viewer_lease_waits
```

`graphql_create_viewer_lease_waits_for_a_concurrent_writer_instead_of_failing`
runs `create_viewer_lease` through the assembled GraphQL schema on a WAL command
pool while a second pool holds and then commits a write transaction. It fails
with `(code: 5) database is locked` without the reservation and passes with it.

## Observations outside this ticket

- `reportPendingStudioReload` never wrote `[studio-reload] previous document was
  reloaded` to the file log for either incident, so the persisted reload
  evidence did not reach operators.
- About 90 other `.begin()` sites in Ticketry crates share the deferred policy.
