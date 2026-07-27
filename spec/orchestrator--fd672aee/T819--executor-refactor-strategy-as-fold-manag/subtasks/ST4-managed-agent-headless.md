# ST4 — ManagedAgent (headless): start detached, collect via completion files

**Depends on:** ST1 (sidecar), ST2 (AgentConfig/contracts), ST3 (Fact + HeadlessRun.config).
**Read first:** `INTERFACES.md` §5 (headless.py — especially `build_headless_command`, `parse_usage`, `is_pid_alive`, `BLOCK_REAL_SPAWN_ENV`, `TERMINAL_STATUSES`), §1 (HeadlessRun fields); `../ADR-0003…`.

**STEP 0 — verify:**
`grep -n "def build_headless_command\|def parse_usage\|def is_pid_alive\|BLOCK_REAL_SPAWN_ENV\|_VERDICT_FILENAME\|def _repo_root" server/apps/orchestrator/headless.py server/apps/orchestrator/driver.py`
Adapt imports if anything moved.

## Goal

`managed_agent.py`: the one surface that turns an `AgentConfig` into a **detached**
running agent (sidecar-wrapped, survives server restarts) and later **collects** its
completion from the sidecar's file, evaluates the declared contract checks, and appends
`Fact` rows. It never blocks waiting for an agent and never uses asyncio.

**In this subtask nothing calls this module in production.** The old launch path keeps
running; ST5 does the switch-over. That keeps this step safely verifiable in isolation.

## Deliverable 1: `server/apps/orchestrator/managed_agent.py`

Module-level helpers:

```python
def state_dir() -> pathlib.Path:
    # os.environ["ORCHESTRATOR_STATE_DIR"] if set, else Path(settings.BASE_DIR) / ".orchestrator"
def run_dir(headless_run_id) -> pathlib.Path:      # state_dir() / "runs" / str(id)
SIDECAR_PATH = pathlib.Path(__file__).resolve().parent / "sidecar.py"
```

```python
def start(config: AgentConfig, *, popen=subprocess.Popen) -> HeadlessRun:
```

1. If `config.mode != "headless"`: `raise NotImplementedError("interactive lands in ST7 (CODIN-<ST7 key>)")`.
2. Honor the same real-spawn guard headless.py uses, but ONLY for the real default: if `os.environ.get(BLOCK_REAL_SPAWN_ENV)` is set **and `popen is subprocess.Popen`** (no test double injected), raise `RuntimeError("real spawn blocked in tests")` — import the constant, don't restring it. An injected fake `popen` must bypass the guard, otherwise every test below would trip it.
3. `command = build_headless_command(agent=config.agent, model=config.model, prompt=config.prompt)` (from `apps.orchestrator.headless`).
4. Create the `HeadlessRun` row first (so the id exists for the run dir): fields exactly as `launch_headless_run` sets them today (see INTERFACES.md §5 "On create") — `task_id=config.task_id, phase=config.phase, attempt=config.attempt, agent=config.agent, model=config.model, cwd=str(config.cwd), status="running", timeout_seconds=config.timeout_seconds, timeout_grace_seconds=config.grace_seconds, command=command, started_at=timezone.now()`, **plus** `config=config.to_dict()`.
5. `mkdir -p` the run dir; build the sidecar argv:
   `[sys.executable, str(SIDECAR_PATH), "--completion-file", str(run_dir/"completion.json"), "--stdout-file", str(run_dir/"stdout.log"), "--timeout-seconds", str(config.timeout_seconds), "--grace-seconds", str(config.grace_seconds), "--", *command]`
6. `proc = popen(sidecar_argv, cwd=str(config.cwd), stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL, start_new_session=True)` — `start_new_session=True` is what detaches it from the server's lifetime; the server never waits on it.
7. Save `pid=proc.pid`, `process_handle=f"sidecar:{proc.pid}"` on the row; return the row.
8. On `popen` raising `OSError`: mark the row `status="failed"`, `finished_at=now`, re-raise as `headless.HeadlessLaunchError(str(exc))`.

```python
def reconcile(*, pid_alive=None) -> list[Fact]:
```

`pid_alive` defaults to `headless.is_pid_alive`. For every `HeadlessRun` with
`status="running"` **and `config` not null** (rows without config belong to the old path
— leave them alone until ST5 removes that path):

