# T823 — ST4 ManagedAgent headless detached start and reconcile

## Scope

- Add `server/apps/orchestrator/managed_agent.py`.
- Keep the old launch path untouched.
- Support only detached headless start and later reconciliation from completion artifacts.
- Do not add asyncio, fold logic, or production caller changes in this subtask.

## Inputs and dependencies

- `AgentConfig` from ST2.
- `HeadlessRun` and `Fact` from the orchestrator models layer.
- `build_headless_command`, `parse_usage`, `is_pid_alive`, and `BLOCK_REAL_SPAWN_ENV` from `headless.py`.
- `contracts.evaluate` and `CheckContext` for post-completion contract checks.
- `dao.get_run_node_for_adoption` for coordinator-run adoption.
- The shared verdict reader behavior used by the driver for verify-phase runs.

## Module contract

- `state_dir()` resolves the orchestrator state root from `ORCHESTRATOR_STATE_DIR` or the project base directory.
- `run_dir(headless_run_id)` resolves the durable per-run directory under `state_dir()/runs/<id>`.
- `SIDECAR_PATH` points at the sidecar entrypoint beside the module.
- `start(config, *, popen=subprocess.Popen) -> HeadlessRun` creates the database row first, then launches the detached sidecar.
- `reconcile(*, pid_alive=None) -> list[Fact]` scans eligible rows, consumes completion files, updates rows, and appends adoption facts.

## Start flow

1. Reject non-headless configs with `NotImplementedError`.
2. Honor the real-spawn guard only when the default `subprocess.Popen` is used and the block environment variable is set.
3. Build the agent command with the existing headless command builder.
4. Create the `HeadlessRun` row before spawning so the run directory can be derived from the row id.
5. Persist the config snapshot on the row together with the launch metadata already recorded by the existing headless path.
6. Create the run directory and invoke the sidecar with completion and stdout file paths plus the detached agent argv.
7. Launch with `start_new_session=True` and `stdin`, `stdout`, `stderr` all detached from the server process.
8. Save the pid and a sidecar-shaped process handle on success.
9. Convert spawn failures into the headless launch error type after marking the row failed and finished.

## Reconcile flow

1. Select only running rows with a non-null config snapshot.
2. For each eligible row, check for a completion file in the row’s run directory.
3. When completion exists, read stdout from the paired log file with the required tail limit, parse usage, and update the row with the terminal exit metadata used by the existing supervision path.
4. Rebuild `AgentConfig` from the stored config, construct the contract-check context, and include the verdict payload only for verify-phase runs.
5. Evaluate the declared contract set and append a `node_exited` fact when adoption finds the owning coordinator node.
6. When the pid is dead and no completion exists, mark the run `exited_unknown` and append the same fact shape with empty checks.
7. When the pid is alive and no completion exists, leave the row running unless the timeout plus grace window has been exceeded; in that case send `SIGTERM` and let a later pass finish the job.
8. Return only the facts appended during this pass.

## Decision points

- The sidecar owns process lifetime and timeout enforcement; this module only launches it and later reconciles durable completion artifacts.
- Completion file parsing is treated as authoritative for terminal state.
- Verify-phase reconciliation must reuse the driver’s verdict path, not a new file convention.
- Config-less rows remain untouched so the older launch path can continue until its switch-over subtask.
- Reconcile must not call `driver.fold`.

## Test plan

1. `test_start_creates_row_and_detached_process` verifies row creation, detached sidecar argv shape, and pid persistence.
2. `test_start_blocked_in_tests` verifies the real-spawn guard.
3. `test_start_interactive_not_implemented` verifies the mode gate.
4. `test_reconcile_collects_completion` verifies successful completion ingestion, stdout capture, contract evaluation, and fact append.
5. `test_reconcile_contract_evaluated` verifies a failing contract result is surfaced in the fact payload.
6. `test_reconcile_dead_pid_no_completion` verifies unknown exit adoption.
7. `test_reconcile_alive_pid_untouched` verifies live rows are left alone when still within the timeout window.
8. `test_reconcile_ignores_configless_rows` verifies legacy rows are skipped.

## Validation

- Run the focused managed-agent test module first.
- Then run the full orchestrator test suite.
- Do not update production callers in this phase.
