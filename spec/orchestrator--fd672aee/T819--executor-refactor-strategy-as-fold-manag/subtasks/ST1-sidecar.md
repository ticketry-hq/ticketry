# ST1 — Sidecar: the process that owns the agent and writes the completion file

**Depends on:** nothing. Pure new code, no existing file is modified.
**Read first:** `../ADR-0003-one-durable-substrate-agents-report-server-reconciles.md` (why the sidecar exists). You do NOT need Django or the ORM for this task.

## Goal

A standalone, stdlib-only Python program that runs an agent command as its child,
enforces a timeout, captures stdout, and writes a machine-readable completion file
when the child ends — even if the Django server is down. This file is how the
orchestrator learns that a headless agent finished.

## Deliverable 1: `server/apps/orchestrator/sidecar.py`

Rules:
- **stdlib imports only** (`argparse, json, os, signal, subprocess, sys, tempfile, datetime`). NO Django imports, NO imports from `apps.*`. It must run as a plain script: `python3 sidecar.py …`.
- Must have `if __name__ == "__main__": sys.exit(main(sys.argv[1:]))`.

CLI (argparse):

```
python3 sidecar.py --completion-file PATH --stdout-file PATH \
    --timeout-seconds FLOAT [--grace-seconds FLOAT=10.0] -- CMD [ARG...]
```

`main(argv: list[str] | None = None) -> int` behavior, in order:

1. Parse args. Everything after `--` is the child command (use `argparse.REMAINDER` on a positional named `command`; strip a leading `"--"` element if present). Empty command → print error to stderr, return 2.
2. Record `started_at = datetime.now(timezone.utc).isoformat()`.
3. Open `--stdout-file` for writing (`"wb"` is fine). Launch the child:
   `proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=fh, stderr=subprocess.STDOUT, cwd=os.getcwd())`.
4. Install a `SIGTERM` handler that sets a flag `terminated = True` and calls `proc.terminate()` (the sidecar itself may be killed politely; it must still write the completion file).
5. Wait: `proc.wait(timeout=timeout_seconds)`. On `subprocess.TimeoutExpired`: set `timed_out = True`, call `proc.terminate()`, then `proc.wait(timeout=grace_seconds)`, and on a second `TimeoutExpired` call `proc.kill()` then `proc.wait()`.
6. Record `finished_at` the same way as `started_at`.
7. Write the completion file **atomically**: dump JSON to `completion_file + ".tmp"`, then `os.replace(tmp, completion_file)`. JSON payload (exact keys):

```json
{"schema": 1, "exit_code": <int>, "timed_out": <bool>, "terminated": <bool>,
 "started_at": "<iso8601>", "finished_at": "<iso8601>",
 "argv": ["...child command..."], "child_pid": <int>}
```

8. Return the child's exit code (`proc.returncode`; if it's `None` somehow, return 1).

## Deliverable 2: `server/apps/orchestrator/tests/test_sidecar.py`

Pure subprocess tests — no Django setup, no ORM, no fixtures from conftest needed
(the conftest env guard does not affect these tests; the sidecar is not an agent spawn).
Compute `SIDECAR = pathlib.Path(__file__).resolve().parents[1] / "sidecar.py"` and run it with
`subprocess.run([sys.executable, str(SIDECAR), ...], ...)` inside `tmp_path`.

Write exactly these tests:

1. `test_success_exit_zero` — child `[sys.executable, "-c", "print('hi')"]`. Assert: sidecar returncode 0; completion file exists and parses; `exit_code == 0`, `timed_out is False`, `terminated is False`, `schema == 1`; stdout file contains `hi`; no `*.tmp` file remains in `tmp_path`.
2. `test_exit_code_propagates` — child `[sys.executable, "-c", "import sys; sys.exit(3)"]`. Assert sidecar returncode 3 and completion `exit_code == 3`.
3. `test_timeout_kills_child` — child `[sys.executable, "-c", "import time; time.sleep(60)"]` with `--timeout-seconds 0.5 --grace-seconds 0.5`. Assert the whole `subprocess.run` finishes in under 10s, completion `timed_out is True`, and `started_at < finished_at`.
4. `test_argv_recorded` — completion `argv` equals the child command list.
5. `test_empty_command_errors` — no command after `--`: sidecar returncode 2, no completion file written.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator/tests/test_sidecar.py -q   # all pass
python -m pytest apps/orchestrator -q                                       # nothing else broke
```

## Out of scope / do not touch

- Do NOT modify `headless.py`, `driver.py`, `models.py`, or anything else — ST1 adds two new files only.
- No tmux, no Django settings, no DB. The spawner (ST4) decides where the files live; the sidecar just honors the paths it is given.
