"""Row builders for the execution driver's graph-run scenarios.

Shared by the parallel and serial scheduling suites so both observe the same
subtree shape. The ``graph_project`` fixture these build on lives in this
package's ``conftest``.
"""

from __future__ import annotations

import uuid

from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue


async def _successful_spawn(**kwargs):
    _successful_spawn.calls.append(kwargs)
    return f"run-{len(_successful_spawn.calls)}"


_successful_spawn.calls = []


def _task(
    project,
    issue_type,
    parent,
    name,
    sequence_id,
    state,
    *,
    archived=False,
    task_id=None,
):
    return Issue.objects.create(
        id=task_id or uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=parent,
        state=state,
        name=name,
        sequence_id=sequence_id,
        is_archived=archived,
    )


def _agent_run(issue, run_id: str, *, active: bool) -> AgentRun:
    return AgentRun.objects.create(
        id=run_id,
        issue=issue,
        ticket_seq=issue.sequence_id,
        agent="codex",
        status="running" if active else "exited",
        started_at="2026-08-08T10:00:00+00:00",
        ended_at=None if active else "2026-08-08T10:05:00+00:00",
        scope="task",
    )


def _terminal_session(
    run,
    *,
    project,
    module,
    task,
    terminated=False,
    runtime_namespace=None,
):
    return AgentTerminalSession.objects.create(
        agent_run=run,
        tmux_session_name=f"pt-{run.id}",
        task_id=str(task.id),
        module_id=str(module.id),
        project_id=str(project.id),
        agent="codex",
        created_at="2026-08-08T10:00:00+00:00",
        terminated_at="2026-08-08T10:06:00+00:00" if terminated else None,
        runtime_namespace=runtime_namespace,
        scope="task",
    )
