# Full application code review — running findings

**Date:** 2026-08-10 · **Branch:** `tanstack-server-state` (includes uncommitted changes)
**Status:** ✅ Complete — 5 review areas, 40 findings (1 critical, 6 high), plus 6 failing backend tests.

## Executive summary

The application is structurally healthy: clean service/persistence/runtime seams in the backend, a carefully executed TanStack Query migration in the frontend, and an unusually least-privilege Tauri command surface. The defects cluster in three places — **unguarded input paths** (reparent cycles, tmux wildcard targets, unauthenticated lifecycle ingestion), **concurrency seams the designs acknowledge but don't close** (launch vs. reconciliation sweep, spawn vs. ledger record, dual signal receivers, post-await store reads), and **failure/teardown paths** (viewer worker panic, shutdown use-after-frees).

**Fix before merge:**
1. 🔴 Self/descendant reparent infinite loop — `worktracker/services/work_items.py:371` (one guard + one `seen` set)
2. 🔴 6 failing backend tests — workflow seed drift (`Ideas` state, duplicated states), cancel-cascade regression, state-DB adoption
3. 🟠 `native_terminal_reconcile_frame` missing from Tauri ACL — the feature this branch delivers is silently dead
4. 🟠 Viewer worker panic after failed detach — wedges the run's viewer until restart
5. 🟠 Cross-project reparent invariant break — same function as #1
6. 🟠 Launch-vs-reconciliation tombstone race — deletes the launch wrapper out from under `respawn-pane`
7. 🟠 Double-launch via dual `issue_state_changed` receivers
8. 🟠 `selectProject` stale-closure race persisting wrong module selection

Everything else is ranked per-area below.

Review areas:

| Area | Scope | Status |
| --- | --- | --- |
| Backend core | `backend/worktracker/` (models, rest, services, workflow) | ✅ done |
| Backend apps | `backend/apps/` (execution, terminals, rest_api.py) | ✅ done |
| Studio frontend | `studio/src/` (shell, features, shared) | ✅ done |
| Desktop/native | `studio/src-tauri/` (Rust, Obj-C FFI, Tauri surface) | ✅ done |
| Config & tooling | Settings, build scripts, repo hygiene | ✅ done |

**Validation run (current working tree):** `npm run typecheck` ✅ clean (SDK + studio) · studio tests ✅ 412/412 passing · backend pytest ❌ **6 failed**, 1290 passed, 3 skipped

### ❌ Failing backend tests (current working tree)

| Test | Symptom |
| --- | --- |
| `worktracker/tests/test_mutations.py::test_cancel_archives_and_cascades_descendants` | Cancelling a task no longer archives its descendants — 2 descendant ids remain unarchived. |
| `worktracker/tests/test_protected_states.py::test_state_out_serializes_is_protected` | State set contains an unexpected extra `Ideas` state — workflow seed drift. |
| `worktracker/tests/test_types_states_config.py::test_delete_last_state_in_group_409` | `State.objects.get()` raises `MultipleObjectsReturned` (2 rows) — duplicate seeded states. |
| `worktracker/tests/test_reviewed_defaults_seeding.py::test_agents_guidance_matches_reviewed_artifact` | Generated AGENTS guidance text drifted from the reviewed artifact (`reviewed_defaults`). |
| `studio_server/tests/test_state_db_adoption.py::test_fake_initial_adopts_existing_database_without_data_change` | State-DB adoption path broken. |
| `studio_server/tests/test_state_db_adoption.py::test_fresh_migrate_sets_pragmas_and_database_cascade` | Fresh-migrate pragma/cascade setup broken. |

Three of the four worktracker failures point at the same root: the workflow/state seed data changed (new `Ideas` state, duplicated states) without the tests — or the seeding — being reconciled. These fail on the current branch state and block a green merge.

Severity levels: **Critical** (data loss / security / crash), **High** (real defect, likely to bite), **Medium** (correctness risk or notable debt), **Low** (minor / style / hygiene).

---

## Findings

### Backend core — worktracker (models / rest / services / workflow)

