from __future__ import annotations

from apps.terminals.models import AgentTerminalSession
from apps.terminals.dao.constants import SCRATCH_TASK_ID


async def insert_terminal_session(terminal_session: AgentTerminalSession) -> None:
    """Persist a newly-created terminal session."""

    await terminal_session.asave(force_insert=True)


async def list_terminal_sessions_for_task(
    task_id: str,
) -> list[AgentTerminalSession]:
    """Return active terminal sessions for a task, newest-first."""

    rows = AgentTerminalSession.objects.filter(
        task_id=task_id,
        terminated_at__isnull=True,
    ).order_by("-created_at")
    return [row async for row in rows]


async def list_scratch_terminal_sessions(
    project_id: str,
    module_id: str,
) -> list[AgentTerminalSession]:
    """Return active scratch sessions for one project and module."""

    rows = AgentTerminalSession.objects.filter(
        task_id=SCRATCH_TASK_ID,
        project_id=project_id,
        module_id=module_id,
        terminated_at__isnull=True,
    ).order_by("-created_at")
    return [row async for row in rows]


async def list_active_terminal_sessions() -> list[AgentTerminalSession]:
    """Return every active persisted terminal session."""

    rows = AgentTerminalSession.objects.filter(terminated_at__isnull=True)
    return [row async for row in rows]


async def soft_delete_terminal_session(
    agent_run_id: str,
    *,
    terminated_at: str,
) -> bool:
    """Mark an active terminal session as terminated."""

    updated = await AgentTerminalSession.objects.filter(
        agent_run_id=agent_run_id,
        terminated_at__isnull=True,
    ).aupdate(terminated_at=terminated_at)
    return updated > 0
