# ADR-0003 (T800): Session owns AgentRun status truth

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-800 refinement)

## Decision

The Session module is the sole writer of run liveness state:

- `terminate(agent_run_id)` flips the row as part of teardown:
  `status="terminated"`, `ended_at=now` — after killing tmux and stopping the
  doc watcher. Idempotent: repeat calls are no-ops.
- `reconcile()` reaps orphan tmux sessions, stops leaked watchers, and flips
  runs whose tmux died on its own to `status="exited"`.
- `live_run_for(task_id)` is then a plain DB read, trustworthy **by invariant**
  (no tmux cross-check at query time).

## Context (defect being fixed)

Nothing in production ever flipped `AgentRun.status` off `"running"`:
`update_agent_run_exit` (apps/runs/dao/lifecycle.py) had zero non-test
callers; `terminate_terminal` and `reconcile_sessions` both left the row
untouched, and `execution/driver.py:_live_run_for` trusted the stale field —
dead runs blocked relaunch forever. `reconcile_sessions`' docstring deferred
to a "run-reconciler" that never existed; Session **is** that reconciler.

## Alternatives rejected

- Cross-check tmux inside `live_run_for` on every call: accurate but shells
  out per liveness check, and stale rows stay stale for every other reader
  (UI counts, history).
- Belt-and-suspenders (flip + verify): more machinery than the invariant
  warrants once one module owns the writes.
