# Backend Rust Migration Review

This is the durable review record for
[`ticketry-rust-taurpc-transition-blueprint.md`](./ticketry-rust-taurpc-transition-blueprint.md).
Keep it current as the blueprint changes so future implementation and review
passes do not have to rediscover the same product and architecture questions.

## Review baseline

- Review date: 2026-08-08
- Reviewed blueprint SHA-256:
  `8a70ab8bd73809f0a5d415496a9df7b58299a71f6dc6f724d9cbc6e6ac2c3b5b`
- Review axes: repository standards and implementation/specification completeness
- Status at capture: all findings below are open
- Severity:
  - **P1** — resolve before implementation starts
  - **P2** — resolve before the affected implementation phase starts
  - **P3** — minor issue that should be fixed with the next document edit

When resolving a finding, retain the finding and append a short resolution note,
the blueprint section or decision record that resolves it, and the relevant test
or verification evidence. Do not delete findings merely because implementation
has started.

## Repository-standards findings

### ST-01 — Preserve the native terminal boundary (P1, open)

The blueprint routes terminal frames through a Tauri IPC channel and says the
client writes them to the xterm/native renderer. This conflicts with the root
[`AGENTS.md`](../../AGENTS.md), which requires the native renderer to retain the
pinned libghostty C-API boundary while tmux owns durable sessions. The current
native path connects libghostty directly to the Rust `TmuxViewer` PTY in
[`studio/src-tauri/src/native_terminal.rs`](../../studio/src-tauri/src/native_terminal.rs).

Required resolution:

- Make the native-versus-fallback split normative.
- Keep native libghostty on the direct Rust/PTTY path.
- Use the bounded Tauri channel only for the xterm/webview fallback.
- Preserve the libghostty revision pin and C bridge in
  [`studio/src-tauri/build.rs`](../../studio/src-tauri/build.rs).
- Make the Phase 1 streaming spike exercise both renderer paths.

### ST-02 — Decide the supported PostgreSQL contract (P1, open)

The blueprint treats an existing SQLite database as the only canonical data
contract while promising whole-application parity. The current application
supports opted-in PostgreSQL for source development and installed deployments in
[`backend/studio_server/database.py`](../../backend/studio_server/database.py).

Required resolution: choose and document one of these product decisions before
schema work begins:

1. Support both SQLite and PostgreSQL in the Rust runtime; or
2. Deliberately retire PostgreSQL and define a PostgreSQL-to-SQLite export,
   validation, cutover, rollback, and failure-recovery procedure.

A copied SQLite fixture cannot prove PostgreSQL parity for constraints, locking,
or existing PostgreSQL-backed user data.

### ST-03 — Carry the Tauri capability model into TauRPC (P1, open)

The current Tauri application explicitly enumerates native commands in
[`studio/src-tauri/build.rs`](../../studio/src-tauri/build.rs) and grants them
only to the local main window in
[`studio/src-tauri/capabilities/studio-main.json`](../../studio/src-tauri/capabilities/studio-main.json).
The blueprint exposes filesystem, process, terminal, Git, and data operations
through TauRPC without defining how this least-privilege boundary is retained.

Required resolution:

- Produce a procedure-to-capability manifest.
- Restrict procedures to the intended local window/webview.
- Define scopes and authorization checks for file, Git, terminal, executable,
  worktree, and document operations.
- Prove that TauRPC and the existing native command handler are composed into a
  single Tauri invoke handler. Tauri uses only the last registered invoke
  handler.
- Add negative tests showing an unauthorized window or scope cannot invoke a
  sensitive procedure.

Primary references:

- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri calling Rust](https://v2.tauri.app/develop/calling-rust/)

### ST-04 — Encode the repository handoff gates exactly (P1, open)

The blueprint currently requires the "current Studio acceptance suite," but the
root [`AGENTS.md`](../../AGENTS.md) is more specific. Every visible Studio
behavior change must add or update an automated
`studio/src/test/*Acceptance.test.tsx` case, keep the numbered overhaul gate
current, and run:

```text
npm run test:overhaul --workspace @worktracker/studio
```

The Rust worktree must also update its root instructions when it removes the
Python sidecar, while retaining `npm run desktop:dev` and `pnpm run dev` as the
normal root entrypoints and keeping development data isolated from live data.

Required resolution: add these requirements verbatim to the hard acceptance and
final handoff gates.

### ST-05 — Make transaction ownership match the dependency graph (P2, open)

The blueprint says controllers own transaction scope, persistence owns
transaction primitives, and the controller example calls `app.db.transaction`.
The fixed dependency diagram has no controller-to-persistence edge.

Required resolution: either add the dependency explicitly or define a named
transaction-runner interface and its owning crate. The implementation must not
invent multiple incompatible transaction abstractions.

### ST-06 — Lock the MCP process topology (P2, open)

The blueprint says Tauri is the sole composition root and all SQLite writes pass
through one in-process writer, but leaves MCP embedded-versus-companion mode
open. A companion process cannot both invoke controllers directly and share an
in-process writer without an additional boundary.

Required resolution: either lock MCP to embedded mode or define the companion's
private IPC, authentication, controller composition, database ownership,
single-writer participation, startup, shutdown, and recovery behavior.

## Specification-completeness findings

### SP-01 — Migrate and protect the complete durable data envelope (P1, open)

The safe-copy protocol covers SQLite only. Current durable state also includes:

- attachments under `MEDIA_ROOT` in
  [`backend/studio_server/settings.py`](../../backend/studio_server/settings.py);
- profiles and feature settings in
  [`backend/apps/settings_store/config.py`](../../backend/apps/settings_store/config.py);
- registered document roots and other filesystem-backed state referenced by the
  database.

The current runtime also has an exclusive data-directory lease in
[`studio/src-tauri/src/ownership.rs`](../../studio/src-tauri/src/ownership.rs)
and creates pre-migration database snapshots in
[`backend/packaging/sidecar.py`](../../backend/packaging/sidecar.py).

Required resolution:

- Create a versioned manifest of every durable file and external root.
- Specify a consistent copy/cutover procedure, permissions, referential checks,
  content digests, and rollback for the complete envelope.
- Retain the exclusive data-directory lease as a hard startup gate.
- Create a recoverable pre-mutation snapshot before schema adoption or migration.
- Test interrupted cutover and rollback using disposable real-data copies.

### SP-02 — Preserve omitted-versus-null PATCH semantics (P1, open)

The example `UpdateWorkItemInput` uses `Option<T>`, which cannot distinguish an
omitted field from an explicit `null`. Current PATCH inputs in
[`backend/worktracker/rest/serializers.py`](../../backend/worktracker/rest/serializers.py)
allow both states, and the service in
[`backend/worktracker/services/work_items.py`](../../backend/worktracker/services/work_items.py)
branches on field presence.

Required resolution:

- Define a checked `Unset | Null | Value(T)` wire codec for nullable patch fields.
- Derive required, optional, and nullable behavior from the current serializer
  and service contract field by field.
- Remove mandatory `expected_revision` from ordinary updates unless introducing
  it is approved as a deliberate behavior change.
- Add differential cases for omitted, null, empty, unchanged, and invalid values.

### SP-03 — Eliminate the subscribe/snapshot race (P1, open)

Registering a listener and then independently fetching a snapshot can allow an
event to arrive while an older snapshot is being assembled; applying that
snapshot afterward can overwrite the newer event. The current WebSocket path
joins the group before capturing a bounded cursor and replay in
[`backend/apps/runs/consumers.py`](../../backend/apps/runs/consumers.py) and
[`backend/apps/runs/projections.py`](../../backend/apps/runs/projections.py).

Required resolution: use an atomic snapshot-plus-cursor handshake or buffer
events until the snapshot cursor is installed. Add mutation-during-subscription,
reconnect, cursor-gap, deletion, and non-state-edit race tests for every stateful
event family.

### SP-04 — Assign external agent lifecycle ingress (P1, open)

Launched agent processes currently receive a lifecycle URL from
[`backend/apps/terminals/launch.py`](../../backend/apps/terminals/launch.py), and
hooks report lifecycle events through
[`backend/apps/terminals/agents/hooks/_reporter.py`](../../backend/apps/terminals/agents/hooks/_reporter.py).
Packaged sandboxes use the native spool consumed by
[`backend/apps/runs/hook_spool.py`](../../backend/apps/runs/hook_spool.py).
These child processes cannot call a webview-only TauRPC endpoint.

Required resolution: define a non-webview ingress such as the existing native
spool or an authenticated local socket. Specify identity validation, file/socket
permissions, size limits, deduplication, ordering, failure isolation, recovery,
and terminal self-termination behavior. Do not conflate this with MCP.

### SP-05 — Define document and attachment binary delivery (P1, open)

The current document viewer loads a navigable iframe URL in
[`studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx`](../../studio/src/app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx).
The backend serves the document and relative assets with explicit media/security
headers in [`backend/apps/rest_api.py`](../../backend/apps/rest_api.py), after
root, traversal, symlink, and media-type checks in
[`backend/apps/documents/service.py`](../../backend/apps/documents/service.py).
A TauRPC result by itself is not a navigable iframe source.

Required resolution:

- Define a locked Tauri custom URI/asset protocol for document HTML and relative
  assets, or another equally narrow navigable boundary.
- Preserve registered-root authorization, traversal and symlink protection,
  media allowlists, CSP/sandbox behavior, cache semantics, and uniform errors.
- Define binary attachment upload/read streaming, size limits, cancellation, and
  failure behavior.

### SP-06 — Specify post-commit external-effect semantics (P1, open)

The proposed controller sequence commits durable state and then executes terminal,
Git, filesystem, document, or agent effects. If an effect fails after commit, a
caller may receive an error even though durable state changed, then retry or roll
back optimistic UI incorrectly.

Required resolution: create a matrix for each external-effect family defining:

- durable intent and outcome states;
- idempotency key and duplicate handling;
- procedure success/error receipt;
- event publication timing;
- retry limits and backoff;
- compensation or reconciliation behavior;
- restart/crash recovery; and
- matching frontend optimistic-update behavior.

### SP-07 — Freeze the exact operation manifest in Phase 0 (P2, open)

The complete REST/SDK/MCP/React operation manifest is currently an
implementation-time check. Whole-application parity cannot be measured until
this manifest exists.

Required resolution: make a versioned traceability matrix a Phase 0 exit
artifact with one row per operation:

```text
current route/call site/tool
  -> controller operation
  -> TauRPC, MCP, or approved custom protocol
  -> result/error contract
  -> parity scenarios
  -> Studio acceptance case where user-visible
```

No capability is complete until its row has implementation and green evidence.

### SP-08 — Fix the Markdown EOF check (P3, open)

`git diff --no-index --check` reports a blank line at the end of the blueprint.
Remove it with the next blueprint edit.

## Confirmed strengths to preserve

The following blueprint decisions materially reduce migration risk and should
not regress while resolving the findings:

- SQLite writes are serialized through one owned writer with explicit busy
  handling.
- The parity harness must first prove Django-versus-Django determinism.
- Every phase leaves an independently verifiable checkpoint and reports the last
  fully green phase if interrupted.
- TauRPC procedures, typed events, generated TypeScript, and sustained terminal
  streaming are front-loaded into a mandatory pinned-version spike.
- Events are notifications, while snapshots remain authoritative.
- MCP and TauRPC share controllers but never invoke one another.
- Django remains an untouched behavioral oracle and rollback version.

Primary technical references:

- [TauRPC documentation](https://docs.rs/taurpc/latest/taurpc/)
- [Tauri frontend communication and channels](https://v2.tauri.app/develop/calling-frontend/)

## Re-review checklist

Before approving the blueprint for implementation, verify all of the following:

- [ ] Every P1 finding has a documented resolution and testable acceptance rule.
- [ ] PostgreSQL support or retirement is an explicit product decision.
- [ ] Native libghostty and xterm fallback paths are specified separately.
- [ ] TauRPC procedures are covered by Tauri capabilities and one composed invoke
      handler.
- [ ] The full data envelope, exclusive lease, snapshot, rollback, and recovery
      flow are specified.
- [ ] PATCH contracts preserve absent/null/value behavior.
- [ ] Event subscription has a race-free cursor or buffering handshake.
- [ ] External agent lifecycle ingress is assigned to a non-webview boundary.
- [ ] Document iframe assets and binary attachments have a narrow authorized
      delivery protocol.
- [ ] Every post-commit effect has durable outcome and retry semantics.
- [ ] The operation traceability matrix is a Phase 0 artifact.
- [ ] Root development commands, data isolation, acceptance-test updates, the
      numbered overhaul gate, and the exact overhaul test command are hard gates.
- [ ] The reviewed blueprint hash above is updated after material edits, and
      resolved findings cite the new sections and evidence.
