from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from django.db.models import Q
from django.db.models.functions import Coalesce

from apps.runs.models import AgentRun


def normalize_utc_timestamp(value: str) -> str:
    """Return one sortable ISO-8601 representation, treating naive input as UTC."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


async def insert_agent_run(run: AgentRun) -> None:
    """Persist a new agent run row."""

    await run.asave(force_insert=True)


async def update_agent_run_exit(
    run_id: str,
    *,
    status: str,
    ended_at: str,
    exit_code: Optional[int] = None,
    error: Optional[str] = None,
) -> bool:
    """Patch only a run's terminal fields."""

    updated = await AgentRun.objects.filter(id=run_id).aupdate(
        status=status,
        ended_at=ended_at,
        exit_code=exit_code,
        error=error,
    )
    return updated > 0


async def set_provider_session_id(run_id: str, provider_session_id: str) -> bool:
    """Record an agent's resumable provider session id."""

    updated = await AgentRun.objects.filter(id=run_id).aupdate(
        provider_session_id=provider_session_id
    )
    return updated > 0


async def set_lifecycle_state(
    run_id: str,
    lifecycle_state: str,
    *,
    updated_at: str,
) -> bool:
    """Record a run's latest reduced lifecycle state.

    Only a run that has not ended can move: process exit is authoritative over
    any hook report (#1462). Without the ``ended_at`` guard a long-lived agent
    whose process outlived its tmux session keeps posting to the lifecycle
    ingress — its baked-in ``--lifecycle-url`` is resolved once at launch and
    never revalidated — and each late event carries a fresh timestamp that
    clears the monotonicity check, resurrecting a finished run into an active
    state. Terminal runs are therefore frozen here rather than in the caller,
    so every ingress path inherits the guard.
    """

    updated_at = normalize_utc_timestamp(updated_at)

    updated = (
        await AgentRun.objects.filter(id=run_id, ended_at__isnull=True)
        .filter(
            Q(lifecycle_updated_at__isnull=True)
            | Q(lifecycle_updated_at__lt=updated_at)
        )
        .aupdate(
            lifecycle_state=lifecycle_state,
            lifecycle_updated_at=updated_at,
        )
    )
    return updated > 0


async def get_run_routing(run_id: str) -> Optional[tuple[Optional[str], str]]:
    """Return a run's task and module routing keys."""

    routing = (
        await AgentRun.objects.filter(id=run_id)
        .annotate(run_module_id=Coalesce("issue__module_id", "issue_id"))
        .values_list("issue_id", "issue__type", "run_module_id")
        .afirst()
    )
    if routing is None:
        return None
    issue_id, issue_type, module_id = routing
    return (
        str(issue_id) if issue_type == "task" else None,
        str(module_id),
    )


async def get_status_routing(
    run_id: str,
) -> Optional[tuple[str, Optional[str], str, str, Optional[str], str]]:
    """Return the immutable identity and routing fields owned by a run.

    The agent slug is optional: a shell run has no provider (#665).
    """

    routing = (
        await AgentRun.objects.filter(id=run_id).exclude(scope="docchat")
        .annotate(run_module_id=Coalesce("issue__module_id", "issue_id"))
        .values_list(
            "issue__project_id",
            "issue_id",
            "issue__type",
            "run_module_id",
            "scope",
            "agent",
            "started_at",
        )
        .afirst()
    )
    if routing is None:
        return None
    project_id, issue_id, issue_type, module_id, scope, agent, started_at = routing
    return (
        str(project_id),
        str(issue_id) if issue_type == "task" else None,
        str(module_id),
        scope,
        agent,
        started_at,
    )


async def list_agent_runs_for_task(
    task_id: str,
    *,
    limit: Optional[int] = None,
) -> list[AgentRun]:
    """Return a task's runs ordered newest-first."""

    rows = AgentRun.objects.filter(issue_id=task_id).order_by("-started_at")
    if limit is not None:
        rows = rows[:limit]
    return [row async for row in rows]


async def delete_agent_run(run_id: str) -> None:
    """Delete a run row by id."""

    await AgentRun.objects.filter(id=run_id).adelete()
