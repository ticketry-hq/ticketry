# T800 — Implementation record (2026-07-05)

> CODIN-800 · [terminals] Deep Session module: one seam for spawn / terminate / live-run.
> Built per ADR-0001..0005 in this directory. Validated: **458 backend tests green**
> (`apps/terminals apps/execution apps/orchestrator apps/documents apps/runs apps/core`).

## Commit message

```
feat(terminals): deep Session module — one seam for spawn/terminate/live-run (CODIN-800)

Introduce the Session facade in apps.terminals as the single door for a
run's whole lifecycle, per ADR-0001..0005 (spec/T800):

- session.py: LaunchIntent, TerminalSessionService (spawn / terminate /
  live_run_for / sessions_for / attach / reconcile), AttachHandle owning
  the single-viewer slot with idempotent release; module singleton
  `session`. terminate flips AgentRun.status="terminated"+ended_at;
  reconcile stops leaked doc watchers and flips dead runs to "exited"
  (fixes the defect where nothing ever flipped status off "running").
- fakes.py: InMemorySessionService — second adapter proving the seam;
  dual-adapter contract tests.
- WS consumer launches via session.spawn (inline _orchestrate spawn
  composition deleted); attach/scroll/resize via AttachHandle, released
  on every exit path; direct-PTY agent-launch fallback REMOVED (ADR-0005
  — tmux is a hard requirement, LaunchUnavailable surfaces as an error
  frame). The one remaining PTY is the viewer running `tmux attach`.
- REST api.py: terminate via session.terminate; list endpoints via
  explicit session.reconcile() + sessions_for().
- execution/driver.py: liveness via injected LiveRunFor port defaulting
  to session.live_run_for (mirrors the SpawnRun seam); direct
  AgentRun.status query removed.
- launch.py: spawn_run DELETED — exactly one launch implementation
  remains (session.spawn over the private _launch engine). Its tests
  live on as tests/test_session_spawn.py against the seam.
- tmux/__init__.py: re-exports types only; new AST boundary test
  forbids apps.terminals.tmux imports outside apps/terminals/.
- ADR-0004 wiring: apps/core/session_registry.py (bind/get_session),
  orchestrator/ports.py SessionPort Protocol (typing-only — scaffold
  boundary test unchanged and green), terminals/session_adapter.py
  SessionPortAdapter bound at AppConfig.ready().

Unblocks CODIN-798 (interactive launch adds launch_mode to LaunchIntent).
```

## Files touched

### New
| File | What |
| --- | --- |
| `server/apps/terminals/session.py` | The Session seam: `LaunchIntent`, `TerminalSessionService`, `AttachHandle`, singleton `session`. |
| `server/apps/terminals/fakes.py` | `InMemorySessionService` — in-memory adapter satisfying the same surface. |
| `server/apps/terminals/session_adapter.py` | `SessionPortAdapter` (kwargs → `LaunchIntent`), bound into the registry at startup (ADR-0004). |
| `server/apps/core/session_registry.py` | Neutral composition root: `bind` / `get_session` / `reset`. |
| `server/apps/orchestrator/ports.py` | `SessionPort` Protocol (typing-only; orchestrator still imports zero terminals code). |
| `server/apps/terminals/tests/test_session.py` | Behavior + dual-adapter contract tests (terminate idempotency, reconcile watcher-stop + "exited" flip, single-viewer attach). |
| `server/apps/terminals/tests/test_session_boundary.py` | AST walk: no `apps.terminals.tmux` import outside `apps/terminals/`; consumers/api must go through the seam. |
| `server/apps/terminals/tests/test_session_registry.py` | Registry wiring + two-adapter conformance. |
| `server/apps/terminals/tests/test_session_spawn.py` | Spawn-composition tests (formerly `test_spawn_run.py`, repointed at `session.spawn`). |

### Modified
| File | What |
| --- | --- |
| `server/apps/terminals/consumers.py` | Launch via `session.spawn`; attach/scroll/resize via `AttachHandle` (released on every exit path); direct-PTY agent-launch fallback removed. |
| `server/apps/terminals/api.py` | `terminate_terminal` → `session.terminate`; lists → `session.reconcile()` + `session.sessions_for()`. |
| `server/apps/terminals/launch.py` | `spawn_run` deleted; `_launch` remains the private engine under `session.spawn`. |
| `server/apps/terminals/apps.py` | `AppConfig.ready()` binds `SessionPortAdapter` into `apps.core.session_registry`. |
| `server/apps/terminals/session_registry.py` | Sync viewer-slot reserve/release helpers used by `AttachHandle`. |
| `server/apps/terminals/tmux/__init__.py` | Behavior functions no longer re-exported (types only: `TmuxSession`, `ReconcileResult`, `TmuxSessionError`, `SESSION_PREFIX`, `TMUX_SOCKET`). |
| `server/apps/execution/driver.py` | `LiveRunFor` port + `spawn_run` wrapper over `session.spawn`; no direct `AgentRun` liveness query. |
| `server/apps/terminals/tests/test_api.py`, `test_consumers.py`, `test_tmux.py` | Repointed at the seam / submodule imports. |

### Deleted
- `server/apps/terminals/tests/test_spawn_run.py` (superseded by `test_session_spawn.py`).

## Notable semantics
- `terminate` is idempotent; an already-dead-but-recorded run now returns **200** from `terminate_terminal` where it used to 404 (404 now = "no session row ever existed"). FE expectations worth a check.
- `live_run_for` is a plain DB read, trustworthy by invariant (ADR-0003) — no tmux cross-check at query time.

## Follow-ups (non-blocking)
- `consumers.py` keeps a `_TmuxCompat` shim + a `session_module.get_agent_command = ...` assignment purely so legacy consumer tests can monkeypatch; migrate those tests to patch `session` and delete the shim.
- CODIN-798 consumes `session_registry.get_session()` and adds `launch_mode` as one new `LaunchIntent` field.