- **Completion file exists** (`run_dir/"completion.json"`): parse it.
  - Read stdout from `run_dir/"stdout.log"` (cap at the last 200_000 chars).
  - `usage, errors = headless.parse_usage(stdout)`.
  - Update the row exactly like `_supervise_process` does on exit (INTERFACES.md §5 "On termination"): `exit_code`, `timed_out`, `stdout`, `usage`, `usage_parse_errors`, `finished_at=now`, and `status` = `"timed_out"` if timed out else `"succeeded"` if `exit_code == 0` else `"failed"`.
  - Evaluate contracts: `cfg = AgentConfig.from_dict(run.config)`; build `CheckContext(task_id=cfg.task_id, cwd=cfg.cwd, verdict_payload=<read the verdict file exactly the way driver._read_verdict does — same filename constant, same repo-root resolution — only when cfg.phase == "verify", else None>)`; `results = contracts.evaluate(cfg.contract, ctx)`.
  - Find the owning coordinator run like `driver.handle_headless_exit` does: `dao.get_run_node_for_adoption(run.task_id, ("running", "budget_exceeded"))`. If found, `append_fact(node.run_id, kind="node_exited", node_id=run.task_id, payload={...})` with payload keys: `headless_run_id, exit_code, timed_out, phase, attempt, agent, model, checks: [{"name","ok","detail","data"}...]`. If no owning node: update the row only, no fact.
- **No completion file and `not pid_alive(run.pid)`** (or pid is null): the sidecar died without reporting. Set `status="exited_unknown"`, `finished_at=now`; append the same fact shape with `exit_code=None, timed_out=False, checks=[]`.
- **No completion file, pid alive**: leave it running — the sidecar owns the timeout; only if `now - started_at > timeout_seconds + grace_seconds + 60` treat it as wedged: `os.kill(pid, SIGTERM)` and leave it for the next pass.

Return the list of appended Facts. **This function must never call `driver.fold`** —
draining is ST5's job.

## Deliverable 2: `server/apps/orchestrator/tests/test_managed_agent.py`

Use the DB harness pattern from `tests/test_coordinator_wiring.py` and a `tmp_path`-based
`ORCHESTRATOR_STATE_DIR` (monkeypatch the env var per test). The conftest already binds a
fake HeadlessPort, so `build_headless_command` works without a real CLI. Tests:

1. `test_start_creates_row_and_detached_process` — inject a recording fake `popen` (returns object with `.pid = 4242`); assert row fields (status running, config round-trips, command from the fake port), sidecar argv structure (`SIDECAR_PATH`, `--`, then the agent command), `start_new_session=True` in the kwargs, and pid saved.
2. `test_start_blocked_in_tests` — with `BLOCK_REAL_SPAWN_ENV` set (conftest sets it) and no injected popen, `start(...)` raises before any process is created.
3. `test_start_interactive_not_implemented` — mode="interactive" raises NotImplementedError.
4. `test_reconcile_collects_completion` — create a row via `start` (fake popen), write a valid `completion.json` (`exit_code 0, timed_out false`) + `stdout.log` into its run dir, create an Issue + CoordinatorRun + RunNode (status "running") for the task (copy the wiring-test setup); call `reconcile(pid_alive=lambda p: False)`; assert row status "succeeded", stdout captured, one Fact appended with kind `node_exited` and the checks list present, and its payload `headless_run_id` matches.
5. `test_reconcile_contract_evaluated` — config with `contract=("ticket_transitioned",)`, issue NOT completed → the fact's `checks[0]["ok"] is False`.
6. `test_reconcile_dead_pid_no_completion` — no completion file, `pid_alive=lambda p: False` → status "exited_unknown", fact with `exit_code None`.
7. `test_reconcile_alive_pid_untouched` — no completion file, `pid_alive=lambda p: True`, fresh started_at → row still "running", no facts.
8. `test_reconcile_ignores_configless_rows` — a running HeadlessRun with `config=None` is not touched.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator/tests/test_managed_agent.py -q
python -m pytest apps/orchestrator -q
```

## Out of scope / do not touch

- No production caller changes: do NOT edit driver.py, headless.py, startup.py, signals.py.
- No asyncio anywhere in managed_agent.py.
- No fold, no Event construction — Facts only.
