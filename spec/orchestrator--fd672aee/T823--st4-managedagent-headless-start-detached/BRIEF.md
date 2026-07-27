# T823 — ST4 clarified requirements

Source ticket: `#823` / `<redacted-id>`

## Scope

- Add `server/apps/orchestrator/managed_agent.py` with:
  - `start(config: AgentConfig, *, popen=subprocess.Popen) -> HeadlessRun`
  - `reconcile(*, pid_alive=None) -> list[Fact]`
  - `state_dir()`, `run_dir(headless_run_id)`, and `SIDECAR_PATH`
- Preserve the old launch path. This work only introduces the detached sidecar path and the reconciliation reader.
- No asyncio in `managed_agent.py`.
- No changes to `driver.py`, `headless.py`, `signals.py`, or the existing launch callers in this subtask.

## Launch behavior

- Only `AgentConfig.mode == "headless"` is supported here.
- `start()` must:
  - build the headless agent command with `build_headless_command(...)`
  - create the `HeadlessRun` row before spawning so the run directory can be derived from the row id
  - spawn the sidecar, not the agent directly
  - pass `start_new_session=True`
  - persist `pid` and `process_handle=f"sidecar:{pid}"`
  - set `status="failed"` and `finished_at` before re-raising `HeadlessLaunchError` on spawn failure
- Real-spawn protection mirrors `headless.py`, but the guard only applies when `popen is subprocess.Popen`.

## Reconciliation behavior

- Only rows with `status="running"` and non-null `config` are eligible.
- For each eligible row:
  - read `completion.json` from `run_dir(row.id)`
  - read `stdout.log` from the same directory, capped at the last `200_000` characters
  - use `headless.parse_usage(stdout)`
  - update the `HeadlessRun` row with the same exit metadata that the old `_supervise_process` path records: `exit_code`, `timed_out`, `stdout`, `usage`, `usage_parse_errors`, `finished_at`, and terminal `status`
  - evaluate contracts from `AgentConfig.from_dict(run.config)`
  - when `phase == "verify"`, read the verdict payload exactly through the same `_read_verdict` logic the driver uses
  - append a `node_exited` fact to the owning coordinator run if adoption succeeds
- If the pid is dead and no completion file exists:
  - mark the run `exited_unknown`
  - append a `node_exited` fact with `exit_code=None`, `timed_out=False`, and `checks=[]`
- If the pid is still alive and no completion file exists:
  - leave the row unchanged unless it is wedged
  - if `now - started_at > timeout_seconds + grace_seconds + 60`, send `SIGTERM` to the pid and let a later pass finish the job

## Contract payload

- Fact payload shape for `node_exited`:
  - `headless_run_id`
  - `exit_code`
  - `timed_out`
  - `phase`
  - `attempt`
  - `agent`
  - `model`
  - `checks`: list of `{name, ok, detail, data}`
- `reconcile()` must not call `driver.fold`.

## Tests to add

1. `test_start_creates_row_and_detached_process`
2. `test_start_blocked_in_tests`
3. `test_start_interactive_not_implemented`
4. `test_reconcile_collects_completion`
5. `test_reconcile_contract_evaluated`
6. `test_reconcile_dead_pid_no_completion`
7. `test_reconcile_alive_pid_untouched`
8. `test_reconcile_ignores_configless_rows`

## Open questions resolved for implementation

- Completion file parsing is owned by the sidecar; `managed_agent.py` only consumes the final JSON artifact.
- The verdict file should be read with the driver’s current shared-root helper behavior, not a new path convention.
- Config-less `HeadlessRun` rows remain untouched so the old launch path can continue until the switch-over subtask.
