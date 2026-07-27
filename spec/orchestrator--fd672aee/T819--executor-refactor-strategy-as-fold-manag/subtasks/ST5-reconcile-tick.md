# ST5 — Reconcile + tick: switch launches to ManagedAgent, delete resident supervision

**Depends on:** ST4. This is the switch-over subtask — the biggest one. Work in exactly the order below; run the full suite after each numbered step.
**Read first:** `INTERFACES.md` §4 (driver `fold`/`_default_launch`/`handle_headless_exit`/`resume_supervision`), §5 (headless.py), §10 (startup wiring); `../ADR-0003…` (tick = liveness guarantee).

**STEP 0 — verify:**
`grep -n "def _default_launch\|def handle_headless_exit\|def resume_supervision\|headless.start\|HeadlessSpec" server/apps/orchestrator/driver.py`
`grep -n "bind_server_loop\|resume_supervision\|lifespan" server/apps/orchestrator/startup.py server/apps/orchestrator/scheduler.py`
The refactor in flight may have moved things (service.py already became commands.py + console.py) — adapt paths, keep intents.

## Goal

The server stops owning agent processes. Launching = `managed_agent.start()` (detached,
sync). Learning = `reconcile()` (drain completion files → Facts → fold). Liveness = a
periodic tick. Restart recovery = the same `reconcile()`, not a special adoption path.
This kills the #814 orphan class.

## Step 1: `server/apps/orchestrator/reconcile.py` (new)

```python
def reconcile() -> dict:   # {"collected": int, "folded": int, "consumed": int}
```

1. `facts = managed_agent.reconcile()` — collect completions into the inbox.
2. For every active run (`dao.get_active_coordinator_runs({"running", "budget_exceeded"})`):
   `for fact in dao.get_pending_facts(run.id):` handle by kind:
   - `"node_exited"`: `run_row = HeadlessRun.objects.get(id=fact.payload["headless_run_id"])`, then call `driver.handle_headless_exit(run_row)` (it already rebuilds the LaunchAction, resolves the two signals, and folds — reuse it verbatim).
   - other kinds: skip for now (leave unconsumed only if kind is unknown; consume known-but-unhandled kinds like `question_asked` is WRONG — leave them pending; consume nothing you didn't handle).
   - `dao.mark_facts_consumed([fact.id])` after a successful fold; wrap each fact in try/except so one bad fact logs and does not block the rest.
3. Also call `driver.fold(run.id, Event(kind="tick"))` once per active run — this re-runs scheduling so anything unblocked launches. (Check `EventKind` includes `"tick"` — INTERFACES.md §2 says it does.)
4. Must be idempotent: running it twice in a row with no new completions changes nothing (facts consumed once; tick fold with no changes is a no-op by reducer design).

## Step 2: switch `driver._default_launch` to ManagedAgent

In the headless branch of `_default_launch` (currently `headless.start(headless.HeadlessSpec(...))` — see INTERFACES.md §4): replace with

```python
from apps.orchestrator.managed_agent import start as managed_start
from apps.orchestrator.agent_config import AgentConfig
managed_start(AgentConfig(
    agent=action.agent, model=action.model, task_id=action.node_id, prompt=prompt,
    cwd=<same cwd as today>, phase=action.phase, attempt=action.attempt,
    timeout_seconds=<same timeout as today>,
    contract=("verdict_valid",) if action.phase == "verify" else ("ticket_transitioned",),
))
```

Keep the existing on-launch-failed behavior: catch `HeadlessLaunchError` and fold the
same `Event(kind="node_exited", ...)` failure the current code folds. The `fold()`
`transaction.on_commit` scheduling can stay — `managed_start` is synchronous, so the
lambda now just calls a plain function (no event loop involved).

## Step 3: retire resident supervision

- `driver.resume_supervision()` → body becomes `from apps.orchestrator.reconcile import reconcile; return reconcile()` (keep the name as a shim; callers may exist).
- `headless.py`: delete `start`, `HeadlessSpec`, `launch_headless_run`, `_supervise_process`, `_supervise_adopted_pid`, `adopt_recorded_runs`, `reconcile`, `_notify_exit`, `_read_stdout`, `_terminate_process`, `_kill_process`, and every asyncio import they drag in. KEEP: `worktracker_mcp_url`, `build_headless_command`, `parse_usage`, `_extract_usage`, `is_pid_alive`, `TimeoutPolicy` only if still referenced (grep; delete if not), the status constants, `HeadlessLaunchError`, `BLOCK_REAL_SPAWN_ENV` guard.
- `scheduler.py`: grep for who uses `bind_server_loop`/`schedule_coroutine`; if only the deleted paths used them, delete the module and its startup call.
- Delete the tests that covered deleted supervision (`test_headless.py` timeout-supervision and adoption tests; `test_reconcile.py` old adoption paths) — replace with Step 5's tests. Keep argv-construction and parse_usage tests.

## Step 4: startup + tick

`startup.on_startup()` becomes:

```python
async def on_startup() -> None:
    await asyncio.to_thread(reconcile)            # restart recovery IS a reconcile
    asyncio.create_task(_tick_loop())

async def _tick_loop() -> None:
    interval = float(os.environ.get("ORCHESTRATOR_TICK_SECONDS", "30"))
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(reconcile)
        except Exception:
            log.exception("reconcile tick failed")
```

(Adapt to how `on_startup` is currently invoked from the lifespan app — keep that wiring.)
Add a manual poke endpoint in `api.py`: `POST /reconcile` → runs `reconcile()`, returns its dict. Follow the existing route style (INTERFACES.md §10).

## Step 5: tests — `server/apps/orchestrator/tests/test_reconcile_tick.py` (new)

DB harness as in `test_coordinator_wiring.py`; `ORCHESTRATOR_STATE_DIR` → `tmp_path`. Tests:

1. `test_completion_progresses_run` — full mini-run: CoordinatorRun + running RunNode (phase implement) + `managed_agent.start`-created HeadlessRun row (fake popen) + completion file (`exit_code 0`) + issue transitioned to completed; `reconcile()`; assert the RunNode is `done` and the fact is consumed.
2. `test_reconcile_idempotent` — call `reconcile()` twice; the second returns `consumed == 0` and `collected == 0`, and every RunNode/CoordinatorRun **status** is unchanged. (Do NOT assert on `updated_at` — the tick fold may legitimately re-save rows through `_persist`, and `auto_now` would move.)
3. `test_restart_recovery_is_reconcile` — simulate #814: running HeadlessRun row with config, dead pid, no completion file, node running; `reconcile()`; node is no longer stuck (the exited_unknown fact folded as a failed exit — assert node status moved out of "running").
4. `test_unknown_fact_kinds_left_pending` — append a `question_asked` fact by hand; `reconcile()` consumes nothing for it and does not crash.
5. `test_launch_goes_through_managed_agent` — drive a fold that schedules a launch (copy the launch-scheduling test from `test_coordinator_wiring.py`) and assert a HeadlessRun row with non-null `config` was created (i.e. the new path, not HeadlessSpec).

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator -q          # full app suite green
grep -rn "HeadlessSpec\|adopt_recorded_runs\|_supervise" server/apps/orchestrator --include=*.py | grep -v tests   # no hits
```

## Out of scope / do not touch

- signals.py stays exactly as it is (its synchronous folds are fine without a loop).
- No reducer/loader/strategy changes (ST6), no interactive changes (ST7).
- Do not remove `handle_headless_exit` — reconcile depends on it.
