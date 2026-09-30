---
name: backend-debug
description: Diagnose Ticketry backend, work-item, graph-run, agent-run, and terminal-session problems using the live local backend and its Postgres database. Use when a Ticketry action appears stuck, launched work does not start, or persisted backend state needs inspection.
---

# Ticketry Backend Debugging

The installed app and browser development use the product data directory named
by `config/product-identity.json`. A configured `TICKETRY_DATA_DIR` path wins.
The active SQLite database is:

```text
<product data directory>/state.db
```

Do not select a similarly named legacy profile by modification time. Confirm
the configured path and the process holding `.muxed-desktop-owner.json`.

## Diagnose without changing state

Backend debugging is read-only unless the user explicitly asks for a repair. Do not call launch, advance, reset, terminate, POST, DELETE, or model write methods merely to discover why something is stuck.

Prefer read-only SQLite queries against the configured database:

```bash
sqlite3 -readonly <product-data-directory>/state.db \
  "SELECT id, name FROM worktracker_issue WHERE id = '<work-item-id>';"
```

Then make narrow, read-only queries. For example:

```bash
MUXED_ENABLE_LOCAL_POSTGRES=true \
  backend/.venv/bin/python backend/manage.py shell -c \
  "from worktracker.models import Issue; print(list(Issue.objects.filter(project__slug='CODING', sequence_id=294).values('id', 'name', 'state__name', 'state__group')))"
```

Sequence numbers are only unique inside a project. Always resolve both the project slug and sequence number: `CODING-294` and `CODIN-294` can be different work items.

## Stuck run-subgraph checklist

Inspect these durable facts in order:

1. `worktracker.models.Issue`: root identity, current state, direct children, archived flags, and each child's `blocked_by` states.
2. `worktracker.models.LaunchBinding`: whether the root has `subtree_run_enabled` and whether each eligible child's current type/state resolves a launch policy.
3. `apps.execution.models.GraphRun`: whether the root was armed and when.
4. `apps.execution.models.LaunchedTask`: whether an eligible child reached the subtree launch ledger.
5. `apps.runs.models.AgentRun`: status, lifecycle, start/end time, error, exit code, and cwd.
6. `apps.terminals.models.AgentTerminalSession`: tmux session name and termination time.

Interpret the gaps:

- A `GraphRun` with an eligible child but no `LaunchedTask`, `AgentRun`, or terminal row means the child spawn raised before it completed persistence. The graph driver logs the exception and continues, so the UI can look idle while the graph remains armed.
- A `LaunchedTask` with an active `AgentRun` or unterminated terminal is treated as live and prevents a duplicate graph launch.
- A completed, cancelled, archived, or Review blocker is satisfied; an unfinished blocker keeps its dependent idle.

Resolve a child's launch configuration without starting it:

```bash
MUXED_ENABLE_LOCAL_POSTGRES=true \
  backend/.venv/bin/python backend/manage.py shell -c \
  "from worktracker.models import Issue; from apps.terminals.launch_configuration import resolve_task_launch_configuration; task=Issue.objects.get(project__slug='CODING', sequence_id=297); print(resolve_task_launch_configuration(str(task.id)))"
```

If configuration resolves but no run rows exist, inspect the live backend log or terminal scrollback for `execution subtree launch failed`. The remaining failure is later in prompt/worktree preparation, required-skill preflight, provider command construction, or tmux launch.

## Local connection caveat

Some sandboxes block the local Postgres Unix socket and report `Operation not permitted` even though Postgres and the backend are running. Treat that as a sandbox restriction, not evidence that the database is down. Ask for narrowly scoped permission to run the same read-only `manage.py shell -c` command outside the sandbox; do not switch to SQLite as a fallback.
