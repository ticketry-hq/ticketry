from __future__ import annotations

from apps.runs.run_scopes import SHELL_SCOPE
from apps.terminals.models import AgentTerminalSession
from apps.terminals.dao.constants import SCRATCH_TASK_ID


async def insert_terminal_session(terminal_session: AgentTerminalSession) -> None:
    """Persist a newly-created terminal session."""

    await terminal_session.asave(force_insert=True)


async def list_terminal_sessions_for_task(
    task_id: str,
    *,
    runtime_namespace: str,
) -> list[AgentTerminalSession]:
    """Return runtime-owned active terminal sessions for a task, newest-first."""

    rows = AgentTerminalSession.objects.filter(
        task_id=task_id,
        runtime_namespace=runtime_namespace,
        terminated_at__isnull=True,
    ).order_by("-created_at")
    return [row async for row in rows]


async def list_scratch_terminal_sessions(
    project_id: str,
    module_id: str,
    *,
    runtime_namespace: str,
) -> list[AgentTerminalSession]:
    """Return active scratch sessions for one project and module."""

    rows = AgentTerminalSession.objects.filter(
        task_id=SCRATCH_TASK_ID,
        project_id=project_id,
        module_id=module_id,
        runtime_namespace=runtime_namespace,
        terminated_at__isnull=True,
    ).order_by("-created_at")
    return [row async for row in rows]


async def list_shell_terminal_sessions(
    module_id: str,
    *,
    runtime_namespace: str,
) -> list[AgentTerminalSession]:
    """Return active shell sessions for one module, oldest-first (#666).

    Shell tabs are presented in the order they were created, so a new shell
    appends to the strip rather than displacing the position of the ones
    already there.
    """

    rows = AgentTerminalSession.objects.filter(
        module_id=module_id,
        scope=SHELL_SCOPE,
        runtime_namespace=runtime_namespace,
        terminated_at__isnull=True,
    ).order_by("created_at", "agent_run_id")
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