1. **[Critical] Reparenting an issue to itself or its own descendant hangs the worker in an infinite loop inside an open transaction** — `backend/worktracker/services/work_items.py:347-356, 371-385`
   `update_work_item` sets `issue.parent` from `get_issue(parent_id)` with **no self/descendant/cycle guard**, and the module-cascade BFS has no `seen` set (unlike `cascade_archive` and `_pathfind_subtree_ids`, which both have one). `PATCH /work-items/{id}` with `{"parent_id": "<that same id>"}` makes the issue its own child; the BFS re-yields it forever and the request hangs the worker inside a transaction until OOM. A descendant parent does the same via the longer loop *and* persists a corrupted parent cycle. No test covers illegal reparents. *(Verified directly: no guard at 347-356, unbounded frontier loop at 374-384.)*

2. **[High] `update_work_item` accepts a parent from a different project, breaking the same-project tree invariant** — `backend/worktracker/services/work_items.py:347-356`
   `get_issue(parent_id)` is unscoped and there's no `parent.project_id != issue.project_id` check — while `create_review_finding` and both reorder-neighbor paths enforce it. A cross-project parent leaves `issue.module_id` pointing at a foreign module, silently corrupting project-scoped lists and rollups; the cascade in finding 1 then stamps the foreign module onto the whole subtree.

3. **[Medium] `transition_state` does a full-row save from a pre-validation instance, silently clobbering concurrent edits** — `backend/worktracker/workflow.py:197`
   The save writes every field (no `update_fields`). A drag-reorder (rank committed with `update_fields=["rank"]`) racing a transition of the same task into an empty destination state gets silently reverted by the transition's stale full-row write. The project-row lock serializes transitions against transitions only, not against the lock-free reorder path.

4. **[Medium] The SQLite `BEGIN IMMEDIATE` upgrade is dead code on the primary REST path** — `backend/worktracker/workflow.py:36-39`, `services/work_items.py:337-342`
   `update_work_item` wraps `transition_state` in its own `transaction.atomic()`, so `connection.in_atomic_block` is already true and the `transaction_mode="IMMEDIATE"` branch never runs — the transaction begins DEFERRED, exactly the case the code comment calls unsafe. Two processes sharing `state.db` can both read the destination tail; the loser dies with `SQLITE_BUSY_SNAPSHOT`. The concurrency test proves serialization by calling `transition_state` directly — bypassing the wrapper that defeats it; the production path is the untested one.

5. **[Medium] The human-only transition gate trusts a client-asserted `origin` that defaults to the privileged value** — `backend/worktracker/rest/serializers.py:215`, `services/work_items.py:332`
   `origin` is a plain body field defaulting to `"human"`, and every caller shares one static `x-api-key` — so an agent can traverse an `agent_allowed=False` edge just by omitting `origin`. `human_only_transition` is enforceable only against honest clients.

6. **[Low] Unhandled `Project.DoesNotExist` in the transition lock returns a 500 instead of a domain 404** — `backend/worktracker/workflow.py:155`
   A project deleted while a transition PATCH is in flight breaks the `ServiceError` contract promised by `rest/exceptions.py`.

