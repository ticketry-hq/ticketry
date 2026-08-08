from __future__ import annotations

from apps.runs.models import AgentRun
from apps.terminals.dao.constants import SCRATCH_TASK_ID


def task_id_for_run(run: AgentRun) -> str:
    """Return the public task bucket derived from a run's Issue."""

    return str(run.issue_id) if run.issue.module_id else SCRATCH_TASK_ID


def module_id_for_run(run: AgentRun) -> str:
    """Return the run's module id derived from its Issue."""

    return str(run.issue.module_id or run.issue_id)


def project_id_for_run(run: AgentRun) -> str:
    """Return the run's project id derived from its Issue."""

    return str(run.issue.project_id)


async def list_terminal_sessions_for_task(
    task_id: str,
) -> list[AgentRun]:
    """Return active terminal-backed runs for a task bucket, newest-first."""

    rows = AgentRun.objects.filter(
        ended_at__isnull=True,
        terminal_owner_id__isnull=False,
    ).select_related("issue")
    if task_id == SCRATCH_TASK_ID:
        rows = rows.filter(issue__module__isnull=True)
    else:
        rows = rows.filter(issue_id=task_id, issue__module__isnull=False)
    rows = rows.order_by("-started_at", "-id")
    return [row async for row in rows]


async def list_scratch_terminal_sessions(
    project_id: str,
    module_id: str,
) -> list[AgentRun]:
    """Return active scratch sessions for one project and module."""

    rows = (
        AgentRun.objects.filter(
            issue_id=module_id,
            issue__project_id=project_id,
            issue__module__isnull=True,
            ended_at__isnull=True,
            terminal_owner_id__isnull=False,
        )
        .select_related("issue")
        .order_by("-started_at", "-id")
    )
    return [row async for row in rows]


async def soft_delete_terminal_session(
    agent_run_id: str,
    *,
    terminated_at: str,
) -> bool:
    """Mark an active terminal session as terminated."""

    updated = await AgentRun.objects.filter(
        id=agent_run_id,
        ended_at__isnull=True,
    ).aupdate(
        status="terminated",
        ended_at=terminated_at,
        lifecycle_state="exited",
        lifecycle_updated_at=terminated_at,
    )
    return updated > 0
