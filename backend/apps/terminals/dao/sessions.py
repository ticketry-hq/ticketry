from __future__ import annotations

from apps.terminals.models import AgentTerminalSession


async def list_terminal_sessions_for_task(
    task_id: str,
) -> list[AgentTerminalSession]:
    """Return active terminal sessions for a task, newest-first."""

    rows = AgentTerminalSession.objects.filter(
        task_id=task_id,
        terminated_at__isnull=True,
    ).order_by("-created_at")
    return [row async for row in rows]