7. **[Low] Archived-module guard reads a pre-lock snapshot** — `backend/worktracker/services/module_reorder.py:41-42`
   `issue.is_archived` is checked before `select_for_update` and never re-read inside the transaction; a module archived in the window still gets ranked (the exact outcome the new guard's comment says it prevents). The neighbor checks re-fetch under the lock and don't share the flaw.

8. **[Low/structural] Four modules exceed the 300-400-line rule with multiple concerns** — `registry.py` (482), `services/work_items.py` (449), `rest/views.py` (431), `rest/serializers.py` (428)
   The branch did extract `rest/reorder_serializers.py` (right direction), but `services/work_items.py` was touched and grew rather than split.

9. **[Info] `tests/test_module_reorder.py` deletion is fully compensated** — replaced by six focused files plus fixtures (724 lines) covering the new no-neighbor and archived guards, and `test_transition_landing.py` includes a real-thread concurrency test. Remaining gaps: findings 1, 2, and the REST-wrapped concurrent-transition path in finding 4.

_Reviewer's overall read: structurally healthy — framework-neutral services, one error seam, serializers tight against mass assignment — and the uncommitted work improved the tree. Risk concentrates in `update_work_item`'s reparent path and in write races from full-row saves plus the nested-atomic wrapper quietly disabling the new SQLite locking discipline._

### Backend apps — execution / terminals / rest_api

1. **[High] Launch-vs-reconciliation race can tombstone (and sabotage) a launch in flight** — `backend/apps/terminals/launch.py:326-352`, `backend/apps/terminals/reconciliation.py:93-177`
   AgentRun/AgentTerminalSession rows are persisted *before* the tmux session exists, and the reconciliation sweep has no grace period or `starting` exclusion. A sweep scheduled between persist and `terminal_runtime.create` sees the fresh row, `inspect` returns MISSING, and the run is tombstoned: `agent_run_terminated` is published, and `cleanup_temporary_artifacts_for_run` deletes the run's `launch.sh` wrapper — so when `respawn-pane` executes, large-prompt launches exec a deleted script and the agent never starts, while serial campaigns react to a phantom termination.

2. **[High] Spawn and launch-fact recording are not atomic** — `backend/apps/execution/driver.py:347-368`
   The agent is spawned first; `LaunchedTask.objects.create` runs afterward, outside any transaction and outside the per-child `try`. A crash or DB error between them leaves a live agent with no ledger row, so the next `advance` relaunches the task — two agents in one worktree. Worse, a stale `LaunchedTask` under a different root (task reparented between campaigns) makes `create()` raise `IntegrityError` *after* a successful spawn, and the blanket `except IntegrityError` (`driver.py:261-263`) mislabels it as a 409 `graph_run_exists` while the orphan agent keeps running.

3. **[High] Two receivers on one `issue_state_changed` emission can double-launch a task** — `backend/apps/execution/signals.py:87-147`
   The automation receiver (destination state has `auto_start`) and the executor receiver (armed parent advances) both fire on the same signal, and `run_automation_attempt` has no "live run already exists" guard. A child transitioning into an auto-start state under an armed parent gets launched twice. Related: `transition_id` is a fresh uuid per save (`backend/worktracker/signals.py:175`), so the `get_or_create` dedupe never spans transitions.

4. **[Medium] Terminal termination runs before the existence check, and tmux targets aren't exact-match** — `backend/apps/terminals/api.py:340-351`, `backend/apps/terminals/runtime/_tmux.py:337-348`
   `terminate_agent_run` is called with the raw query param before the 404 check, and `kill-session -t pt-<input>` uses tmux prefix/fnmatch resolution (no `=` exact prefix). `agent_run_id=*` becomes `-t "pt-*"` and kills an arbitrary live session — whose DB rows stay "active" until a sweep marks them lost — while the caller gets a 404 as if nothing happened.

5. **[Medium] Unauthenticated lifecycle ingestion allows run-state spoofing / resume hijack** — `backend/apps/rest_api.py:404-408`, `backend/apps/runs/api.py:74-131`
   `LifecycleEventView` is public and writes `provider_session_id` + `lifecycle_state` for any `agent_run_id` with no verification. Any local process (or cross-origin browser POST to the loopback port) can overwrite a run's provider session id — which the resume flow (`launch.py:543-578`) then feeds into `adapter.resume_command` — or spoof idle/error states. The signed run-authorization pattern used by `SelfTerminateView` (`backend/apps/terminals/authorization.py`) is the right template and is skipped here.

6. **[Medium] Tombstone-recovery scan grows without bound** — `backend/apps/terminals/reconciliation.py:242-295`
   `_recover_running_owned_tombstones` selects every session with `terminated_at` set and `runtime_cleanup_pending=False` — which includes all explicitly terminated and "lost" runs, forever — and issues one tmux `inspect` per row on every sweep. Reconciliation latency and tmux load grow linearly with all-time run history.

7. **[Medium] Runtime recovery resurrects records but not side resources** — `backend/apps/terminals/persistence.py:294-352`, `reconciliation.py:275-295`
   When a false death is healed, rows flip back to running, but the death path already stopped the documents watch and deleted run-scoped artifacts (hook/MCP config, wrapper script); recovery restarts neither. A recovered run permanently loses document watching and artifacts its still-running agent may re-read.

8. **[Medium/structural] `apps/rest_api.py` violates the repo's own layout rule** — `backend/apps/rest_api.py` (587 lines)
   ~40 serializer classes across six domains plus every DRF view adapter in one file; CLAUDE.md explicitly names this file as oversized, and the current working-tree change grew it instead of extracting. `backend/apps/execution/driver.py` (546 lines) similarly bundles four concerns (direct launch, graph projection, campaign state machine, lifecycle observers).

9. **[Low] Automation failure classification collapses to "always retryable"** — `backend/apps/execution/signals.py:45-53`
   Both branches set `retryable = True`, so permanent failures (`task_not_found`, `unknown_agent`) present as retryable and invite identical re-failures.

10. **[Low] Heavy synchronous work inside post-commit signal receivers** — `backend/apps/execution/signals.py:117-147`
    Prompt building, worktree git operations, and tmux creation run synchronously in the `on_commit` callback of the transitioning HTTP request, while holding the per-root `RLock` — stalling both the request and the reconciliation worker.

_Reviewer's overall read: the persistence/runtime/policy seams are clean and terminations are correctly published post-commit, but every High clusters at thread/process boundaries the design acknowledges and doesn't fully close (launch vs sweep, spawn vs record, dual launch triggers). Test coverage is broad on policy but has no tests for these interleavings, tmux target escaping, or terminate-before-404._

### Desktop/native — Tauri, Rust, Obj-C FFI

1. **[High] Viewer worker panics after a failed detach, permanently wedging that run's viewer** — `studio/src-tauri/src/viewer_commands.rs:599-613`
   The `Detach` branch does `control.take().expect(...)`; when `detach()` errors it replies and `continue`s with `control` now `None`, so the next command or the 50 ms poll tick (`control.as_mut().expect(...)`, line ~636) panics the worker thread. The entry stays `Detaching` forever and `active_runs` never releases the run id — no viewer can re-attach to that run until app restart. The `Input`/`Resize` expects (lines 573/584/594) share the trap. *(Verified: the `Err` branch leaves `control` empty and loops.)*

2. **[High] `native_terminal_reconcile_frame` is registered but has no ACL permission — the feature is dead and silently masked** — `studio/src-tauri/src/lib.rs:1007`, `studio/src-tauri/build.rs`, `studio/src-tauri/capabilities/studio-main.json`
   The command is in the invoke handler but missing from both the build-time command list and the capability file, so Tauri v2 denies every webview call — and the frontend swallows the rejection with `.catch(() => {})` (`studio/src/features/agents/terminal/internal/nativeTerminalPreparation.ts:38`). Resizing during native attach preparation presents stale geometry every time, with zero diagnostics. *(Verified: `reconcile_frame` appears only in lib.rs.)*

3. **[Medium] Webview-reachable arbitrary-binary execution with no timeout in tool approval** — `studio/src-tauri/src/lib.rs:972-978`, `studio/src-tauri/src/discovery.rs:196-211,367-389`
   `desktop_approve_executable_path` accepts any absolute path from the renderer; validation is basename match + executable bit, then `version_probe` runs the binary synchronously with no timeout and persists it as the approved `tmux`/`claude`. A compromised renderer gets immediate + persistent arbitrary execution; a binary that never exits freezes the UI permanently.

4. **[Medium] Bridge socket in world-listable `/tmp` with a bind→chmod race and no peer-credential check** — `studio/src-tauri/src/native_terminal.rs:258-261,682,859-861`
   The Unix socket is bound with umask-default permissions then chmod'd 0600, and `accept_bridge` takes the first connection without `getpeereid`. Another local user connecting in the window becomes the bridge — reading terminal output and injecting keystrokes. Fix: bind inside a 0700 directory and/or verify peer UID.

5. **[Medium] Use-after-free of the ghostty runtime via queued wakeup blocks at shutdown** — `studio/src-tauri/native/libghostty_host.m:31-36`, `studio/src-tauri/src/lib.rs:1122`
   `runtime_wakeup` dispatches a block capturing the raw runtime pointer onto the main queue; `muxed_ghostty_runtime_free` frees the struct with blocks still queued. Quitting while a native terminal produces output → crash on exit.

6. **[Medium] Duplicate-attach TOCTOU in native terminal attach** — `studio/src-tauri/src/native_terminal.rs:241-249` vs `371-385`
   The "already attached" check happens long before the entry insert, with no re-check under the lock (unlike `viewer_attach`, which re-checks). Two concurrent attaches for one run → two NSViews, two tmux clients, two bridge sockets; one surface orphaned over the webview.

7. **[Medium] Blocking subprocess/PTY work in synchronous Tauri commands runs on the main thread** — `studio/src-tauri/src/viewer_commands.rs:300-360,513-524`, `studio/src-tauri/src/lib.rs:891-945`
   `viewer_attach` (tmux waits + PTY spawn, no timeouts) and `desktop_retry_services` are plain `#[tauri::command]`; a hung tmux server freezes the entire UI with no recovery. Worth a systematic pass converting to `#[tauri::command(async)]`.

8. **[Medium] Shutdown `detach_all` frees NSViews/runtime while an in-flight attach thread still dereferences them** — `studio/src-tauri/src/native_terminal.rs:190-216,436`, `libghostty_host.m:391-411`
   Quitting during attach preparation can leave a thread spinning in `wait_for_redraw` on a deallocated object.

9. **[Low] View handle can leak on the create-timeout race** — `studio/src-tauri/src/native_terminal.rs:311-318`
   If the main-thread closure's send lands between `recv_timeout` timing out and the receiver dropping, the buffered view (plus ghostty surface and bridge process) leaks permanently above the webview.

10. **[Low] Unbounded registries fed by IPC** — `studio/src-tauri/src/native_terminal/frames.rs:71-73`, `viewer_commands.rs:711-733`
    `PendingFrames::publish` accepts any run id (entries only removed on attach) and closed viewer entries are never evicted; long sessions grow memory without bound.

11. **[Low] CSP `connect-src` grants the renderer every local port** — `studio/src-tauri/tauri.conf.json:30`
    `http(s)://127.0.0.1:*` / `ws(s)://localhost:*` lets any renderer compromise probe/CSRF arbitrary local daemons; only the sidecar's port genuinely needs it.

12. **[Low] Main-window label check enforced on `attach` but omitted on `set_frame`/`focus`/`detach`/`reconcile_frame`** — `studio/src-tauri/src/native_terminal.rs:536-642` vs `:236`
    Harmless with one window today; a silent trust-boundary break if a second webview window is added.

_Reviewer's overall read: unusually well-designed for a Tauri native layer — least-privilege command surface, opaque handles, careful scroll-callback lifetimes. Defects cluster in failure/teardown paths plus the `reconcile_frame` wiring regression, which silently disables a feature the current diff exists to deliver._

### Studio frontend — React / TypeScript

1. **[High] Stale-closure race in `selectProject` — post-await continuation runs against a switched project** — `studio/src/features/projects/store.ts:104-115`
   After `await loadModules(id)` there is no re-check that `get().selectedProjectId === id` before `selectModule(recentModuleId)`. Click project A, then project B before A's modules load: A's continuation sets `selectedModuleId` to A's module while B is open, loads a module tree under the mismatched key `(B, moduleA)`, and durably persists `recent_module_ids[B] = moduleA` into the profile.

2. **[High] Eleven `as unknown as` double-casts erase compile-time verification of the backend contract** — `studio/src/shared/api/client.ts:283-391`
   Every work-item/attachment SDK response is force-cast (`as unknown as WorkItem[]` etc.), and the local `Attachment` type asserts `mime_type: string` the wire may not honor (`shared/api/types.ts:103-109`). `openapi.json` is changing in this very branch; any field rename or nullability change in the regenerated SDK still typechecks and surfaces only as runtime `undefined`s in the query cache.

3. **[Medium/structural] `shared/api/client.ts` is a 992-line multi-domain module in `shared/`** — `studio/src/shared/api/client.ts`
   Aggregates projects, modules, work items, states, issue types, workflow settings, launch bindings, providers, keybindings, and documents endpoints — directly against the repo layout rules (per-domain API belongs in `features/<domain>/api`; agents already model the correct pattern in `features/agents/api/agentApi.ts`).

4. **[Medium] `cachedRank` throws inside `onMutate`, aborting valid reorders before the network call** — `studio/src/features/work-items/mutations.ts:259-289`
   The optimistic update throws when a neighbor's `workItems.byId` entry is missing or rankless; a throw in `onMutate` fails the mutation before `mutationFn` runs. A drag next to an item whose cache entry was skipped by the `locallyMutating` guard is discarded with an error toast — even though the server only needs the ids.

5. **[Medium] Project list writes race in-flight refetches — no `cancelQueries` before `setQueryData`** — `studio/src/features/projects/queries.ts:154-183`
   `create/update/deleteProjectRecord` write the projects key without cancelling an in-flight fetch; a fetch dispatched pre-create can resolve just after the optimistic append and overwrite the list without the new project. (Contrast `useReorderModule`, which cancels correctly.)

6. **[Medium] Subtask creation with no module context invalidates a key nobody reads** — `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx:78-91`
   On a cold deep link with no derived epic and no `selectedModuleId`, `onSettled` invalidates `["tasks", pid, ""]`, which no query populates — the new subtask appears only after unrelated navigation forces a refetch.

7. **[Medium] Native terminal renew loop ignores every lease-loss code except one** — `studio/src/features/agents/terminal/NativeGhosttyTerminal.tsx:251-261`
   The 10 s renew timer detaches only on `replaced_by_another_viewer`; expired/reaped/auth failures are swallowed and retried forever. After laptop sleep past lease expiry, the client keeps rendering a stream it no longer holds a lease for.

8. **[Low-Medium] Two parallel query-key families for the same work-item entity, one entirely dead** — `studio/src/shared/query/keys.ts:32-45`
   `workItems.byId` is live; `workItems.index/detail/children/byProject` and `tasks.detail`/`tasks.emptyDetail` have zero consumers — dead entries in the registry meant to prevent invalidation drift.

9. **[Low/structural] `state/clientStore.ts` is an 832-line multi-concern store** — `studio/src/state/clientStore.ts`
   Mixes selection, workspace/tabs, focus/cursor, dialogs, toasts, and still owns `selectModule`'s server-state loading side effects — blurring the exact client/server-state boundary this migration is drawing.

10. **[Low] Three duplicate hand-rolled `request()`/`ApiError` stacks; `instanceof` checks miss agent errors** — `studio/src/features/agents/api/agentApi.ts:9-34`, `features/agents/worktrees/internal/api.ts:47-69`
    The agents `ApiError` is a distinct class, so `apiErrorMessage`/`isNoOpTransition` (`shared/api/client.ts:111-134`) fail on agent-API errors and degrade to generic messages.

11. **[Low] `NativeGhosttyTerminal` re-attaches when callback props change identity** — `studio/src/features/agents/terminal/NativeGhosttyTerminal.tsx:293`
    The attach effect depends on `onReady`/`onUnavailable` directly; the current caller memoizes, but any future inline lambda silently tears down and reattaches the native terminal (dropping the viewer lease) every render. Use the ref pattern already applied in `useAxisDragAndDrop`.

12. **[Low] Concurrent optimistic mutations on one work item can transiently clobber each other on rollback** — `studio/src/features/work-items/mutations.ts:92-125`
    `onError` restores its own snapshot over a later in-flight mutation's optimistic write; `onSettled` invalidation reconverges, so the damage is a flicker window, not divergence.

_Reviewer's overall read: the TanStack Query migration is in good shape — correct cancel-before-snapshot in reorders, revision-guarded cache merges, careful viewer-lease state machine. Risk concentrates at the seams the migration hasn't crossed: async store flows reading global state after awaits, and the monolithic `shared/api/client.ts` whose double-casts neutralize the type safety the generated SDK exists to provide. The `RunSubtreeAction.tsx` deletion is clean — no dangling references._

### Backend apps — runs / documents / settings_store / worktrees (supplemental pass)

1. **[Medium] `reconcile()` mass-deletes worktree records when git fails for a repo** — `backend/apps/worktrees/service/actions.py:246-268`
   `_known_worktree_paths()` (`service/git.py:45-55`) returns an **empty set** whenever `git worktree list` exits non-zero — repo directory missing/unmounted, permissions error, git not on PATH. `reconcile()` can't distinguish "repo has no worktrees" from "the listing failed," so every row for that repo is pruned. Failure scenario: repos on an external/network volume that isn't mounted yet at backend startup → all live worktree records for it are deleted; the actual trees and branches remain on disk, orphaned. Fix: treat a non-zero `worktree list` as "unknown — keep rows" rather than "empty."

2. **[Medium] `integrate()` can raise an unhandled exception mid-flow, leaving partial state** — `backend/apps/worktrees/service/actions.py:212`
   `_git(["merge", "--ff-only", branch], repo_root)` runs with `check=True`. If the primary checkout is dirty with changes the fast-forward would overwrite, git refuses and `CalledProcessError` propagates (likely a 500 to the client) *after* the base branch has already been merged into the worktree. Every other failure path in this function returns a structured `IntegrateResult`; this one should too (the state is retryable, but the caller has no way to know that from a stack trace).

3. **[Low] `discard()` reports `removed=True` even when removal failed** — `backend/apps/worktrees/service/actions.py:235-243`
   If `git worktree remove --force` fails for a reason other than "already gone" (e.g. a process holds the directory, permission error), the code prunes admin records, deletes the DB row anyway, and returns `removed=True`. The directory stays on disk with no record pointing at it.

4. **[Low] Worktree `create()` has a check-then-act race** — `backend/apps/worktrees/service/actions.py:63-83`
   Two concurrent creates for the same task both pass the `dao.get_by_task()` idempotency check; the second `git worktree add -b` fails on the duplicate branch and raises. Harmless in single-user desktop use, but the idempotency claim in the docstring isn't concurrency-safe.

_Otherwise healthy: `documents/service.py` does asset resolution correctly (resolve + `relative_to` containment defeats traversal and symlink escapes, extension allowlist, digest-guarded atomic writes); `runs`, `settings_store`, and `documents` are small, focused modules with solid test ratios._

### Config & tooling

1. **[Low] Non-constant-time API key comparison** — `backend/worktracker/rest/authentication.py:32`
   The static API key is checked with `supplied == expected` instead of `hmac.compare_digest`, which is a timing side channel. Impact is minimal on a localhost-only sidecar, but it's a one-line fix.

2. **[Low] Insecure-by-default Django settings rely on env overrides** — `backend/studio_server/settings.py:11-13`
   `SECRET_KEY` falls back to a hardcoded value, `DEBUG` defaults to `true`, and `ALLOWED_HOSTS` defaults to `*`. This is a documented localhost-dev posture and the dev script binds uvicorn to `127.0.0.1` only, so it holds today — but nothing *enforces* it. If the sidecar is ever started with `--host 0.0.0.0` or behind a port-forward, debug pages and the default secret go with it. Consider a startup assertion (refuse `DEBUG=true` + non-loopback bind) rather than relying on convention.

_Config posture otherwise checked out: auth fails closed when `WORKTRACKER_API_TOKEN` is unset, the admin is opt-in via `MUXED_ADMIN_ENABLED`, and `DesktopOriginMiddleware` only relaxes CORS for the exact configured desktop origin._
